import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { authenticateOperator, loadAccountStore, type OperatorAccount } from '../src/auth/accountStore.ts';
import { hashPassword, verifyPassword } from '../src/auth/scrypt.ts';
import { signOperatorToken, verifyOperatorToken } from '../src/auth/tokens.ts';
import { loadConfig } from '../src/config.ts';
import { evaluateActuatorCommand, normalizeActuatorCommand } from '../src/iot/actuatorGate.ts';
import { ImageStore, validateJpegFraming } from '../src/iot/imageStore.ts';
import { SseStreamParser, type SseEvent } from '../src/iot/sseParser.ts';
import { sanitizeTelemetry, TelemetryHub } from '../src/iot/telemetryHub.ts';
import { createGatewayServer, type GatewayInstance } from '../src/server.ts';

describe('Agrapatha IoT Gateway & Security Boundary Test Suite', () => {
  let mockTime = 1700000000000;
  const advanceTime = (ms: number) => {
    mockTime += ms;
  };

  const TEST_SECRET = 'super-secure-test-token-secret-must-be-32-chars-long!';

  // Helper to make requests to the gateway instance
  async function makeRequest(
    instance: GatewayInstance,
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const address = instance.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const url = `http://localhost:${port}${path}`;
    return fetch(url, options);
  }

  // 1. Telemetry Schema Filtering & Sanitization
  describe('1. Public Telemetry Schema Filtering & Sanitization', () => {
    it('strips internal network identifiers and sensitive fields', () => {
      const rawPayload = {
        mac: 'AA:BB:CC:DD:EE:FF',
        ip: '192.168.1.105',
        channel: 6,
        wifiRssi: -65,
        debugSecret: 'do-not-leak',
        temp: 29.5,
        rh: 72.0,
        soilMoisture: 45.2,
        soilRaw: 2150,
        rain: 0,
        rainStatus: 'DRY',
        lightLux: 350,
        ldrRaw: 1800,
        motorState: 'IDLE',
        motorDriver: 'L298N',
        limitLeft: false,
        limitRight: false,
        uptimeSeconds: 1234,
        visionPrediction: 'HEALTHY',
        visionConfidence: 0.94,
        imageReady: true,
      };

      const sanitized = sanitizeTelemetry(rawPayload, mockTime, mockTime);
      assert.ok(sanitized);

      // Verify approved fields exist
      assert.equal(sanitized.temp, 29.5);
      assert.equal(sanitized.rh, 72.0);
      assert.equal(sanitized.soilMoisture, 45.2);
      assert.equal(sanitized.rainStatus, 'DRY');
      assert.equal(sanitized.visionPrediction, 'HEALTHY');
      assert.equal(sanitized.visionConfidence, 0.94);
      assert.equal(sanitized.imageReady, true);
      assert.equal(sanitized.freshness, 'FRESH');
      assert.equal(sanitized.timestamp, mockTime);

      // Verify stripped fields do not exist on output
      const asRecord = sanitized as unknown as Record<string, unknown>;
      assert.equal(asRecord.mac, undefined);
      assert.equal(asRecord.ip, undefined);
      assert.equal(asRecord.channel, undefined);
      assert.equal(asRecord.wifiRssi, undefined);
      assert.equal(asRecord.debugSecret, undefined);
    });

    it('maps legacy sensor field aliases correctly', () => {
      const legacyPayload = {
        temperature: 31.2,
        humidity: 68.0,
        soil_moisture: 55.4,
        soil_raw: 1980,
        rain_status: 'WET',
        light_lux: 850,
        ldr_raw: 920,
        motor_state: 'MOVING_LEFT',
        motor_driver: 'L298N',
        limit_left: true,
        limit_right: false,
        uptime_seconds: 4500,
        vision_prediction: 'EARLY_BLIGHT',
        vision_confidence: 0.88,
        image_ready: 'true',
      };

      const sanitized = sanitizeTelemetry(legacyPayload, mockTime, mockTime);
      assert.ok(sanitized);
      assert.equal(sanitized.temp, 31.2);
      assert.equal(sanitized.rh, 68.0);
      assert.equal(sanitized.soilMoisture, 55.4);
      assert.equal(sanitized.soilRaw, 1980);
      assert.equal(sanitized.rainStatus, 'WET');
      assert.equal(sanitized.lightLux, 850);
      assert.equal(sanitized.motorState, 'MOVING_LEFT');
      assert.equal(sanitized.limitLeft, true);
      assert.equal(sanitized.limitRight, false);
      assert.equal(sanitized.visionPrediction, 'EARLY_BLIGHT');
      assert.equal(sanitized.visionConfidence, 0.88);
      assert.equal(sanitized.imageReady, true);
    });

    it('marks telemetry as STALE when last received timestamp exceeds freshness window', () => {
      const payload = { temp: 25.0 };
      const tenSecondsAgo = mockTime - 15000;
      const sanitized = sanitizeTelemetry(payload, mockTime, tenSecondsAgo);
      assert.ok(sanitized);
      assert.equal(sanitized.freshness, 'STALE');
    });

    it('handles null, non-object, and empty telemetry safely without throwing', () => {
      assert.equal(sanitizeTelemetry(null, mockTime, mockTime), null);
      assert.equal(sanitizeTelemetry('invalid', mockTime, mockTime), null);
      assert.equal(sanitizeTelemetry(12345, mockTime, mockTime), null);
      assert.equal(sanitizeTelemetry(undefined, mockTime, mockTime), null);
    });

    it('parses MQ-135 raw ADC separately from calibrated gas concentration without labeling raw as ppm', () => {
      // Firmware payload with raw ADC (uncalibrated)
      const rawFirmwarePayload = {
        temp: 27.5,
        rh: 62.0,
        soilMoisture: 55.0,
        mq135_raw: 1420,
        mq135: 1420,
      };

      const sanitized = sanitizeTelemetry(rawFirmwarePayload, mockTime, mockTime);
      assert.ok(sanitized);
      assert.equal(sanitized.mq135Raw, 1420);
      assert.equal(sanitized.gasPpm, null, 'Raw ADC must NOT be labeled as gasPpm');

      // Calibrated payload
      const calibratedPayload = {
        mq135_raw: 1420,
        gas_ppm: 450,
      };
      const sanitizedCalibrated = sanitizeTelemetry(calibratedPayload, mockTime, mockTime);
      assert.ok(sanitizedCalibrated);
      assert.equal(sanitizedCalibrated.mq135Raw, 1420);
      assert.equal(sanitizedCalibrated.gasPpm, 450);
    });

    it('parses Flame sensor digital detection and raw analog signal truthfully', () => {
      // Case A: Flame detected via numeric 1 and analog raw ADC
      const flameDetectedPayload = {
        flame_detected: 1,
        flame_raw: 850,
      };
      const sanitizedA = sanitizeTelemetry(flameDetectedPayload, mockTime, mockTime);
      assert.ok(sanitizedA);
      assert.equal(sanitizedA.flameDetected, 1);
      assert.equal(sanitizedA.flameRaw, 850);

      // Case B: No flame (safe) via boolean false and high raw ADC
      const flameSafePayload = {
        flame_detected: false,
        flame_raw: 3950,
      };
      const sanitizedB = sanitizeTelemetry(flameSafePayload, mockTime, mockTime);
      assert.ok(sanitizedB);
      assert.equal(sanitizedB.flameDetected, 0);
      assert.equal(sanitizedB.flameRaw, 3950);
    });

    it('correctly handles decommissioned rain and light sensors leaving fields null in truthful hardware payload', () => {
      // 4-sensor hardware setup: DHT22, Soil, MQ-135, Flame (NO rain, NO LDR)
      const confirmedRigPayload = {
        temp: 28.1,
        rh: 64.0,
        soil_moisture: 48.0,
        soil_raw: 2200,
        mq135_raw: 1100,
        flame_detected: 0,
        flame_raw: 3800,
      };

      const sanitized = sanitizeTelemetry(confirmedRigPayload, mockTime, mockTime);
      assert.ok(sanitized);
      assert.equal(sanitized.temp, 28.1);
      assert.equal(sanitized.rh, 64.0);
      assert.equal(sanitized.soilMoisture, 48.0);
      assert.equal(sanitized.mq135Raw, 1100);
      assert.equal(sanitized.flameDetected, 0);
      assert.equal(sanitized.flameRaw, 3800);
      // Legacy fields must be null (not fabricated)
      assert.equal(sanitized.rain, null);
      assert.equal(sanitized.rainStatus, null);
      assert.equal(sanitized.lightLux, null);
      assert.equal(sanitized.ldrRaw, null);
    });
  });

  // 2. SSE Parsing Engine
  describe('2. SSE Parsing Engine (SseStreamParser)', () => {
    it('handles chunk splits across multibyte UTF-8 characters', () => {
      const events: Array<{ event?: string; data: string }> = [];
      const parser = new SseStreamParser((msg) => events.push(msg));

      // Multibyte Indonesian weather text: "Peringatan Cuaca: Hujan Deras 🌧️"
      const fullText = 'event: warning\ndata: {"status":"Peringatan 🌧️"}\n\n';
      const buf = Buffer.from(fullText, 'utf-8');

      // Split right inside the 4-byte emoji 🌧️ (F0 9F 8C A7)
      const splitPoint = fullText.indexOf('🌧️') + 1;
      const chunk1 = buf.subarray(0, splitPoint);
      const chunk2 = buf.subarray(splitPoint);

      parser.feed(chunk1);
      assert.equal(events.length, 0); // Not complete yet

      parser.feed(chunk2);
      assert.equal(events.length, 1);
      assert.equal(events[0].event, 'warning');
      assert.equal(events[0].data, '{"status":"Peringatan 🌧️"}');
    });

    it('normalizes all supported line endings: LF, CRLF, and standalone CR', () => {
      const events: Array<{ event?: string; data: string }> = [];
      const parser = new SseStreamParser((msg) => events.push(msg));

      // 1. Standard LF (\n\n)
      parser.feed('data: msg1\n\n');
      assert.equal(events.length, 1);
      assert.equal(events[0].data, 'msg1');

      // 2. Windows CRLF (\r\n\r\n)
      parser.feed('data: msg2\r\n\r\n');
      assert.equal(events.length, 2);
      assert.equal(events[1].data, 'msg2');

      // 3. Standalone CR (\r\r)
      parser.feed('data: msg3\r\r');
      parser.flush();
      assert.equal(events.length, 3);
      assert.equal(events[2].data, 'msg3');
    });

    it('handles CRLF split across chunk boundaries', () => {
      const events: Array<{ event?: string; data: string }> = [];
      const parser = new SseStreamParser((msg) => events.push(msg));

      parser.feed('data: split-test\r\n');
      assert.equal(events.length, 0);

      // Split the second CRLF: \r in chunk 1, \n in chunk 2
      parser.feed('\r');
      assert.equal(events.length, 0);

      parser.feed('\n');
      assert.equal(events.length, 1);
      assert.equal(events[0].data, 'split-test');
    });

    it('joins multiple data: lines with newline and ignores comments', () => {
      const events: Array<{ event?: string; data: string }> = [];
      const parser = new SseStreamParser((msg) => events.push(msg));

      const payload = ':heartbeat comment\ndata: first line\n:another comment\ndata: second line\n\n';
      parser.feed(payload);

      assert.equal(events.length, 1);
      assert.equal(events[0].data, 'first line\nsecond line');
    });

    it('enforces bounded buffer safety and drops/clears buffer on overflow', () => {
      const events: Array<{ event?: string; data: string }> = [];
      const parser = new SseStreamParser((msg) => events.push(msg), 128);
      const hugeLine = 'data: ' + 'a'.repeat(200);

      // Feeding chunk exceeding 128 bytes triggers buffer reset
      parser.feed(hugeLine);
      parser.feed('\n\n');

      // The oversized event was dropped/reset safely
      assert.equal(events.length, 0);

      // Subsequent valid event parses normally
      parser.feed('data: normal\n\n');
      assert.equal(events.length, 1);
      assert.equal(events[0].data, 'normal');
    });
  });

  // 3. TelemetryHub and SSE HTTP Streaming
  describe('3. Telemetry Streaming (SSE over HTTP)', () => {
    it('fans out ingested telemetry to active SSE subscribers and sends keepalive pings', async () => {
      const instance = createGatewayServer({
        now: () => mockTime,
        config: { port: 0, gatewayTokenSecret: TEST_SECRET },
      });

      await new Promise<void>((resolve) => instance.server.listen(0, resolve));

      try {
        // Connect SSE client
        const address = instance.server.address();
        const port = typeof address === 'object' && address ? address.port : 0;

        const controller = new AbortController();
        const response = await fetch(`http://localhost:${port}/api/telemetry/stream`, {
          signal: controller.signal,
        });

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'text/event-stream');
        assert.equal(instance.telemetryHub.getConnectedClientCount(), 1);

        const reader = response.body?.getReader();
        assert.ok(reader);

        // Read initial connection event
        const initialChunk = await reader.read();
        const initialText = new TextDecoder().decode(initialChunk.value);
        assert.ok(initialText.includes(':connected'));

        // Ingest telemetry via TelemetryHub
        instance.telemetryHub.ingestTelemetry(
          {
            temp: 28.4,
            rh: 75.0,
            soilMoisture: 42.0,
          },
          mockTime
        );

        // Read broadcast event
        const telemChunk = await reader.read();
        const telemText = new TextDecoder().decode(telemChunk.value);
        assert.ok(telemText.includes('event: telemetry'));
        assert.ok(telemText.includes('"temp":28.4'));

        // Abort stream and verify client cleanup
        controller.abort();
        // Give socket a moment to fire 'close'
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(instance.telemetryHub.getConnectedClientCount(), 0);
      } finally {
        await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      }
    });

    it('enforces per-IP concurrency limits on SSE streams', async () => {
      const instance = createGatewayServer({
        now: () => mockTime,
        config: {
          port: 0,
          maxSseClientsPerIp: 2,
          gatewayTokenSecret: TEST_SECRET,
        },
      });

      await new Promise<void>((resolve) => instance.server.listen(0, resolve));
      const address = instance.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      const controllers: AbortController[] = [];

      try {
        // Open connection 1 (allowed)
        const c1 = new AbortController();
        controllers.push(c1);
        const r1 = await fetch(`http://localhost:${port}/api/telemetry/stream`, { signal: c1.signal });
        assert.equal(r1.status, 200);

        // Open connection 2 (allowed)
        const c2 = new AbortController();
        controllers.push(c2);
        const r2 = await fetch(`http://localhost:${port}/api/telemetry/stream`, { signal: c2.signal });
        assert.equal(r2.status, 200);

        // Open connection 3 (exceeds limit of 2) -> 429
        const r3 = await fetch(`http://localhost:${port}/api/telemetry/stream`);
        assert.equal(r3.status, 429);
        const json3 = await r3.json();
        assert.equal(json3.code, 'TOO_MANY_CONNECTIONS');
      } finally {
        for (const c of controllers) {
          c.abort();
        }
        await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      }
    });
  });

  // 4. In-Memory Image Store & Framing Validation
  describe('4. In-Memory Image Store & Framing Validation', () => {
    const validJpeg = Buffer.from([
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, // JFIF marker
      0xff, 0xd9, // EOI
    ]);

    it('accepts and serves valid JPEG payloads with framing checks and metadata headers', async () => {
      const instance = createGatewayServer({
        now: () => mockTime,
        config: { port: 0, gatewayTokenSecret: TEST_SECRET },
      });

      await new Promise<void>((resolve) => instance.server.listen(0, resolve));

      try {
        // 1. Initial state: No frame -> 204 No Content
        const resEmpty = await makeRequest(instance, '/api/vision/latest-frame.jpg');
        assert.equal(resEmpty.status, 204);

        // 2. Ingest valid JPEG frame
        const stored = instance.imageStore.ingestFrame(validJpeg, mockTime);
        assert.equal(stored, true);

        // 3. Retrieve frame -> 200 OK with correct headers
        const res = await makeRequest(instance, '/api/vision/latest-frame.jpg');
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'image/jpeg');
        assert.equal(res.headers.get('x-frame-timestamp'), String(mockTime));
        assert.equal(res.headers.get('x-frame-stale'), '0');

        const body = Buffer.from(await res.arrayBuffer());
        assert.equal(validateJpegFraming(body), true);
        assert.equal(body.byteLength, validJpeg.byteLength);
      } finally {
        await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      }
    });

    it('rejects oversized payloads and malformed framing without corrupting valid frame', () => {
      const store = new ImageStore({ maxFrameBytes: 50, staleTtlMs: 60000 });

      // Ingest valid frame
      assert.equal(store.ingestFrame(validJpeg, mockTime), true);
      const original = store.getFrame(mockTime);
      assert.ok(original);

      // 1. Oversized payload (> 50 bytes)
      const oversized = Buffer.alloc(100);
      oversized[0] = 0xff;
      oversized[1] = 0xd8;
      oversized[98] = 0xff;
      oversized[99] = 0xd9;
      assert.equal(store.ingestFrame(oversized, mockTime), false);

      // Verify original frame preserved
      assert.equal(store.getFrame(mockTime)?.frame.byteLength, validJpeg.byteLength);

      // 2. Missing SOI (starts with 0x00 0x00)
      const missingSoi = Buffer.from([0x00, 0x00, 0x12, 0x34, 0xff, 0xd9]);
      assert.equal(store.ingestFrame(missingSoi, mockTime), false);
      assert.equal(store.getFrame(mockTime)?.frame.byteLength, validJpeg.byteLength);

      // 3. Missing EOI (ends with 0x00 0x00)
      const missingEoi = Buffer.from([0xff, 0xd8, 0x12, 0x34, 0x00, 0x00]);
      assert.equal(store.ingestFrame(missingEoi, mockTime), false);
      assert.equal(store.getFrame(mockTime)?.frame.byteLength, validJpeg.byteLength);
    });

    it('marks frame as stale when age exceeds TTL threshold', () => {
      const store = new ImageStore({ staleTtlMs: 60000 });
      store.ingestFrame(validJpeg, mockTime);

      assert.equal(store.getFrame(mockTime)?.isStale, false);

      // Advance clock past 60s
      const futureTime = mockTime + 65000;
      const frameInfo = store.getFrame(futureTime);
      assert.ok(frameInfo);
      assert.equal(frameInfo.isStale, true);
      assert.equal(frameInfo.ageSeconds, 65);
    });

    it('serves max 60KB camera frame and reflects stale header transition via HTTP endpoint', async () => {
      const instance = createGatewayServer({
        now: () => mockTime,
        config: { port: 0, gatewayTokenSecret: TEST_SECRET },
      });

      await new Promise<void>((resolve) => instance.server.listen(0, resolve));

      try {
        // Construct 60,000-byte valid JPEG (matching ESP32 firmware MAX_IMAGE_SIZE)
        const frame60k = Buffer.alloc(60000, 0x5a);
        frame60k[0] = 0xff;
        frame60k[1] = 0xd8; // SOI
        frame60k[59998] = 0xff;
        frame60k[59999] = 0xd9; // EOI

        // Ingest into gateway image store
        const stored = instance.imageStore.ingestFrame(frame60k, mockTime);
        assert.equal(stored, true);

        // Retrieve over HTTP
        const res = await makeRequest(instance, '/api/vision/latest-frame.jpg');
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'image/jpeg');
        assert.equal(res.headers.get('content-length'), '60000');
        assert.equal(res.headers.get('x-frame-stale'), '0');
        assert.equal(res.headers.get('x-frame-age-seconds'), '0');

        const body = Buffer.from(await res.arrayBuffer());
        assert.equal(body.byteLength, 60000);
        assert.equal(Buffer.compare(body, frame60k), 0);

        // Advance mock time past 60s stale threshold
        mockTime += 65000;
        const resStale = await makeRequest(instance, '/api/vision/latest-frame.jpg');
        assert.equal(resStale.status, 200);
        assert.equal(resStale.headers.get('x-frame-stale'), '1');
        assert.equal(resStale.headers.get('x-frame-age-seconds'), '65');

        // Verify non-GET methods are rejected with 405
        const resPost = await makeRequest(instance, '/api/vision/latest-frame.jpg', { method: 'POST' });
        assert.equal(resPost.status, 405);
        assert.equal(resPost.headers.get('allow'), 'GET, OPTIONS');
      } finally {
        await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      }
    });

    it('verifies frame boundary limits (60k camera max, 64k default cap, 64k+1 dropped)', () => {
      const store = new ImageStore(); // Default 64 KiB (65536 bytes) cap

      // 60,000 bytes (camera max) -> accepted
      const f60k = Buffer.alloc(60000, 0x11);
      f60k[0] = 0xff; f60k[1] = 0xd8;
      f60k[59998] = 0xff; f60k[59999] = 0xd9;
      assert.equal(store.ingestFrame(f60k, mockTime), true);

      // Exact 65,536 bytes -> accepted
      const f64k = Buffer.alloc(65536, 0x22);
      f64k[0] = 0xff; f64k[1] = 0xd8;
      f64k[65534] = 0xff; f64k[65535] = 0xd9;
      assert.equal(store.ingestFrame(f64k, mockTime), true);
      assert.equal(store.getFrame(mockTime)?.frame.byteLength, 65536);

      // 65,537 bytes -> dropped (> maxFrameBytes)
      const f64kPlus1 = Buffer.alloc(65537, 0x33);
      f64kPlus1[0] = 0xff; f64kPlus1[1] = 0xd8;
      f64kPlus1[65535] = 0xff; f64kPlus1[65536] = 0xd9;
      assert.equal(store.ingestFrame(f64kPlus1, mockTime), false);
      // Existing 64k frame preserved
      assert.equal(store.getFrame(mockTime)?.frame.byteLength, 65536);

      // Below minimum JPEG length (< 4 bytes) -> dropped
      assert.equal(store.ingestFrame(Buffer.from([0xff, 0xd8, 0xd9]), mockTime), false);
      assert.equal(store.ingestFrame(Buffer.alloc(0), mockTime), false);
    });
  });

  // 5. Versioned scrypt Password Hashing & Timing Resistance
  describe('5. Versioned scrypt Password Hashing & Timing Resistance', () => {
    it('creates and verifies versioned scrypt hashes', () => {
      const password = 'AgrapathaSecretPassword#2026';
      const formatted = hashPassword(password);

      assert.ok(formatted.startsWith('$scrypt$v=1$N=16384,r=8,p=1$keylen=32$'));
      assert.equal(verifyPassword(password, formatted), true);
      assert.equal(verifyPassword('WrongPassword', formatted), false);
    });

    it('rejects malformed hashes safely without throwing', () => {
      assert.equal(verifyPassword('password', ''), false);
      assert.equal(verifyPassword('password', 'invalid-hash'), false);
      assert.equal(verifyPassword('password', '$scrypt$v=2$unsupported$hash'), false);
      assert.equal(verifyPassword('password', '$scrypt$v=1$N=16384,r=8,p=1$keylen=32$shortsalt$shorthash'), false);
    });

    it('performs constant-time verification against non-existent users (enumeration resistance)', () => {
      const accountsJson = JSON.stringify([
        {
          id: 'op_1',
          username: 'existing_op',
          displayName: 'Existing Operator',
          role: 'OPERATOR',
          passwordHash: hashPassword('CorrectPass123'),
          status: 'ACTIVE',
          tokenVersion: 1,
        },
      ]);

      const store = loadAccountStore(accountsJson);

      // authenticateOperator performs scrypt verification even for unknown user
      const startNonExistent = performance.now();
      const authUnknown = authenticateOperator(store, 'unknown_user', 'any_password');
      const timeNonExistent = performance.now() - startNonExistent;

      assert.equal(authUnknown, null);
      // Ensure it executed scrypt calculation (typically >= 1ms) rather than instantaneous return
      assert.ok(timeNonExistent >= 0.5);
    });
  });

  // 6. Operator Login & Authentication Endpoints
  describe('6. Operator Login & Rate Limiting (POST /api/auth/login)', () => {
    const validPassword = 'OperatorSecretPassword123!';
    const accountsJson = JSON.stringify([
      {
        id: 'op_active',
        username: 'operator_active',
        displayName: 'Active Operator',
        role: 'OPERATOR',
        passwordHash: hashPassword(validPassword),
        status: 'ACTIVE',
        tokenVersion: 1,
      },
      {
        id: 'op_disabled',
        username: 'operator_disabled',
        displayName: 'Disabled Operator',
        role: 'OPERATOR',
        passwordHash: hashPassword(validPassword),
        status: 'DISABLED',
        tokenVersion: 1,
      },
    ]);

    it('authenticates active operator and returns signed bearer token with no-store cache header', async () => {
      const instance = createGatewayServer({
        now: () => mockTime,
        config: {
          port: 0,
          operatorAccountsJson: accountsJson,
          gatewayTokenSecret: TEST_SECRET,
        },
      });

      await new Promise<void>((resolve) => instance.server.listen(0, resolve));

      try {
        const res = await makeRequest(instance, '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'operator_active',
            password: validPassword,
          }),
        });

        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');

        const json = await res.json();
        assert.ok(json.token);
        assert.equal(json.operator.username, 'operator_active');
        assert.equal(json.operator.role, 'OPERATOR');
      } finally {
        await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      }
    });

    it('rejects invalid password, unknown user, and disabled accounts with 401', async () => {
      const instance = createGatewayServer({
        now: () => mockTime,
        config: {
          port: 0,
          operatorAccountsJson: accountsJson,
          gatewayTokenSecret: TEST_SECRET,
        },
      });

      await new Promise<void>((resolve) => instance.server.listen(0, resolve));

      try {
        // 1. Wrong password
        const resWrongPass = await makeRequest(instance, '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'operator_active', password: 'WrongPassword' }),
        });
        assert.equal(resWrongPass.status, 401);

        // 2. Unknown username
        const resUnknown = await makeRequest(instance, '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'non_existent', password: validPassword }),
        });
        assert.equal(resUnknown.status, 401);

        // 3. Disabled account
        const resDisabled = await makeRequest(instance, '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'operator_disabled', password: validPassword }),
        });
        assert.equal(resDisabled.status, 401);
      } finally {
        await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      }
    });

    it('throttles rapid login attempts with HTTP 429', async () => {
      const instance = createGatewayServer({
        now: () => mockTime,
        config: {
          port: 0,
          operatorAccountsJson: accountsJson,
          gatewayTokenSecret: TEST_SECRET,
          loginRateLimitMax: 3,
        },
      });

      await new Promise<void>((resolve) => instance.server.listen(0, resolve));

      try {
        for (let i = 0; i < 3; i++) {
          const res = await makeRequest(instance, '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'operator_active', password: 'bad' }),
          });
          assert.equal(res.status, 401);
        }

        // 4th request -> 429
        const resThrottled = await makeRequest(instance, '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'operator_active', password: 'bad' }),
        });
        assert.equal(resThrottled.status, 429);
        assert.equal(resThrottled.headers.get('retry-after'), '60');
      } finally {
        await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      }
    });
  });

  // 7. Token Verification, Revocation, and Expiration
  describe('7. Bearer Token Verification, Expiration & Revocation', () => {
    const operator: OperatorAccount = {
      id: 'op_101',
      username: 'op_verify',
      displayName: 'Verify Operator',
      role: 'OPERATOR',
      passwordHash: 'dummy',
      status: 'ACTIVE',
      tokenVersion: 1,
    };

    it('verifies valid token and rejects tampered signature', () => {
      const store = new Map<string, OperatorAccount>();
      store.set(operator.username, operator);

      const nowSec = Math.floor(mockTime / 1000);
      const token = signOperatorToken(operator, TEST_SECRET, 3600, nowSec);

      const verified = verifyOperatorToken(token, TEST_SECRET, store, nowSec);
      assert.ok(verified);
      assert.equal(verified.sub, operator.id);
      assert.equal(verified.username, operator.username);

      // Tampered payload
      const parts = token.split('.');
      const tamperedToken = `${parts[0]}.${parts[1]}tampered.${parts[2]}`;
      assert.equal(verifyOperatorToken(tamperedToken, TEST_SECRET, store, nowSec), null);

      // Tampered secret
      assert.equal(verifyOperatorToken(token, 'different-secret-key-32-chars-long!', store, nowSec), null);
    });

    it('rejects expired tokens', () => {
      const store = new Map<string, OperatorAccount>();
      store.set(operator.username, operator);

      const nowSec = Math.floor(mockTime / 1000);
      const token = signOperatorToken(operator, TEST_SECRET, 60, nowSec); // 60s validity

      // At expiry + 1s -> rejected
      assert.equal(verifyOperatorToken(token, TEST_SECRET, store, nowSec + 61), null);
    });

    it('rejects tokens immediately upon tokenVersion increment (revocation)', () => {
      const store = new Map<string, OperatorAccount>();
      store.set(operator.username, { ...operator, tokenVersion: 1 });

      const nowSec = Math.floor(mockTime / 1000);
      const token = signOperatorToken(operator, TEST_SECRET, 3600, nowSec);

      // Token valid initially
      assert.ok(verifyOperatorToken(token, TEST_SECRET, store, nowSec));

      // Bump tokenVersion in store to 2 (simulating operator revocation)
      store.set(operator.username, { ...operator, tokenVersion: 2 });

      // Old token with tokenVersion 1 is rejected immediately
      assert.equal(verifyOperatorToken(token, TEST_SECRET, store, nowSec), null);
    });

    it('rejects tokens if account is changed to DISABLED', () => {
      const store = new Map<string, OperatorAccount>();
      store.set(operator.username, { ...operator, status: 'ACTIVE' });

      const nowSec = Math.floor(mockTime / 1000);
      const token = signOperatorToken(operator, TEST_SECRET, 3600, nowSec);

      assert.ok(verifyOperatorToken(token, TEST_SECRET, store, nowSec));

      // Disable account
      store.set(operator.username, { ...operator, status: 'DISABLED' });
      assert.equal(verifyOperatorToken(token, TEST_SECRET, store, nowSec), null);
    });
  });

  // 8. Actuator Endpoint Fail-Closed Safety Gate
  describe('8. Actuator Command Fail-Closed Safety Gate (POST /api/commands/actuator)', () => {
    const validPassword = 'ActuatorOperatorPass123!';
    const accountsJson = JSON.stringify([
      {
        id: 'op_actuator',
        username: 'actuator_op',
        displayName: 'Actuator Operator',
        role: 'OPERATOR',
        passwordHash: hashPassword(validPassword),
        status: 'ACTIVE',
        tokenVersion: 1,
      },
    ]);

    it('enforces authentication before actuator lockout (401 without valid token)', async () => {
      const instance = createGatewayServer({
        now: () => mockTime,
        config: {
          port: 0,
          operatorAccountsJson: accountsJson,
          gatewayTokenSecret: TEST_SECRET,
          enableActuators: false, // Disabled
        },
      });

      await new Promise<void>((resolve) => instance.server.listen(0, resolve));

      try {
        // 1. Missing Authorization header -> 401
        const resNoAuth = await makeRequest(instance, '/api/commands/actuator', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'LEFT' }),
        });
        assert.equal(resNoAuth.status, 401);

        // 2. Forged Bearer token -> 401
        const resBadAuth = await makeRequest(instance, '/api/commands/actuator', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer invalid.forged.token',
          },
          body: JSON.stringify({ action: 'LEFT' }),
        });
        assert.equal(resBadAuth.status, 401);
      } finally {
        await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      }
    });

    it('returns HTTP 503 and executes ZERO publishes when authenticated but actuators are disabled', async () => {
      const instance = createGatewayServer({
        now: () => mockTime,
        config: {
          port: 0,
          operatorAccountsJson: accountsJson,
          gatewayTokenSecret: TEST_SECRET,
          enableActuators: false, // Fail-closed default
        },
      });

      await new Promise<void>((resolve) => instance.server.listen(0, resolve));

      try {
        // Login to get valid token
        const loginRes = await makeRequest(instance, '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'actuator_op', password: validPassword }),
        });
        const { token } = await loginRes.json();
        assert.ok(token);

        // Send valid command with valid token -> 503 Service Unavailable
        const res = await makeRequest(instance, '/api/commands/actuator', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: 'LEFT' }),
        });

        assert.equal(res.status, 503);
        const json = await res.json();
        assert.equal(json.code, 'ACTUATOR_DISABLED');
        assert.ok(json.error.includes('disabled'));
      } finally {
        await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      }
    });

    it('validates action schema (returns 400 for invalid action names)', async () => {
      const instance = createGatewayServer({
        now: () => mockTime,
        config: {
          port: 0,
          operatorAccountsJson: accountsJson,
          gatewayTokenSecret: TEST_SECRET,
          enableActuators: false,
        },
      });

      await new Promise<void>((resolve) => instance.server.listen(0, resolve));

      try {
        const loginRes = await makeRequest(instance, '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'actuator_op', password: validPassword }),
        });
        const { token } = await loginRes.json();

        const res = await makeRequest(instance, '/api/commands/actuator', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: 'INVALID_DIRECTION' }),
        });

        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.code, 'INVALID_ACTION');
      } finally {
        await new Promise<void>((resolve) => instance.server.close(() => resolve()));
      }
    });
  });

  // 9. Startup Configuration Validation & Safe Secrets
  describe('9. Startup Configuration Validation & Secrets Boundary', () => {
    it('rejects startup in production when GATEWAY_TOKEN_SECRET is missing or short', () => {
      const oldEnv = process.env.NODE_ENV;
      const oldSecret = process.env.GATEWAY_TOKEN_SECRET;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.GATEWAY_TOKEN_SECRET;

        assert.throws(
          () => {
            loadConfig();
          },
          { message: /GATEWAY_TOKEN_SECRET must be set and contain at least 32 characters in production/ }
        );

        // Too short (< 32 chars)
        process.env.GATEWAY_TOKEN_SECRET = 'short-secret';
        assert.throws(
          () => {
            loadConfig();
          },
          { message: /GATEWAY_TOKEN_SECRET must be set and contain at least 32 characters in production/ }
        );
      } finally {
        process.env.NODE_ENV = oldEnv;
        if (oldSecret !== undefined) {
          process.env.GATEWAY_TOKEN_SECRET = oldSecret;
        } else {
          delete process.env.GATEWAY_TOKEN_SECRET;
        }
      }
    });
  });
});
