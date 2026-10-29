import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticateOperator, type OperatorAccount } from './auth/accountStore.ts';
import { signOperatorToken, verifyOperatorToken } from './auth/tokens.ts';
import type { BoundedCache } from './cache.ts';
import type { RequestCoalescer } from './coalescer.ts';
import { handleCors } from './cors.ts';
import { evaluateActuatorCommand } from './iot/actuatorGate.ts';
import type { ImageStore } from './iot/imageStore.ts';
import type { MqttGatewayAdapter } from './iot/mqttAdapter.ts';
import type { TelemetryHub } from './iot/telemetryHub.ts';
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
  loginRateLimiter: BoundedRateLimiter;
  telemetryHub: TelemetryHub;
  imageStore: ImageStore;
  accountStore: Map<string, OperatorAccount>;
  mqttAdapter?: MqttGatewayAdapter;
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

async function readJsonBody<T = unknown>(req: IncomingMessage, maxBytes = 4096): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let receivedBytes = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        reject(new Error('EMPTY_BODY'));
        return;
      }
      try {
        const str = Buffer.concat(chunks).toString('utf-8');
        const parsed = JSON.parse(str);
        resolve(parsed as T);
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouterContext
): Promise<void> {
  const {
    config,
    forecastCache,
    nowcastCache,
    coalescer,
    rateLimiter,
    loginRateLimiter,
    telemetryHub,
    imageStore,
    accountStore,
    mqttAdapter,
    startTime,
    now,
    fetchFn,
  } = ctx;

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

  // Route: /health
  if (pathname === '/health') {
    if (req.method !== 'GET') {
      sendError(res, 405, 'Method Not Allowed', 'METHOD_NOT_ALLOWED', { Allow: 'GET, OPTIONS' });
      return;
    }
    const uptimeSeconds = Math.max(0, Math.floor((now() - startTime) / 1000));
    const mqttConnected = mqttAdapter ? mqttAdapter.isConnected() : false;
    sendJson(
      res,
      200,
      {
        status: 'ok',
        service: 'agrapatha-bmkg-gateway',
        uptimeSeconds,
        mqttConnected,
        actuatorsEnabled: config.enableActuators,
      },
      { 'Cache-Control': 'no-cache, no-store' }
    );
    return;
  }

  // Route: /api/telemetry/stream (Public SSE stream)
  if (pathname === '/api/telemetry/stream') {
    if (req.method !== 'GET') {
      sendError(res, 405, 'Method Not Allowed', 'METHOD_NOT_ALLOWED', { Allow: 'GET, OPTIONS' });
      return;
    }
    const clientIp = getClientIp(req.headers, req.socket.remoteAddress, config.trustProxy);
    const unsubscribe = telemetryHub.subscribe(res, clientIp, now());
    if (!unsubscribe) {
      sendError(res, 429, 'Too many SSE connections for this IP address', 'TOO_MANY_CONNECTIONS');
      return;
    }
    return;
  }

  // Route: /api/vision/latest-frame.jpg (Latest camera frame cache)
  if (pathname === '/api/vision/latest-frame.jpg') {
    if (req.method !== 'GET') {
      sendError(res, 405, 'Method Not Allowed', 'METHOD_NOT_ALLOWED', { Allow: 'GET, OPTIONS' });
      return;
    }
    const frameInfo = imageStore.getFrame(now());
    if (!frameInfo) {
      res.writeHead(204, {
        'Cache-Control': 'no-cache, no-store',
      });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(frameInfo.frame.byteLength),
      'Cache-Control': 'public, max-age=1, stale-while-revalidate=2',
      'X-Frame-Timestamp': String(frameInfo.frame.receivedAt),
      'X-Frame-Age-Seconds': String(frameInfo.ageSeconds),
      'X-Frame-Stale': frameInfo.isStale ? '1' : '0',
    });
    res.end(frameInfo.frame.data);
    return;
  }

  // Route: /api/auth/login (Operator Login)
  if (pathname === '/api/auth/login') {
    if (req.method !== 'POST') {
      sendError(res, 405, 'Method Not Allowed', 'METHOD_NOT_ALLOWED', { Allow: 'POST, OPTIONS' });
      return;
    }

    const clientIp = getClientIp(req.headers, req.socket.remoteAddress, config.trustProxy);
    if (loginRateLimiter.isRateLimited(clientIp)) {
      sendError(res, 429, 'Too many login attempts. Please slow down.', 'RATE_LIMITED', {
        'Retry-After': '60',
      });
      return;
    }

    let body: any;
    try {
      body = await readJsonBody(req, 4096);
    } catch (err: any) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        sendError(res, 413, 'Login payload too large', 'PAYLOAD_TOO_LARGE');
        return;
      }
      sendError(res, 400, 'Invalid JSON body', 'INVALID_JSON');
      return;
    }

    if (
      !body ||
      typeof body !== 'object' ||
      typeof body.username !== 'string' ||
      typeof body.password !== 'string' ||
      body.username.trim() === '' ||
      body.password === ''
    ) {
      sendError(res, 400, 'Username and password are required', 'INVALID_CREDENTIALS_FORMAT');
      return;
    }

    const account = authenticateOperator(accountStore, body.username, body.password);
    if (!account) {
      sendError(res, 401, 'Invalid username or password', 'INVALID_CREDENTIALS');
      return;
    }

    const nowSec = Math.floor(now() / 1000);
    const token = signOperatorToken(account, config.gatewayTokenSecret, config.tokenExpirySec, nowSec);

    sendJson(
      res,
      200,
      {
        token,
        expiresIn: config.tokenExpirySec,
        operator: {
          id: account.id,
          username: account.username,
          displayName: account.displayName,
          role: account.role,
        },
      },
      { 'Cache-Control': 'no-store' }
    );
    return;
  }

  // Route: /api/commands/actuator (Operator Actuator Command — Fail-Closed Gate)
  if (pathname === '/api/commands/actuator') {
    if (req.method !== 'POST') {
      sendError(res, 405, 'Method Not Allowed', 'METHOD_NOT_ALLOWED', { Allow: 'POST, OPTIONS' });
      return;
    }

    // 1. Authenticate operator token independently of actuator safety lockout
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      sendError(res, 401, 'Missing or invalid Authorization header', 'UNAUTHORIZED');
      return;
    }

    const token = authHeader.slice(7).trim();
    const nowSec = Math.floor(now() / 1000);
    const operatorPayload = verifyOperatorToken(token, config.gatewayTokenSecret, accountStore, nowSec);
    if (!operatorPayload) {
      sendError(res, 401, 'Invalid, expired, or revoked operator token', 'UNAUTHORIZED');
      return;
    }

    // 2. Parse request body
    let body: any;
    try {
      body = await readJsonBody(req, 4096);
    } catch (err: any) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        sendError(res, 413, 'Payload too large', 'PAYLOAD_TOO_LARGE');
        return;
      }
      sendError(res, 400, 'Invalid JSON body', 'INVALID_JSON');
      return;
    }

    // 3. Evaluate safety gate
    const gateResult = evaluateActuatorCommand(operatorPayload, body, config.enableActuators);
    if (!gateResult.allowed) {
      sendError(
        res,
        gateResult.statusCode,
        gateResult.error || 'Command rejected',
        gateResult.code || 'COMMAND_REJECTED'
      );
      return;
    }

    // Actuation not reached in Gate A (enableActuators is false)
    sendJson(res, 200, {
      status: 'executed',
      command: gateResult.commandChar,
    });
    return;
  }

  // BMKG Routes
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

  // 3. Rate Limiting Check for Upstream Calls
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
