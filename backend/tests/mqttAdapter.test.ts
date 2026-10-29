import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { after, before, describe, it } from 'node:test';
import type { OperatorAccount } from '../src/auth/accountStore.ts';
import { signOperatorToken } from '../src/auth/tokens.ts';
import { loadConfig } from '../src/config.ts';
import { ImageStore } from '../src/iot/imageStore.ts';
import { MqttGatewayAdapter, type MqttClientLike } from '../src/iot/mqttAdapter.ts';
import { TelemetryHub } from '../src/iot/telemetryHub.ts';
import { createGatewayServer, type GatewayInstance } from '../src/server.ts';

/**
 * Deterministic In-Memory Mock MQTT Client for Isolated Testing.
 * Zero external network access or broker dependencies.
 */
class MockMqttClient extends EventEmitter implements MqttClientLike {
  public connected = false;
  public subscribedTopics: Array<{ topics: string[]; qos: number }> = [];
  public unsubscribedTopics: string[][] = [];
  public endCalled = false;
  public endForced: boolean | undefined = undefined;

  public subscribe(
    topic: string | string[],
    options: any,
    callback?: (err: Error | null, granted: unknown[]) => void
  ): this {
    const topicList = Array.isArray(topic) ? topic : [topic];
    this.subscribedTopics.push({ topics: topicList, qos: options?.qos ?? 0 });
    if (callback) {
      callback(null, topicList.map((t) => ({ topic: t, qos: options?.qos ?? 0 })));
    }
    return this;
  }

  public unsubscribe(
    topic: string | string[],
    _options?: unknown,
    callback?: (err?: Error) => void
  ): this {
    const topicList = Array.isArray(topic) ? topic : [topic];
    this.unsubscribedTopics.push(topicList);
    if (callback) callback();
    return this;
  }

  public end(force?: boolean, _options?: unknown, callback?: () => void): this {
    this.endCalled = true;
    this.endForced = force;
    this.connected = false;
    this.emit('close');
    if (callback) callback();
    return this;
  }

  // Test stimulation helpers
  public simulateConnect(): void {
    this.connected = true;
    this.emit('connect', { sessionPresent: false });
  }

  public simulateMessage(topic: string, payload: Buffer | string): void {
    const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf-8');
    this.emit('message', topic, buffer, {});
  }

  public simulateError(err: Error): void {
    this.emit('error', err);
  }

  public simulateClose(): void {
    this.connected = false;
    this.emit('close');
  }

  public simulateOffline(): void {
    this.connected = false;
    this.emit('offline');
  }

  public simulateReconnect(): void {
    this.emit('reconnect');
  }
}

describe('AGRAPATHA Gate B.2: MQTT Gateway Adapter Test Suite', () => {
  let mockClient: MockMqttClient;
  let telemetryHub: TelemetryHub;
  let imageStore: ImageStore;
  let adapter: MqttGatewayAdapter;

  before(() => {
    // Setup isolated instances
    telemetryHub = new TelemetryHub({ maxClientsPerIp: 5 });
    imageStore = new ImageStore({ maxFrameBytes: 65536, staleTtlMs: 60000 });
  });

  after(async () => {
    telemetryHub.destroy();
    if (adapter) {
      await adapter.destroy();
    }
  });

  // 1. Topic Subscriptions & Topic Whitelist Enforcement
  describe('1. Topic Subscriptions & Boundary Enforcement', () => {
    it('subscribes strictly to the two approved topics upon connection', () => {
      mockClient = new MockMqttClient();
      adapter = new MqttGatewayAdapter(telemetryHub, imageStore, {
        brokerUrl: 'mqtts://mock-broker.example.com:8883',
        clientFactory: () => mockClient,
      });

      adapter.start();
      assert.equal(mockClient.subscribedTopics.length, 0, 'Should not subscribe before connect event');

      mockClient.simulateConnect();
      assert.equal(mockClient.subscribedTopics.length, 1, 'Should subscribe once on connect');

      const subscribed = mockClient.subscribedTopics[0].topics.slice().sort();
      const expected = ['agrapatha/telemetry', 'grenvis/vision/image'].sort();
      assert.deepEqual(subscribed, expected, 'Must subscribe strictly to approved topics');
      assert.equal(mockClient.subscribedTopics[0].qos, 1, 'Must use QoS 1');
    });

    it('does NOT subscribe to legacy telemetry (grenvis/sensor/data) or actuator topics', () => {
      const allSubscribed = mockClient.subscribedTopics.flatMap((s) => s.topics);
      assert.ok(!allSubscribed.includes('grenvis/sensor/data'), 'Must not subscribe to legacy telemetry');
      assert.ok(!allSubscribed.includes('agrapatha/commands'), 'Must not subscribe to actuator commands');
      assert.ok(!allSubscribed.some((t) => t.includes('actuator')), 'Must not subscribe to any actuator topic');
    });

    it('exposes zero MQTT publish capability on the gateway adapter', () => {
      assert.equal(
        (adapter as any).publish,
        undefined,
        'Gateway adapter must NOT expose any publish method'
      );
      assert.equal(
        (mockClient as any).publish,
        undefined,
        'Mock client does not even implement publish'
      );
    });
  });

  // 2. Telemetry Ingestion & Sanitization
  describe('2. Telemetry Ingestion & Sensitive Field Sanitization', () => {
    it('routes valid incoming telemetry to TelemetryHub without error', () => {
      const payload = JSON.stringify({
        temp: 28.4,
        rh: 65.2,
        soilMoisture: 52.1,
        rainStatus: 'DRY',
        motorState: 'IDLE',
        uptimeSeconds: 4200,
      });

      mockClient.simulateMessage('agrapatha/telemetry', payload);

      const latest = telemetryHub.getLatestTelemetry();
      assert.ok(latest, 'TelemetryHub must have recorded the latest telemetry');
      assert.equal(latest.temp, 28.4);
      assert.equal(latest.rh, 65.2);
      assert.equal(latest.soilMoisture, 52.1);
      assert.equal(latest.rainStatus, 'DRY');
    });

    it('routes MQ-135 raw and Flame sensor readings into TelemetryHub preserving truthful representations', () => {
      const firmwarePayload = JSON.stringify({
        temp: 29.1,
        rh: 61.5,
        soil_raw: 2150,
        soil_moisture: 45.0,
        mq135_raw: 1350,
        flame_detected: 1,
        flame_raw: 920,
        motor_state: 'STOPPED',
        motor_driver: 'L298N_OUT3_OUT4',
      });

      mockClient.simulateMessage('agrapatha/telemetry', firmwarePayload);

      const latest = telemetryHub.getLatestTelemetry();
      assert.ok(latest);
      assert.equal(latest.temp, 29.1);
      assert.equal(latest.rh, 61.5);
      assert.equal(latest.soilMoisture, 45.0);
      assert.equal(latest.mq135Raw, 1350);
      assert.equal(latest.gasPpm, null, 'Raw ADC is uncalibrated and must not become gasPpm');
      assert.equal(latest.flameDetected, 1);
      assert.equal(latest.flameRaw, 920);
    });

    it('sanitizes and strips device MAC, IP, Wi-Fi credentials, and debug fields', () => {
      const sensitivePayload = JSON.stringify({
        mac: '24:6F:28:AB:CD:EF',
        bssid: '00:11:22:33:44:55',
        ip: '192.168.4.1',
        wifiSsid: 'SecretOfficeNet',
        wifiPass: 'hunter2',
        debugSecret: 'token_leaked',
        internalBusVoltage: 3.3,
        temp: 31.0,
        rh: 80.0,
      });

      mockClient.simulateMessage('agrapatha/telemetry', sensitivePayload);

      const latest = telemetryHub.getLatestTelemetry() as unknown as Record<string, unknown>;
      assert.ok(latest);
      assert.equal(latest.temp, 31.0);
      assert.equal(latest.rh, 80.0);
      assert.equal(latest.mac, undefined, 'Device MAC must be stripped');
      assert.equal(latest.bssid, undefined, 'BSSID must be stripped');
      assert.equal(latest.ip, undefined, 'Internal IP must be stripped');
      assert.equal(latest.wifiSsid, undefined, 'Wi-Fi SSID must be stripped');
      assert.equal(latest.wifiPass, undefined, 'Wi-Fi Password must be stripped');
      assert.equal(latest.debugSecret, undefined, 'Debug secrets must be stripped');
    });

    it('gracefully handles and drops malformed telemetry without crashing', () => {
      // Non-JSON string
      mockClient.simulateMessage('agrapatha/telemetry', 'NOT_JSON{broken');

      // Invalid schema (array instead of object)
      mockClient.simulateMessage('agrapatha/telemetry', '[1, 2, 3]');

      // Empty payload
      mockClient.simulateMessage('agrapatha/telemetry', '');

      // Adapter must remain functional
      assert.ok(adapter.isConnected(), 'Adapter remains connected and functioning');
    });

    it('strictly drops messages received on unapproved topics', () => {
      const priorCount = telemetryHub.getLatestTelemetry()?.uptimeSeconds;

      // Send to unapproved legacy topic
      mockClient.simulateMessage(
        'grenvis/sensor/data',
        JSON.stringify({ temp: 99.9, uptimeSeconds: 999999 })
      );

      const current = telemetryHub.getLatestTelemetry();
      assert.notEqual(current?.temp, 99.9, 'Unapproved topic message must be dropped');
    });
  });

  // 3. Binary Image Ingestion
  describe('3. Binary JPEG Image Ingestion', () => {
    it('routes binary JPEG frame into ImageStore preserving byte fidelity', () => {
      // Build a valid test JPEG buffer: SOI (0xFF 0xD8), arbitrary bytes (including null bytes), EOI (0xFF 0xD9)
      const jpegBytes = Buffer.from([0xff, 0xd8, 0x12, 0x00, 0x34, 0xab, 0xcd, 0x00, 0xff, 0xd9]);

      mockClient.simulateMessage('grenvis/vision/image', jpegBytes);

      const frameInfo = imageStore.getFrame(Date.now());
      assert.ok(frameInfo, 'ImageStore must contain the ingested frame');
      assert.equal(frameInfo.frame.byteLength, jpegBytes.byteLength);
      assert.equal(
        Buffer.compare(frameInfo.frame.data, jpegBytes),
        0,
        'JPEG binary bytes must be preserved with zero corruption or encoding distortion'
      );
    });

    it('rejects oversized images (> 64 KiB) without corrupting existing frame', () => {
      const initialFrame = imageStore.getFrame(Date.now());

      // Create oversized buffer > 65536 bytes
      const oversized = Buffer.alloc(70000, 0xaa);
      oversized[0] = 0xff;
      oversized[1] = 0xd8;
      oversized[69998] = 0xff;
      oversized[69999] = 0xd9;

      mockClient.simulateMessage('grenvis/vision/image', oversized);

      const frameAfter = imageStore.getFrame(Date.now());
      // Frame in store must remain the previous valid frame
      assert.equal(frameAfter?.frame.byteLength, initialFrame?.frame.byteLength);
    });

    it('rejects malformed images missing JPEG SOI/EOI framing', () => {
      const initialFrame = imageStore.getFrame(Date.now());

      // Missing SOI
      mockClient.simulateMessage('grenvis/vision/image', Buffer.from([0x00, 0x00, 0xff, 0xd9]));
      assert.equal(imageStore.getFrame(Date.now())?.frame.byteLength, initialFrame?.frame.byteLength);

      // Missing EOI
      mockClient.simulateMessage('grenvis/vision/image', Buffer.from([0xff, 0xd8, 0x00, 0x00]));
      assert.equal(imageStore.getFrame(Date.now())?.frame.byteLength, initialFrame?.frame.byteLength);
    });

    it('simulates ESP-NOW 300-chunk fragmentation and reassembly published to grenvis/vision/image', () => {
      // 1. Build original 60,000-byte JPEG (ESP32 MAX_IMAGE_SIZE)
      const originalImage = Buffer.alloc(60000);
      originalImage[0] = 0xff;
      originalImage[1] = 0xd8; // SOI
      for (let i = 2; i < 59998; i++) {
        originalImage[i] = (i * 37) & 0xff; // deterministic pattern
      }
      originalImage[59998] = 0xff;
      originalImage[59999] = 0xd9; // EOI

      // 2. ESP32-CAM fragmentation simulation: 300 chunks of 200 bytes
      const CHUNK_SIZE = 200;
      const totalChunks = Math.ceil(originalImage.byteLength / CHUNK_SIZE);
      assert.equal(totalChunks, 300);

      const chunks: Buffer[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const offset = i * CHUNK_SIZE;
        chunks.push(originalImage.subarray(offset, offset + CHUNK_SIZE));
      }
      assert.equal(chunks.length, 300);

      // 3. ESP32 Main reassembly simulation
      const reassembled = Buffer.concat(chunks);
      assert.equal(reassembled.byteLength, 60000);

      // 4. Publish to MQTT topic grenvis/vision/image
      mockClient.simulateMessage('grenvis/vision/image', reassembled);

      // 5. Ingestion verification in ImageStore
      const stored = imageStore.getFrame(Date.now());
      assert.ok(stored, 'ImageStore must contain the reassembled frame');
      assert.equal(stored.frame.byteLength, 60000);
      assert.equal(Buffer.compare(stored.frame.data, originalImage), 0);
      assert.equal(stored.isStale, false);
    });
  });

  // 4. TLS & Security Configuration Enforcement
  describe('4. TLS & Security Enforcement', () => {
    it('throws immediately if rejectUnauthorized: false is supplied to adapter', () => {
      assert.throws(
        () => {
          new MqttGatewayAdapter(telemetryHub, imageStore, {
            brokerUrl: 'mqtts://broker.example.com',
            rejectUnauthorized: false,
          });
        },
        /SECURITY VIOLATION: rejectUnauthorized cannot be set to false/,
        'Must block insecure TLS settings'
      );
    });

    it('throws if broker URL is empty', () => {
      assert.throws(
        () => {
          new MqttGatewayAdapter(telemetryHub, imageStore, {
            brokerUrl: '',
          });
        },
        /MQTT broker URL is required/
      );
    });

    it('enforces TLS and credentials in production configuration via loadConfig', () => {
      const prodEnv = {
        NODE_ENV: 'production',
        GATEWAY_TOKEN_SECRET: 'a'.repeat(32),
      };

      // 1. Plaintext mqtt:// in production
      assert.throws(
        () => {
          loadConfig(
            {
              mqttBrokerUrl: 'mqtt://insecure-broker.example.com:1883',
              mqttUsername: 'user',
              mqttPassword: 'password',
            },
            prodEnv
          );
        },
        /MQTT broker connection must use TLS \(mqtts:\/\/ or wss:\/\/\) in production/
      );

      // 2. Missing username in production
      assert.throws(
        () => {
          loadConfig(
            {
              mqttBrokerUrl: 'mqtts://broker.example.com:8883',
              mqttPassword: 'password',
            },
            prodEnv
          );
        },
        /MQTT_USERNAME must be set in production when MQTT is enabled/
      );

      // 3. Missing password in production
      assert.throws(
        () => {
          loadConfig(
            {
              mqttBrokerUrl: 'mqtts://broker.example.com:8883',
              mqttUsername: 'user',
            },
            prodEnv
          );
        },
        /MQTT_PASSWORD must be set in production when MQTT is enabled/
      );
    });
  });

  // 5. Connection Lifecycle, Reconnection & Health State
  describe('5. Connection Lifecycle, Reconnection & Health State', () => {
    it('tracks connection state accurately before connect, on connect, and on disconnect', () => {
      const testMock = new MockMqttClient();
      const testAdapter = new MqttGatewayAdapter(telemetryHub, imageStore, {
        brokerUrl: 'mqtts://broker.example.com:8883',
        clientFactory: () => testMock,
      });

      assert.equal(testAdapter.isConnected(), false, 'Initial state must be disconnected');

      testAdapter.start();
      assert.equal(testAdapter.isConnected(), false, 'Still disconnected prior to connect event');

      testMock.simulateConnect();
      assert.equal(testAdapter.isConnected(), true, 'Connected after connect event');

      testMock.simulateClose();
      assert.equal(testAdapter.isConnected(), false, 'Disconnected after close event');

      testMock.simulateConnect();
      assert.equal(testAdapter.isConnected(), true, 'Re-connected after second connect event');

      testMock.simulateOffline();
      assert.equal(testAdapter.isConnected(), false, 'Disconnected on offline event');

      testMock.simulateConnect();
      assert.equal(testAdapter.isConnected(), true, 'Connected again');

      testMock.simulateError(new Error('Connection reset by peer'));
      assert.equal(testAdapter.isConnected(), false, 'Disconnected on error event');
    });

    it('safely handles factory errors on start without crashing', () => {
      const failingAdapter = new MqttGatewayAdapter(telemetryHub, imageStore, {
        brokerUrl: 'mqtts://broker.example.com:8883',
        clientFactory: () => {
          throw new Error('Immediate DNS resolution failure');
        },
      });

      assert.doesNotThrow(() => failingAdapter.start());
      assert.equal(failingAdapter.isConnected(), false);
    });

    it('unsubscribes and closes client gracefully on destroy', async () => {
      const testMock = new MockMqttClient();
      const testAdapter = new MqttGatewayAdapter(telemetryHub, imageStore, {
        brokerUrl: 'mqtts://broker.example.com:8883',
        clientFactory: () => testMock,
      });

      testAdapter.start();
      testMock.simulateConnect();
      assert.equal(testAdapter.isConnected(), true);

      await testAdapter.destroy();

      assert.equal(testAdapter.isConnected(), false);
      assert.equal(testMock.endCalled, true);
      assert.equal(testMock.endForced, true);
      assert.equal(testMock.unsubscribedTopics.length, 1);
      const unsubscribed = testMock.unsubscribedTopics[0].slice().sort();
      assert.deepEqual(unsubscribed, ['agrapatha/telemetry', 'grenvis/vision/image'].sort());
    });
  });

  // 6. Integration with Gateway Server & /health Endpoint
  describe('6. Gateway Server Integration & Fail-Closed Boundaries', () => {
    let gateway: GatewayInstance;
    let serverClient: MockMqttClient;
    let serverAdapter: MqttGatewayAdapter;
    let validToken: string;
    const testSecret = 'test-token-secret-for-mqtt-tests-minimum-32!';

    before(async () => {
      serverClient = new MockMqttClient();
      serverAdapter = new MqttGatewayAdapter(
        new TelemetryHub({ maxClientsPerIp: 5 }),
        new ImageStore({ maxFrameBytes: 65536, staleTtlMs: 60000 }),
        {
          brokerUrl: 'mqtts://broker.example.com:8883',
          clientFactory: () => serverClient,
        }
      );
      serverAdapter.start();

      const operator: OperatorAccount = {
        id: 'op-test-1',
        username: 'operator1',
        displayName: 'Operator 1',
        role: 'OPERATOR',
        passwordHash: 'dummy',
        status: 'ACTIVE',
        tokenVersion: 1,
      };
      const accountStore = new Map<string, OperatorAccount>([['operator1', operator]]);
      validToken = signOperatorToken(operator, testSecret, 3600);

      gateway = createGatewayServer({
        config: {
          gatewayTokenSecret: testSecret,
          mqttEnabled: true,
          mqttBrokerUrl: 'mqtts://broker.example.com:8883',
          enableActuators: false, // Explicitly fail-closed
        },
        accountStore,
        mqttAdapter: serverAdapter,
      });

      await new Promise<void>((resolve) => gateway.server.listen(0, resolve));
    });

    after(async () => {
      await new Promise<void>((resolve) => gateway.server.close(() => resolve()));
      await serverAdapter.destroy();
    });

    async function req(path: string, options: RequestInit = {}): Promise<Response> {
      const addr = gateway.server.address() as any;
      return fetch(`http://localhost:${addr.port}${path}`, options);
    }

    it('reports mqttConnected: false in /health before broker connects', async () => {
      const res = await req('/health');
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.status, 'ok');
      assert.equal(body.mqttConnected, false, 'Must report false before connection');
      assert.equal(body.actuatorsEnabled, false);
      assert.equal(body.mqttPassword, undefined, 'Must not leak credentials');
      assert.equal(body.mqttBrokerUrl, undefined, 'Must not leak broker URL');
    });

    it('dynamically reports mqttConnected: true after broker connection succeeds', async () => {
      serverClient.simulateConnect();
      const res = await req('/health');
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.mqttConnected, true, 'Must dynamically report true when connected');
    });

    it('dynamically reverts to mqttConnected: false after disconnect', async () => {
      serverClient.simulateClose();
      const res = await req('/health');
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.mqttConnected, false, 'Must revert to false on disconnect');
    });

    it('preserves actuator fail-closed behavior (returns HTTP 503 and publishes nothing)', async () => {
      // 1. Unauthenticated request rejected with 401
      const unauthRes = await req('/api/commands/actuator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'LEFT' }),
      });
      assert.equal(unauthRes.status, 401, 'Unauthenticated command must return 401');

      // 2. Authenticated operator request returns 503 ACTUATOR_DISABLED
      const res = await req('/api/commands/actuator', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          action: 'LEFT',
        }),
      });

      assert.equal(res.status, 503, 'Actuator endpoint must remain fail-closed 503');
      const body = await res.json() as any;
      assert.equal(body.code, 'ACTUATOR_DISABLED');
      // Verify no publish methods exist on adapter or client
      assert.equal((serverAdapter as any).publish, undefined);
    });

    it('starts HTTP gateway cleanly when MQTT is completely unconfigured', async () => {
      const unconfiguredGateway = createGatewayServer({
        config: {
          mqttEnabled: false,
          mqttBrokerUrl: '',
        },
      });

      await new Promise<void>((resolve) => unconfiguredGateway.server.listen(0, resolve));
      const addr = unconfiguredGateway.server.address() as any;

      try {
        const res = await fetch(`http://localhost:${addr.port}/health`);
        assert.equal(res.status, 200);
        const body = await res.json() as any;
        assert.equal(body.status, 'ok');
        assert.equal(body.mqttConnected, false, 'Unconfigured MQTT must report false');
      } finally {
        await new Promise<void>((resolve) => unconfiguredGateway.server.close(() => resolve()));
      }
    });
  });
});
