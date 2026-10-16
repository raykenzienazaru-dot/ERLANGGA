import { createServer, type Server } from 'node:http';
import { BoundedCache } from './cache.ts';
import { RequestCoalescer } from './coalescer.ts';
import { loadConfig } from './config.ts';
import { BoundedRateLimiter } from './rateLimiter.ts';
import { handleRequest } from './router.ts';
import type { GatewayConfig, ServerDependencies, UpstreamPayload } from './types.ts';

export interface GatewayInstance {
  server: Server;
  config: GatewayConfig;
  forecastCache: BoundedCache<UpstreamPayload>;
  nowcastCache: BoundedCache<UpstreamPayload>;
  coalescer: RequestCoalescer<UpstreamPayload>;
  rateLimiter: BoundedRateLimiter;
}

/**
 * Creates and configures the native Node.js HTTP Gateway Server.
 * Supports full dependency injection (clock, fetch, config) for unit and integration testing.
 */
export function createGatewayServer(dependencies: ServerDependencies = {}): GatewayInstance {
  const config = loadConfig(dependencies.config);
  const now = dependencies.now || Date.now;
  const fetchFn = dependencies.fetch || globalThis.fetch;
  const startTime = now();

  const forecastCache = new BoundedCache<UpstreamPayload>(
    config.forecastCacheMaxEntries,
    config.forecastCacheTtlMs,
    now
  );

  const nowcastCache = new BoundedCache<UpstreamPayload>(
    config.nowcastCacheMaxEntries,
    config.nowcastCacheTtlMs,
    now
  );

  const coalescer = new RequestCoalescer<UpstreamPayload>();

  const rateLimiter = new BoundedRateLimiter(
    config.rateLimitMaxRequests,
    config.rateLimitWindowMs,
    config.rateLimitMaxEntries,
    now
  );

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, {
        config,
        forecastCache,
        nowcastCache,
        coalescer,
        rateLimiter,
        startTime,
        now,
        fetchFn,
      });
    } catch {
      // Top-level catch-all: ensure socket never hangs and no stack trace is leaked
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' }));
      }
    }
  });

  return {
    server,
    config,
    forecastCache,
    nowcastCache,
    coalescer,
    rateLimiter,
  };
}
