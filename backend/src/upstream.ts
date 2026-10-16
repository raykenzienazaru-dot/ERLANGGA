import type { FetchFunction, UpstreamPayload } from './types.ts';

export class UpstreamTimeoutError extends Error {
  constructor(message: string = 'Upstream BMKG request timed out') {
    super(message);
    this.name = 'UpstreamTimeoutError';
  }
}

export class PayloadTooLargeError extends Error {
  constructor(message: string = 'Upstream BMKG response exceeded size limit') {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

export class UpstreamHttpError extends Error {
  public readonly statusCode: number;
  constructor(statusCode: number, message: string = `Upstream BMKG returned HTTP ${statusCode}`) {
    super(message);
    this.name = 'UpstreamHttpError';
    this.statusCode = statusCode;
  }
}

export class RedirectBlockedError extends Error {
  constructor(message: string = 'Upstream redirect to arbitrary or untrusted host blocked') {
    super(message);
    this.name = 'RedirectBlockedError';
  }
}

// Fixed BMKG official origins and base paths
export const FIXED_FORECAST_ORIGIN = 'https://api.bmkg.go.id';
export const FIXED_FORECAST_PATH = '/publik/prakiraan-cuaca';

export const FIXED_NOWCAST_ORIGIN = 'https://www.bmkg.go.id';
export const FIXED_NOWCAST_PATH = '/alerts/nowcast/id';

/**
 * Reads a ReadableStream with a strict byte limit.
 * Cancels stream consumption immediately if maxBytes is exceeded.
 */
async function readStreamBounded(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array(0);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('Payload too large');
        throw new PayloadTooLargeError(
          `Upstream response exceeded limit of ${maxBytes} bytes (read ${totalBytes} bytes)`
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

// Maximum allowed redirect hops for same-origin redirects
export const MAX_REDIRECT_HOPS = 2;

/**
 * Executes an upstream request with strict origin, redirect, timeout, and size validations.
 */
async function fetchFixedUpstream(
  targetUrl: string,
  expectedOrigin: string,
  acceptHeader: string,
  maxBytes: number,
  timeoutMs: number,
  fetchFn: FetchFunction = globalThis.fetch,
  redirectCount: number = 0
): Promise<UpstreamPayload> {
  const urlObj = new URL(targetUrl);
  if (urlObj.origin !== expectedOrigin) {
    throw new Error(`Forbidden upstream target origin: ${urlObj.origin}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(targetUrl, {
      method: 'GET',
      headers: {
        Accept: acceptHeader,
        'User-Agent': 'Agrapatha-Gateway/1.0',
      },
      redirect: 'manual', // Never follow external redirects blindly
      signal: controller.signal,
    });

    // Check for redirects (301, 302, 307, 308)
    if ([301, 302, 307, 308].includes(response.status)) {
      if (redirectCount >= MAX_REDIRECT_HOPS) {
        throw new RedirectBlockedError(
          `Upstream redirect limit exceeded (maximum ${MAX_REDIRECT_HOPS} hops)`
        );
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new RedirectBlockedError('Redirect with missing location header');
      }

      const redirectUrl = new URL(location, targetUrl);
      if (redirectUrl.origin !== expectedOrigin) {
        throw new RedirectBlockedError(
          `Redirect to external or untrusted origin blocked: ${redirectUrl.origin}`
        );
      }

      // If same-origin redirect within allowed limit, re-dispatch with incremented counter
      return await fetchFixedUpstream(
        redirectUrl.href,
        expectedOrigin,
        acceptHeader,
        maxBytes,
        timeoutMs,
        fetchFn,
        redirectCount + 1
      );
    }

    if (!response.ok) {
      throw new UpstreamHttpError(
        response.status,
        `BMKG upstream service returned status ${response.status}`
      );
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const body = await readStreamBounded(
      response.body as ReadableStream<Uint8Array> | null,
      maxBytes
    );

    return {
      statusCode: response.status,
      contentType,
      body,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new UpstreamTimeoutError(`Upstream BMKG request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches BMKG weather forecast for a verified ADM4 code.
 */
export async function fetchUpstreamForecast(
  adm4: string,
  maxBytes: number,
  timeoutMs: number,
  fetchFn: FetchFunction = globalThis.fetch
): Promise<UpstreamPayload> {
  const targetUrl = `${FIXED_FORECAST_ORIGIN}${FIXED_FORECAST_PATH}?adm4=${encodeURIComponent(adm4)}`;
  return fetchFixedUpstream(
    targetUrl,
    FIXED_FORECAST_ORIGIN,
    'application/json',
    maxBytes,
    timeoutMs,
    fetchFn
  );
}

/**
 * Fetches BMKG raw XML nowcast warning feed.
 */
export async function fetchUpstreamNowcast(
  maxBytes: number,
  timeoutMs: number,
  fetchFn: FetchFunction = globalThis.fetch
): Promise<UpstreamPayload> {
  const targetUrl = `${FIXED_NOWCAST_ORIGIN}${FIXED_NOWCAST_PATH}`;
  return fetchFixedUpstream(
    targetUrl,
    FIXED_NOWCAST_ORIGIN,
    'application/rss+xml, application/xml, text/xml',
    maxBytes,
    timeoutMs,
    fetchFn
  );
}
