import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createGatewayServer, type GatewayInstance } from '../src/server.ts';
import type { FetchFunction } from '../src/types.ts';

describe('Agrapatha BMKG Gateway Test Suite', () => {
  let mockTime = 1700000000000;
  const advanceTime = (ms: number) => {
    mockTime += ms;
  };

  const sampleForecastJson = JSON.stringify({
    data: [
      {
        cuaca: [
          [
            {
              datetime: '2026-10-16 00:00:00',
              t: 28,
              hu: 75,
              ws: 10,
              wd: 'SW',
              weather_desc: 'Cerah Berawan',
            },
          ],
        ],
      },
    ],
  });

  const sampleNowcastXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Peringatan Dini Cuaca</title>
    <item>
      <title>Peringatan Dini Cuaca Jakarta</title>
      <description>Hujan sedang hingga lebat</description>
    </item>
  </channel>
</rss>`;

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

  // 1. Health check test
  it('1. Health response succeeds without any upstream call', async () => {
    let upstreamCalled = false;
    const mockFetch: FetchFunction = async () => {
      upstreamCalled = true;
      throw new Error('Upstream should not be called');
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: { port: 0 },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      const res = await makeRequest(instance, '/health');
      assert.equal(res.status, 200);
      assert.equal(upstreamCalled, false);
      const json = await res.json();
      assert.equal(json.status, 'ok');
      assert.equal(json.service, 'agrapatha-bmkg-gateway');
      assert.equal(typeof json.uptimeSeconds, 'number');
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 2. Valid ADM4 reaches only the fixed forecast URL
  it('2. Valid ADM4 reaches only the fixed forecast URL', async () => {
    let capturedUrl = '';
    const mockFetch: FetchFunction = async (url) => {
      capturedUrl = String(url);
      return new Response(sampleForecastJson, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: { port: 0 },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      const res = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(res.status, 200);
      assert.equal(
        capturedUrl,
        'https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=31.71.01.1001'
      );
      const data = await res.json();
      assert.ok(data.data);
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 3. Missing, malformed, duplicate, and traversal-like ADM4 values are rejected
  it('3. Missing, malformed, duplicate, and traversal-like ADM4 values are rejected', async () => {
    let upstreamCalled = false;
    const mockFetch: FetchFunction = async () => {
      upstreamCalled = true;
      return new Response(sampleForecastJson);
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: { port: 0 },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      // Missing
      const resMissing = await makeRequest(instance, '/api/bmkg/forecast');
      assert.equal(resMissing.status, 400);
      const jsonMissing = await resMissing.json();
      assert.equal(jsonMissing.code, 'INVALID_PARAMS');

      // Duplicate
      const resDuplicate = await makeRequest(
        instance,
        '/api/bmkg/forecast?adm4=31.71.01.1001&adm4=31.71.01.1002'
      );
      assert.equal(resDuplicate.status, 400);
      const jsonDuplicate = await resDuplicate.json();
      assert.equal(jsonDuplicate.code, 'INVALID_PARAMS');

      // Path traversal
      const resTraversal = await makeRequest(instance, '/api/bmkg/forecast?adm4=../../evil');
      assert.equal(resTraversal.status, 400);
      const jsonTraversal = await resTraversal.json();
      assert.equal(jsonTraversal.code, 'INVALID_ADM4');

      // Incomplete ADM4
      const resIncomplete = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71');
      assert.equal(resIncomplete.status, 400);

      // Non-numeric
      const resAlpha = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.XX.1001');
      assert.equal(resAlpha.status, 400);

      assert.equal(upstreamCalled, false);
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 4. Unknown routes and unsupported methods are handled correctly
  it('4. Unknown routes and unsupported methods are handled correctly', async () => {
    const instance = createGatewayServer({
      now: () => mockTime,
      config: { port: 0 },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      // 404 Unknown route
      const res404 = await makeRequest(instance, '/api/unknown');
      assert.equal(res404.status, 404);
      const json404 = await res404.json();
      assert.equal(json404.code, 'NOT_FOUND');

      // 405 Method Not Allowed on /health
      const resHealthPost = await makeRequest(instance, '/health', { method: 'POST' });
      assert.equal(resHealthPost.status, 405);
      assert.equal(resHealthPost.headers.get('allow'), 'GET, OPTIONS');

      // 405 Method Not Allowed on /api/bmkg/forecast
      const resForecastPost = await makeRequest(instance, '/api/bmkg/forecast', {
        method: 'POST',
      });
      assert.equal(resForecastPost.status, 405);
      assert.equal(resForecastPost.headers.get('allow'), 'GET, OPTIONS');
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 5. Allowed CORS origin receives the correct allow-origin header
  it('5. Allowed CORS origin receives the correct allow-origin header', async () => {
    const mockFetch: FetchFunction = async () =>
      new Response(sampleForecastJson, { status: 200, headers: { 'content-type': 'application/json' } });

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: {
        port: 0,
        allowedOrigins: new Set(['https://flora-six-zeta.vercel.app', 'http://localhost:5173']),
      },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      // GET request with allowed origin
      const resGet = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001', {
        headers: { Origin: 'https://flora-six-zeta.vercel.app' },
      });
      assert.equal(resGet.status, 200);
      assert.equal(
        resGet.headers.get('access-control-allow-origin'),
        'https://flora-six-zeta.vercel.app'
      );
      assert.equal(resGet.headers.get('vary'), 'Origin');

      // Preflight OPTIONS with allowed origin
      const resOptions = await makeRequest(instance, '/api/bmkg/forecast', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      });
      assert.equal(resOptions.status, 204);
      assert.equal(
        resOptions.headers.get('access-control-allow-origin'),
        'http://localhost:5173'
      );
      assert.ok(resOptions.headers.get('access-control-allow-methods')?.includes('GET'));
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 6. Disallowed origin does not receive permissive CORS headers
  it('6. Disallowed origin does not receive permissive CORS headers', async () => {
    const mockFetch: FetchFunction = async () =>
      new Response(sampleForecastJson, { status: 200, headers: { 'content-type': 'application/json' } });

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: {
        port: 0,
        allowedOrigins: new Set(['https://flora-six-zeta.vercel.app']),
      },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      // Disallowed origin on GET
      const resGet = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001', {
        headers: { Origin: 'https://malicious-site.com' },
      });
      assert.equal(resGet.headers.get('access-control-allow-origin'), null);

      // Disallowed origin on OPTIONS preflight
      const resOptions = await makeRequest(instance, '/api/bmkg/forecast', {
        method: 'OPTIONS',
        headers: { Origin: 'https://malicious-site.com' },
      });
      assert.equal(resOptions.status, 403);
      assert.equal(resOptions.headers.get('access-control-allow-origin'), null);
      const json = await resOptions.json();
      assert.equal(json.code, 'CORS_FORBIDDEN');
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 7. Missing production-origin configuration does not silently enable wildcard access
  it('7. Missing production-origin configuration does not silently enable wildcard access', async () => {
    const instance = createGatewayServer({
      now: () => mockTime,
      config: {
        port: 0,
        allowedOrigins: new Set(['http://localhost:5173']),
      },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      const res = await makeRequest(instance, '/health', {
        headers: { Origin: 'https://arbitrary-project.vercel.app' },
      });
      assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
      assert.equal(res.headers.get('access-control-allow-origin'), null);
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 8. Upstream timeout returns a controlled gateway error (504)
  it('8. Upstream timeout returns a controlled gateway error', async () => {
    const mockFetch: FetchFunction = async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new Error('AbortError');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: {
        port: 0,
        upstreamTimeoutMs: 50, // Short timeout for testing
      },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      const res = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(res.status, 504);
      const json = await res.json();
      assert.equal(json.code, 'GATEWAY_TIMEOUT');
      assert.equal(json.error, 'BMKG upstream request timed out');
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 9. Upstream non-success status is handled safely (502)
  it('9. Upstream non-success status is handled safely', async () => {
    const mockFetch: FetchFunction = async () => {
      return new Response('BMKG Internal Error', { status: 500 });
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: { port: 0 },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      const res = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(res.status, 502);
      const json = await res.json();
      assert.equal(json.code, 'BMKG_UPSTREAM_ERROR');
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 10. Malformed or unexpected upstream responses are handled safely
  it('10. Malformed or unexpected upstream responses are handled safely', async () => {
    const mockFetch: FetchFunction = async () => {
      throw new Error('Socket hang up abruptly');
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: { port: 0 },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      const res = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(res.status, 502);
      const json = await res.json();
      assert.equal(json.code, 'BMKG_UPSTREAM_ERROR');
      assert.equal(json.error, 'BMKG upstream service unavailable');
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 11. Oversized response streams are rejected before unlimited buffering
  it('11. Oversized response streams are rejected before unlimited buffering', async () => {
    // Generate a stream exceeding the 512 KiB cap
    const chunk = new Uint8Array(64 * 1024); // 64 KiB
    let streamCancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        streamCancelled = true;
      },
    });

    const mockFetch: FetchFunction = async () => {
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: {
        port: 0,
        maxForecastBytes: 128 * 1024, // 128 KiB limit
      },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      const res = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(res.status, 502);
      assert.equal(streamCancelled, true);
      const json = await res.json();
      assert.equal(json.code, 'PAYLOAD_TOO_LARGE');
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 12. Sequential cache hits do not call upstream again before TTL expiration
  it('12. Sequential cache hits do not call upstream again before TTL expiration', async () => {
    let callCount = 0;
    const mockFetch: FetchFunction = async () => {
      callCount++;
      return new Response(sampleForecastJson, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: {
        port: 0,
        forecastCacheTtlMs: 10000, // 10 seconds
      },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      // 1. First call: Cache MISS
      const res1 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(res1.status, 200);
      assert.equal(res1.headers.get('x-cache'), 'MISS');
      assert.equal(callCount, 1);

      // 2. Second call within TTL: Cache HIT
      advanceTime(5000);
      const res2 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(res2.status, 200);
      assert.equal(res2.headers.get('x-cache'), 'HIT');
      assert.equal(callCount, 1); // No new fetch

      // 3. Third call after TTL expiration: Cache MISS
      advanceTime(6000); // 11s total > 10s TTL
      const res3 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(res3.status, 200);
      assert.equal(res3.headers.get('x-cache'), 'MISS');
      assert.equal(callCount, 2); // Re-fetched
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 13. Concurrent identical misses trigger exactly one upstream request (Coalescing)
  it('13. Concurrent identical misses trigger exactly one upstream request', async () => {
    let callCount = 0;
    const mockFetch: FetchFunction = async () => {
      callCount++;
      // Simulate 50ms upstream processing
      await new Promise((r) => setTimeout(r, 50));
      return new Response(sampleForecastJson, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: { port: 0 },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      // Fire 10 concurrent requests for the exact same ADM4
      const promises = Array.from({ length: 10 }).map(() =>
        makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001')
      );

      const responses = await Promise.all(promises);
      for (const res of responses) {
        assert.equal(res.status, 200);
      }

      // Exactly 1 upstream fetch must have been dispatched
      assert.equal(callCount, 1);
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 14. Cache and rate-limit storage remain bounded (LRU eviction)
  it('14. Cache and rate-limit storage remain bounded', async () => {
    const mockFetch: FetchFunction = async () => {
      return new Response(sampleForecastJson, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: {
        port: 0,
        forecastCacheMaxEntries: 3, // Bound capacity to 3
        rateLimitMaxEntries: 3,
        rateLimitMaxRequests: 100,
      },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      // Fill cache with 3 entries
      await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1002');
      await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1003');
      assert.equal(instance.forecastCache.size(), 3);

      // Access entry 1 to mark it recently used
      advanceTime(10);
      await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');

      // Add 4th entry -> should evict entry 2 (LRU)
      advanceTime(10);
      await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1004');
      assert.equal(instance.forecastCache.size(), 3);
      assert.equal(instance.forecastCache.has('forecast:31.71.01.1002'), false);
      assert.equal(instance.forecastCache.has('forecast:31.71.01.1001'), true);
      assert.equal(instance.forecastCache.has('forecast:31.71.01.1004'), true);

      // Verify rate limiter size is also strictly bounded
      assert.ok(instance.rateLimiter.getEntryCount() <= 3);
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 15. Failed upstream requests do not poison the cache or in-flight map
  it('15. Failed upstream requests do not poison the cache or in-flight map', async () => {
    let failFirst = true;
    const mockFetch: FetchFunction = async () => {
      if (failFirst) {
        failFirst = false;
        throw new Error('Temporary network drop');
      }
      return new Response(sampleForecastJson, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: { port: 0 },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      // 1. First call fails
      const resFail = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(resFail.status, 502);

      // In-flight map and cache must be clean
      assert.equal(instance.coalescer.getInFlightCount(), 0);
      assert.equal(instance.forecastCache.has('forecast:31.71.01.1001'), false);

      // 2. Second call succeeds immediately
      const resSuccess = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(resSuccess.status, 200);
      assert.equal(instance.forecastCache.has('forecast:31.71.01.1001'), true);
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 16. Redirects to arbitrary hosts are not followed
  it('16. Redirects to arbitrary hosts are not followed', async () => {
    const mockFetch: FetchFunction = async () => {
      // Mock redirect to malicious domain
      return new Response(null, {
        status: 302,
        headers: {
          location: 'https://evil-attacker-site.com/steal-data',
        },
      });
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: { port: 0 },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      const res = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(res.status, 502);
      const json = await res.json();
      assert.equal(json.code, 'REDIRECT_BLOCKED');
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 17. Errors never expose stack traces or local paths
  it('17. Errors never expose stack traces or local paths', async () => {
    const mockFetch: FetchFunction = async () => {
      throw new Error('Fatal internal error with path D:\\binus\\BINUS\\secret.key');
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: { port: 0 },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      const res = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(res.status, 502);
      const rawText = await res.text();

      // Ensure no stack traces or path fragments are exposed
      assert.ok(!rawText.includes('D:\\'));
      assert.ok(!rawText.includes('secret.key'));
      assert.ok(!rawText.includes('at ')); // stack trace lines like "at Object..."
      assert.ok(!rawText.includes('Error: Fatal'));
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // Nowcast XML feed integration test
  it('18. Nowcast endpoint successfully proxies XML feed with 5-minute cache', async () => {
    let callCount = 0;
    const mockFetch: FetchFunction = async (url) => {
      callCount++;
      assert.equal(url, 'https://www.bmkg.go.id/alerts/nowcast/id');
      return new Response(sampleNowcastXml, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
      });
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: {
        port: 0,
        nowcastCacheTtlMs: 300000, // 5 min
      },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      // First request: MISS
      const res1 = await makeRequest(instance, '/api/bmkg/nowcast/id');
      assert.equal(res1.status, 200);
      assert.equal(res1.headers.get('content-type'), 'application/rss+xml; charset=utf-8');
      assert.equal(res1.headers.get('x-cache'), 'MISS');
      const text1 = await res1.text();
      assert.ok(text1.includes('Peringatan Dini Cuaca Jakarta'));
      assert.equal(callCount, 1);

      // Second request: HIT
      advanceTime(60000); // 1 minute
      const res2 = await makeRequest(instance, '/api/bmkg/nowcast/id');
      assert.equal(res2.status, 200);
      assert.equal(res2.headers.get('x-cache'), 'HIT');
      assert.equal(callCount, 1);
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // Rate limiting test
  it('19. Rate limiter restricts requests exceeding threshold', async () => {
    const mockFetch: FetchFunction = async () =>
      new Response(sampleForecastJson, { status: 200, headers: { 'content-type': 'application/json' } });

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: {
        port: 0,
        rateLimitMaxRequests: 3, // Limit to 3 requests per minute
        rateLimitWindowMs: 60000,
      },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      // Requests 1, 2, 3 should succeed
      const r1 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(r1.status, 200);
      const r2 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(r2.status, 200);
      const r3 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(r3.status, 200);

      // Request 4 must be rate-limited
      const r4 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(r4.status, 429);
      assert.equal(r4.headers.get('retry-after'), '60');
      const json4 = await r4.json();
      assert.equal(json4.code, 'RATE_LIMITED');

      // Advance time by 61 seconds -> rate limit resets
      advanceTime(61000);
      const r5 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(r5.status, 200);
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 20. Same-origin redirect loop exceeding maximum hops is blocked
  it('20. Same-origin redirect loop exceeding maximum hops is blocked', async () => {
    let redirectHops = 0;
    const mockFetch: FetchFunction = async () => {
      redirectHops++;
      // Continuously redirect to another path on the SAME origin
      return new Response(null, {
        status: 302,
        headers: {
          location: `https://api.bmkg.go.id/publik/prakiraan-cuaca-redirect-${redirectHops}?adm4=31.71.01.1001`,
        },
      });
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: { port: 0 },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      const res = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(res.status, 502);
      const json = await res.json();
      assert.equal(json.code, 'REDIRECT_BLOCKED');
      // Must not recurse indefinitely; bounded by MAX_REDIRECT_HOPS
      assert.ok(redirectHops <= 4);
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 21. Same-origin redirect within allowed limit succeeds
  it('21. Same-origin redirect within allowed limit succeeds', async () => {
    let hopCount = 0;
    const mockFetch: FetchFunction = async () => {
      hopCount++;
      if (hopCount === 1) {
        // First request receives 302 to new path on same origin
        return new Response(null, {
          status: 302,
          headers: {
            location: 'https://api.bmkg.go.id/publik/prakiraan-cuaca-canonical?adm4=31.71.01.1001',
          },
        });
      }
      // Second request succeeds
      return new Response(sampleForecastJson, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: { port: 0 },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      const res = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001');
      assert.equal(res.status, 200);
      assert.equal(hopCount, 2);
      const json = await res.json();
      assert.ok(json.data);
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 22. Forged X-Forwarded-For headers cannot rotate rate-limit identities when trustProxy=false
  it('22. Forged X-Forwarded-For headers cannot rotate rate-limit identities when trustProxy=false', async () => {
    const mockFetch: FetchFunction = async () =>
      new Response(sampleForecastJson, { status: 200, headers: { 'content-type': 'application/json' } });

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: {
        port: 0,
        rateLimitMaxRequests: 2, // Limit to 2 requests per window
        rateLimitWindowMs: 60000,
        trustProxy: false, // Default: do not trust proxy headers
      },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      // Attacker attempts to rotate X-Forwarded-For to bypass rate limiter
      const r1 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001', {
        headers: { 'X-Forwarded-For': '198.51.100.1' },
      });
      assert.equal(r1.status, 200);

      const r2 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001', {
        headers: { 'X-Forwarded-For': '198.51.100.2' },
      });
      assert.equal(r2.status, 200);

      // 3rd request with yet another forged IP must still be blocked because direct socket IP is tracked
      const r3 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001', {
        headers: { 'X-Forwarded-For': '198.51.100.3' },
      });
      assert.equal(r3.status, 429);
      const json3 = await r3.json();
      assert.equal(json3.code, 'RATE_LIMITED');
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });

  // 23. When trustProxy=true, rightmost proxy-appended IP is used instead of client-forged leftmost IP
  it('23. When trustProxy=true, rightmost proxy-appended IP is used instead of client-forged leftmost IP', async () => {
    const mockFetch: FetchFunction = async () =>
      new Response(sampleForecastJson, { status: 200, headers: { 'content-type': 'application/json' } });

    const instance = createGatewayServer({
      fetch: mockFetch,
      now: () => mockTime,
      config: {
        port: 0,
        rateLimitMaxRequests: 2,
        rateLimitWindowMs: 60000,
        trustProxy: true, // Explicitly trusted proxy mode
      },
    });

    await new Promise<void>((resolve) => instance.server.listen(0, resolve));

    try {
      // Client sends forged leftmost IP, but proxy appended '203.0.113.50' at the right
      const r1 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001', {
        headers: { 'X-Forwarded-For': '1.1.1.1, 203.0.113.50' },
      });
      assert.equal(r1.status, 200);

      // Client changes forged leftmost IP to 2.2.2.2, but proxy still appends '203.0.113.50'
      const r2 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001', {
        headers: { 'X-Forwarded-For': '2.2.2.2, 203.0.113.50' },
      });
      assert.equal(r2.status, 200);

      // 3rd request with same proxy-appended IP is blocked, proving leftmost rotation was ignored
      const r3 = await makeRequest(instance, '/api/bmkg/forecast?adm4=31.71.01.1001', {
        headers: { 'X-Forwarded-For': '3.3.3.3, 203.0.113.50' },
      });
      assert.equal(r3.status, 429);
      const json3 = await r3.json();
      assert.equal(json3.code, 'RATE_LIMITED');
    } finally {
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }
  });
});
