import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGatewayTelemetry,
  subscribeGatewayTelemetry,
  fetchLatestCameraFrame,
  checkGatewayHealth,
  GatewayHttpError,
  type GatewayTelemetryPayload,
  type GatewayConnectionStatus,
} from './gatewayService.ts';

// Deterministic in-memory Mock EventSource
class MockEventSource {
  public static lastCreated: MockEventSource | null = null;
  public url: string;
  public closed = false;
  private listeners: Map<string, Set<EventListener>> = new Map();

  public static getLastCreated(): MockEventSource {
    assert.ok(MockEventSource.lastCreated, 'Expected MockEventSource to have been created');
    return MockEventSource.lastCreated;
  }

  constructor(url: string) {
    this.url = url;
    MockEventSource.lastCreated = this;
  }

  public addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  public close(): void {
    this.closed = true;
  }

  // Test helpers to simulate server events
  public simulateOpen(): void {
    const handlers = this.listeners.get('open');
    if (handlers) {
      for (const h of handlers) {
        h(new Event('open'));
      }
    }
  }

  public simulateTelemetry(data: unknown): void {
    const handlers = this.listeners.get('telemetry');
    if (handlers) {
      const msgEvent = {
        type: 'telemetry',
        data: typeof data === 'string' ? data : JSON.stringify(data),
      } as MessageEvent;
      for (const h of handlers) {
        h(msgEvent);
      }
    }
  }

  public simulateError(errEvent: Event = new Event('error')): void {
    const handlers = this.listeners.get('error');
    if (handlers) {
      for (const h of handlers) {
        h(errEvent);
      }
    }
  }

  public getListenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe('Gateway Service Client Tests', () => {
  // --------------------------------------------------------------------------
  // 1. Telemetry Payload Parsing & Validation
  // --------------------------------------------------------------------------
  describe('1. parseGatewayTelemetry', () => {
    test('parses full valid backend telemetry payload matching PublicTelemetryPayload contract', () => {
      const validPayload: GatewayTelemetryPayload = {
        temp: 28.5,
        rh: 65.2,
        soilMoisture: 42.0,
        soilRaw: 2100,
        rain: 1.5,
        rainStatus: 'GERIMIS',
        wind: null,
        lightLux: 45000,
        ldrRaw: 1500,
        gasPpm: null,
        mq135Raw: null,
        flameDetected: null,
        flameRaw: null,
        motorState: 'STOPPED',
        motorDriver: 'L298N_OUT3_OUT4',
        limitLeft: false,
        limitRight: true,
        uptimeSeconds: 1200,
        visionPrediction: 'Smoke',
        visionConfidence: 0.89,
        imageReady: true,
        freshness: 'FRESH',
        timestamp: 1700000000000,
      };

      const result = parseGatewayTelemetry(JSON.stringify(validPayload));
      assert.deepEqual(result, validPayload);
    });

    test('parses payload with partial nullable fields safely', () => {
      const partial = {
        temp: 30.1,
        rh: null,
        soilMoisture: null,
        soilRaw: null,
        rain: null,
        rainStatus: null,
        lightLux: 35000,
        ldrRaw: null,
        motorState: null,
        motorDriver: null,
        limitLeft: null,
        limitRight: null,
        uptimeSeconds: null,
        visionPrediction: null,
        visionConfidence: null,
        imageReady: null,
        freshness: 'STALE',
        timestamp: 1700000005000,
      };

      const result = parseGatewayTelemetry(partial);
      assert.ok(result);
      assert.equal(result?.temp, 30.1);
      assert.equal(result?.rh, null);
      assert.equal(result?.lightLux, 35000);
      assert.equal(result?.freshness, 'STALE');
      assert.equal(result?.timestamp, 1700000005000);
    });

    test('parses MQ-135 raw ADC without conflating with calibrated gas concentration', () => {
      const payload = {
        temp: 26.8,
        rh: 72.0,
        soilMoisture: 60.0,
        soilRaw: 1800,
        mq135_raw: 1530,
        flame_detected: 0,
        flame_raw: 3900,
        freshness: 'FRESH',
        timestamp: 1700000008000,
      };

      const result = parseGatewayTelemetry(payload);
      assert.ok(result);
      assert.equal(result.mq135Raw, 1530);
      assert.equal(result.gasPpm, null, 'Raw ADC must not be set as gasPpm');
      assert.equal(result.flameDetected, 0);
      assert.equal(result.flameRaw, 3900);
      assert.equal(result.rain, null);
      assert.equal(result.lightLux, null);
    });

    test('parses calibrated gas_ppm and active flame detection correctly', () => {
      const payload = {
        temp: 27.0,
        rh: 50.0,
        soilMoisture: 30.0,
        gas_ppm: 620,
        mq135_raw: 2100,
        flame_detected: 1,
        flame_raw: 450,
        freshness: 'FRESH',
        timestamp: 1700000009000,
      };

      const result = parseGatewayTelemetry(payload);
      assert.ok(result);
      assert.equal(result.mq135Raw, 2100);
      assert.equal(result.gasPpm, 620);
      assert.equal(result.flameDetected, 1);
      assert.equal(result.flameRaw, 450);
    });

    test('rejects null, undefined, empty, or malformed JSON strings without throwing', () => {
      assert.equal(parseGatewayTelemetry(null), null);
      assert.equal(parseGatewayTelemetry(undefined), null);
      assert.equal(parseGatewayTelemetry(''), null);
      assert.equal(parseGatewayTelemetry('{ invalid json ]'), null);
      assert.equal(parseGatewayTelemetry(42), null);
      assert.equal(parseGatewayTelemetry([]), null);
    });

    test('rejects payload missing timestamp or with non-finite timestamp', () => {
      const missingTs = {
        temp: 25.0,
        freshness: 'FRESH',
      };
      assert.equal(parseGatewayTelemetry(missingTs), null);

      const invalidTs = {
        temp: 25.0,
        freshness: 'FRESH',
        timestamp: NaN,
      };
      assert.equal(parseGatewayTelemetry(invalidTs), null);
    });

    test('rejects payload missing freshness or with invalid freshness value', () => {
      const missingFreshness = {
        temp: 25.0,
        timestamp: 1700000000000,
      };
      assert.equal(parseGatewayTelemetry(missingFreshness), null);

      const invalidFreshness = {
        temp: 25.0,
        freshness: 'UNKNOWN_STATUS',
        timestamp: 1700000000000,
      };
      assert.equal(parseGatewayTelemetry(invalidFreshness), null);
    });

    test('strips unknown sensitive extra fields without failing', () => {
      const payloadWithExtras = {
        temp: 27.0,
        freshness: 'FRESH',
        timestamp: 1700000000000,
        internalMac: 'AA:BB:CC:DD:EE:FF',
        secretToken: 'leak-attempt',
      };

      const result = parseGatewayTelemetry(payloadWithExtras);
      assert.ok(result);
      assert.equal(result?.temp, 27.0);
      assert.equal((result as unknown as Record<string, unknown>).internalMac, undefined);
      assert.equal((result as unknown as Record<string, unknown>).secretToken, undefined);
    });
  });

  // --------------------------------------------------------------------------
  // 2. SSE Telemetry Stream Subscription
  // --------------------------------------------------------------------------
  describe('2. subscribeGatewayTelemetry', () => {
    test('subscribes to named "telemetry" event and dispatches connection lifecycle', () => {
      MockEventSource.lastCreated = null;
      const receivedPayloads: GatewayTelemetryPayload[] = [];
      const statusHistory: GatewayConnectionStatus[] = [];

      const unsubscribe = subscribeGatewayTelemetry({
        baseUrl: 'http://localhost:3000',
        EventSourceClass: MockEventSource as unknown as typeof EventSource,
        onTelemetry: (payload) => receivedPayloads.push(payload),
        onStatusChange: (status) => statusHistory.push(status),
      });

      const instance = MockEventSource.getLastCreated();
      assert.equal(instance.url, 'http://localhost:3000/api/telemetry/stream');
      assert.deepEqual(statusHistory, ['connecting']);

      // 1. Simulate stream open
      instance.simulateOpen();
      assert.deepEqual(statusHistory, ['connecting', 'connected']);

      // 2. Simulate named telemetry event
      const testTelemetry: GatewayTelemetryPayload = {
        temp: 29.0,
        rh: 70.0,
        soilMoisture: 35.0,
        soilRaw: 2200,
        rain: 0,
        rainStatus: 'KERING',
        wind: null,
        lightLux: 40000,
        ldrRaw: 1600,
        gasPpm: null,
        mq135Raw: null,
        flameDetected: null,
        flameRaw: null,
        motorState: 'STOPPED',
        motorDriver: 'L298N_OUT3_OUT4',
        limitLeft: false,
        limitRight: false,
        uptimeSeconds: 500,
        visionPrediction: 'Healthy',
        visionConfidence: 0.95,
        imageReady: false,
        freshness: 'FRESH',
        timestamp: 1700000010000,
      };

      instance.simulateTelemetry(testTelemetry);
      assert.equal(receivedPayloads.length, 1);
      assert.deepEqual(receivedPayloads[0], testTelemetry);

      // 3. Cleanup
      unsubscribe();
      assert.equal(instance.closed, true);
      assert.equal(statusHistory[statusHistory.length - 1], 'closed');
      assert.equal(instance.getListenerCount('telemetry'), 0);
      assert.equal(instance.getListenerCount('open'), 0);
      assert.equal(instance.getListenerCount('error'), 0);
    });

    test('ignores malformed JSON telemetry events without crashing or invoking callback', () => {
      MockEventSource.lastCreated = null;
      const receivedPayloads: GatewayTelemetryPayload[] = [];

      subscribeGatewayTelemetry({
        EventSourceClass: MockEventSource as unknown as typeof EventSource,
        onTelemetry: (payload) => receivedPayloads.push(payload),
      });

      const instance = MockEventSource.getLastCreated();
      instance.simulateOpen();

      // Malformed event
      instance.simulateTelemetry('{ broken json');
      // Incomplete schema event
      instance.simulateTelemetry({ temp: 30 }); // missing timestamp and freshness

      assert.equal(receivedPayloads.length, 0);
    });

    test('handles stream errors and notifies status and onError callback', () => {
      MockEventSource.lastCreated = null;
      const statusHistory: GatewayConnectionStatus[] = [];
      let reportedError: Event | Error | null = null;

      subscribeGatewayTelemetry({
        EventSourceClass: MockEventSource as unknown as typeof EventSource,
        onTelemetry: () => {},
        onStatusChange: (status) => statusHistory.push(status),
        onError: (err) => {
          reportedError = err;
        },
      });

      const instance = MockEventSource.getLastCreated();
      const customError = new Event('error');
      instance.simulateError(customError);

      assert.equal(statusHistory.includes('error'), true);
      assert.equal(reportedError, customError);
    });

    test('handles missing EventSource runtime safely', () => {
      const statusHistory: GatewayConnectionStatus[] = [];
      let reportedError: unknown = null;

      const unsubscribe = subscribeGatewayTelemetry({
        EventSourceClass: undefined, // Simulates no EventSource in global scope
        onTelemetry: () => {},
        onStatusChange: (status) => statusHistory.push(status),
        onError: (err) => {
          reportedError = err;
        },
      });

      assert.equal(statusHistory.includes('error'), true);
      assert.ok(reportedError instanceof Error);
      assert.match(reportedError.message, /EventSource is not supported/);

      // Calling unsubscribe should be safe no-op
      assert.doesNotThrow(() => unsubscribe());
    });
  });

  // --------------------------------------------------------------------------
  // 3. Camera Frame Fetching
  // --------------------------------------------------------------------------
  describe('3. fetchLatestCameraFrame', () => {
    test('returns JPEG blob and parsed metadata on HTTP 200', async () => {
      const mockJpegBytes = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
      const mockBlob = new Blob([mockJpegBytes], { type: 'image/jpeg' });

      const mockFetch: typeof fetch = async (input, init) => {
        assert.equal(input, '/api/vision/latest-frame.jpg');
        assert.equal(init?.method, 'GET');

        return new Response(mockBlob, {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'X-Frame-Timestamp': '1700000000000',
            'X-Frame-Age-Seconds': '4',
            'X-Frame-Stale': '0',
          },
        });
      };

      const result = await fetchLatestCameraFrame({ fetchFn: mockFetch });
      assert.equal(result.hasFrame, true);
      assert.ok(result.frame);
      assert.equal(result.frame?.byteLength, mockJpegBytes.byteLength);
      assert.equal(result.frame?.receivedAt, 1700000000000);
      assert.equal(result.frame?.ageSeconds, 4);
      assert.equal(result.frame?.isStale, false);
    });

    test('marks isStale true when X-Frame-Stale is "1"', async () => {
      const mockBlob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

      const mockFetch: typeof fetch = async () => {
        return new Response(mockBlob, {
          status: 200,
          headers: {
            'X-Frame-Timestamp': '1700000000000',
            'X-Frame-Age-Seconds': '65',
            'X-Frame-Stale': '1',
          },
        });
      };

      const result = await fetchLatestCameraFrame({ fetchFn: mockFetch });
      assert.equal(result.hasFrame, true);
      assert.equal(result.frame?.isStale, true);
      assert.equal(result.frame?.ageSeconds, 65);
    });

    test('handles HTTP 204 as valid no-frame-yet condition returning null frame', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(null, { status: 204 });
      };

      const result = await fetchLatestCameraFrame({ fetchFn: mockFetch });
      assert.equal(result.hasFrame, false);
      assert.equal(result.frame, null);
    });

    test('throws GatewayHttpError on non-success HTTP status (500, 404)', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response('Internal Server Error', { status: 500 });
      };

      await assert.rejects(
        () => fetchLatestCameraFrame({ fetchFn: mockFetch }),
        (err: unknown) => {
          assert.ok(err instanceof GatewayHttpError);
          assert.equal((err as GatewayHttpError).statusCode, 500);
          return true;
        }
      );
    });

    test('propagates network failure with descriptive error', async () => {
      const mockFetch: typeof fetch = async () => {
        throw new Error('Connection refused');
      };

      await assert.rejects(
        () => fetchLatestCameraFrame({ fetchFn: mockFetch }),
        /Network failure fetching camera frame: Connection refused/
      );
    });

    test('accepts maximum camera frame (60 KB) preserving byteLength and blob fidelity', async () => {
      const f60k = new Uint8Array(60000);
      f60k[0] = 0xff; f60k[1] = 0xd8;
      f60k[59998] = 0xff; f60k[59999] = 0xd9;
      const mockBlob = new Blob([f60k], { type: 'image/jpeg' });

      const mockFetch: typeof fetch = async () => {
        return new Response(mockBlob, {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': '60000',
            'X-Frame-Timestamp': '1700000000000',
            'X-Frame-Age-Seconds': '2',
            'X-Frame-Stale': '0',
          },
        });
      };

      const result = await fetchLatestCameraFrame({ fetchFn: mockFetch });
      assert.equal(result.hasFrame, true);
      assert.ok(result.frame);
      assert.equal(result.frame?.byteLength, 60000);
      assert.equal(result.frame?.blob.size, 60000);
      assert.equal(result.frame?.isStale, false);
      assert.equal(result.frame?.ageSeconds, 2);
    });

    test('aborts frame fetch cleanly when AbortSignal is cancelled', async () => {
      const controller = new AbortController();
      controller.abort();

      const mockFetch: typeof fetch = async (_input, init) => {
        if (init?.signal?.aborted) {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        }
        return new Response(null, { status: 204 });
      };

      await assert.rejects(
        () => fetchLatestCameraFrame({ fetchFn: mockFetch, signal: controller.signal }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.equal(err.name, 'AbortError');
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // 4. Gateway Health Check
  // --------------------------------------------------------------------------
  describe('4. checkGatewayHealth', () => {
    test('returns parsed health response on HTTP 200 with active MQTT connection', async () => {
      const healthData = {
        status: 'ok',
        service: 'agrapatha-bmkg-gateway',
        uptimeSeconds: 360,
        mqttConnected: true,
        actuatorsEnabled: false,
      };

      const mockFetch: typeof fetch = async (input) => {
        assert.equal(input, '/health');
        return new Response(JSON.stringify(healthData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const health = await checkGatewayHealth({ fetchFn: mockFetch });
      assert.deepEqual(health, healthData);
      assert.equal(health.mqttConnected, true);
      assert.equal(health.actuatorsEnabled, false);
    });

    test('correctly reflects mqttConnected: false when broker is disconnected', async () => {
      const healthData = {
        status: 'ok',
        service: 'agrapatha-bmkg-gateway',
        uptimeSeconds: 15,
        mqttConnected: false,
        actuatorsEnabled: false,
      };

      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify(healthData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const health = await checkGatewayHealth({ fetchFn: mockFetch });
      assert.equal(health.mqttConnected, false);
    });

    test('throws GatewayHttpError on non-200 HTTP response', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 });
      };

      await assert.rejects(
        () => checkGatewayHealth({ fetchFn: mockFetch }),
        (err: unknown) => {
          assert.ok(err instanceof GatewayHttpError);
          assert.equal((err as GatewayHttpError).statusCode, 503);
          return true;
        }
      );
    });

    test('throws on malformed JSON or invalid schema from health endpoint', async () => {
      const mockFetchMalformed: typeof fetch = async () => {
        return new Response('Not JSON', { status: 200 });
      };

      await assert.rejects(
        () => checkGatewayHealth({ fetchFn: mockFetchMalformed }),
        /Malformed JSON received from health endpoint/
      );

      const mockFetchInvalidSchema: typeof fetch = async () => {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };

      await assert.rejects(
        () => checkGatewayHealth({ fetchFn: mockFetchInvalidSchema }),
        /Invalid health response schema from gateway/
      );
    });

    test('propagates network error with descriptive message', async () => {
      const mockFetch: typeof fetch = async () => {
        throw new Error('DNS lookup failed');
      };

      await assert.rejects(
        () => checkGatewayHealth({ fetchFn: mockFetch }),
        /Network failure checking gateway health: DNS lookup failed/
      );
    });
  });
});
