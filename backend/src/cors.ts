import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Evaluates request Origin against the explicit allowlist.
 * Returns true if the request can continue to route execution.
 * Returns false if the request was an OPTIONS preflight and has been answered.
 */
export function handleCors(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: Set<string>
): boolean {
  const origin = req.headers.origin;

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    if (!origin || !allowedOrigins.has(origin)) {
      res.writeHead(403, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ error: 'CORS origin forbidden', code: 'CORS_FORBIDDEN' }));
      return false;
    }

    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    });
    res.end();
    return false;
  }

  // Handle regular requests (GET, etc.)
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  return true;
}
