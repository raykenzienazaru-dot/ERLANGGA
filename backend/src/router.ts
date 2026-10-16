import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BoundedCache } from './cache.ts';
import type { RequestCoalescer } from './coalescer.ts';
import { handleCors } from './cors.ts';
import type { BoundedRateLimiter } from './rateLimiter.ts';
import { getClientIp } from './rateLimiter.ts';
import type { ClockFunction, FetchFunction, GatewayConfig, UpstreamPayload } from './types.ts';
import {
  fetchUpstreamForecast,
  fetchUpstreamNowcast,
  PayloadTooLargeError,
  RedirectBlockedError,
  UpstreamHttpError,
  UpstreamTimeoutError,
} from './upstream.ts';

const ADM4_REGEX = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/;

interface RouterContext {
  config: GatewayConfig;
  forecastCache: BoundedCache<UpstreamPayload>;
  nowcastCache: BoundedCache<UpstreamPayload>;
  coalescer: RequestCoalescer<UpstreamPayload>;
  rateLimiter: BoundedRateLimiter;
  startTime: number;
  now: ClockFunction;
  fetchFn: FetchFunction;
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): void {
  const payload = Buffer.from(JSON.stringify(data), 'utf-8');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.byteLength),
    ...extraHeaders,
  });
  res.end(payload);
}

function sendError(
  res: ServerResponse,
  statusCode: number,
  message: string,
  code: string,
  extraHeaders: Record<string, string> = {}
): void {
  sendJson(res, statusCode, { error: message, code }, extraHeaders);
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouterContext
): Promise<void> {
  const { config, forecastCache, nowcastCache, coalescer, rateLimiter, startTime, now, fetchFn } = ctx;

  // 1. Strict CORS evaluation
  const shouldContinue = handleCors(req, res, config.allowedOrigins);
  if (!shouldContinue) {
    return;
  }

  // Parse URL safely
  const host = req.headers.host || `localhost:${config.port}`;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(req.url || '/', `http://${host}`);
  } catch {
    sendError(res, 400, 'Invalid request URL', 'INVALID_URL');
    return;
  }

  const pathname = parsedUrl.pathname;

  // 2. Route matching & Method validation
  if (pathname === '/health') {
    if (req.method !== 'GET') {
      sendError(res, 405, 'Method Not Allowed', 'METHOD_NOT_ALLOWED', { Allow: 'GET, OPTIONS' });
      return;
    }
    const uptimeSeconds = Math.max(0, Math.floor((now() - startTime) / 1000));
    sendJson(res, 200, {
      status: 'ok',
      service: 'agrapatha-bmkg-gateway',
      uptimeSeconds,
    }, { 'Cache-Control': 'no-cache, no-store' });
    return;
  }

  const isForecastRoute = pathname === '/api/bmkg/forecast';
  const isNowcastRoute = pathname === '/api/bmkg/nowcast/id';

  if (!isForecastRoute && !isNowcastRoute) {
    sendError(res, 404, 'Not Found', 'NOT_FOUND');
    return;
  }

  if (req.method !== 'GET') {
    sendError(res, 405, 'Method Not Allowed', 'METHOD_NOT_ALLOWED', { Allow: 'GET, OPTIONS' });
    return;
  }

  // 3. Rate Limiting Check
  const clientIp = getClientIp(req.headers, req.socket.remoteAddress, config.trustProxy);
  if (rateLimiter.isRateLimited(clientIp)) {
    sendError(res, 429, 'Too many requests. Please slow down.', 'RATE_LIMITED', {
      'Retry-After': '60',
    });
    return;
  }

  // 4. Route Execution
  if (isForecastRoute) {
    const adm4List = parsedUrl.searchParams.getAll('adm4');
    if (adm4List.length === 0) {
      sendError(res, 400, 'Missing required query parameter: adm4', 'INVALID_PARAMS');
      return;
    }
    if (adm4List.length > 1) {
      sendError(res, 400, 'Duplicate adm4 parameter not allowed', 'INVALID_PARAMS');
      return;
    }

    const adm4 = adm4List[0].trim();
    if (!ADM4_REGEX.test(adm4)) {
      sendError(
        res,
        400,
        'Invalid adm4 format. Expected XX.XX.XX.XXXX (e.g., 31.71.01.1001)',
        'INVALID_ADM4'
      );
      return;
    }

    const cacheKey = `forecast:${adm4}`;
    const cached = forecastCache.get(cacheKey);
    if (cached) {
      res.writeHead(200, {
        'Content-Type': cached.contentType || 'application/json; charset=utf-8',
        'Content-Length': String(cached.body.byteLength),
        'Cache-Control': 'public, max-age=900',
        'X-Cache': 'HIT',
      });
      res.end(cached.body);
      return;
    }

    try {
      const payload = await coalescer.execute(cacheKey, () =>
        fetchUpstreamForecast(adm4, config.maxForecastBytes, config.upstreamTimeoutMs, fetchFn)
      );

      forecastCache.set(cacheKey, payload);

      res.writeHead(200, {
        'Content-Type': payload.contentType || 'application/json; charset=utf-8',
        'Content-Length': String(payload.body.byteLength),
        'Cache-Control': 'public, max-age=900',
        'X-Cache': 'MISS',
      });
      res.end(payload.body);
    } catch (err: unknown) {
      handleUpstreamError(res, err);
    }
    return;
  }

  if (isNowcastRoute) {
    const cacheKey = 'nowcast:id';
    const cached = nowcastCache.get(cacheKey);
    if (cached) {
      res.writeHead(200, {
        'Content-Type': cached.contentType || 'application/rss+xml; charset=utf-8',
        'Content-Length': String(cached.body.byteLength),
        'Cache-Control': 'public, max-age=300',
        'X-Cache': 'HIT',
      });
      res.end(cached.body);
      return;
    }

    try {
      const payload = await coalescer.execute(cacheKey, () =>
        fetchUpstreamNowcast(config.maxNowcastBytes, config.upstreamTimeoutMs, fetchFn)
      );

      nowcastCache.set(cacheKey, payload);

      res.writeHead(200, {
        'Content-Type': payload.contentType || 'application/rss+xml; charset=utf-8',
        'Content-Length': String(payload.body.byteLength),
        'Cache-Control': 'public, max-age=300',
        'X-Cache': 'MISS',
      });
      res.end(payload.body);
    } catch (err: unknown) {
      handleUpstreamError(res, err);
    }
    return;
  }
}

function handleUpstreamError(res: ServerResponse, err: unknown): void {
  if (err instanceof UpstreamTimeoutError) {
    sendError(res, 504, 'BMKG upstream request timed out', 'GATEWAY_TIMEOUT');
    return;
  }
  if (err instanceof PayloadTooLargeError) {
    sendError(res, 502, 'BMKG upstream response exceeded size limit', 'PAYLOAD_TOO_LARGE');
    return;
  }
  if (err instanceof RedirectBlockedError) {
    sendError(res, 502, 'BMKG upstream redirect to untrusted origin blocked', 'REDIRECT_BLOCKED');
    return;
  }
  if (err instanceof UpstreamHttpError) {
    sendError(res, 502, `BMKG upstream returned HTTP ${err.statusCode}`, 'BMKG_UPSTREAM_ERROR');
    return;
  }

  sendError(res, 502, 'BMKG upstream service unavailable', 'BMKG_UPSTREAM_ERROR');
}
