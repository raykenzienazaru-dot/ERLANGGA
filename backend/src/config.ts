import type { GatewayConfig } from './types.ts';

/**
 * Parses and returns configuration options with secure defaults.
 * Allows overriding via environment variables.
 */
export function loadConfig(overrides?: Partial<GatewayConfig>): GatewayConfig {
  const env = process.env;

  // Explicit CORS allowlist: defaults to standard local dev servers
  // In production, comma-separated exact origins MUST be passed via ALLOWED_ORIGINS
  const defaultOrigins = ['http://localhost:5173', 'http://localhost:3000'];
  const configuredOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((o: string) => o.trim()).filter(Boolean)
    : [];

  const allowedOrigins = new Set<string>([...defaultOrigins, ...configuredOrigins]);

  // Only trust reverse proxy headers if explicitly verified and configured via TRUST_PROXY=true.
  // Never guess Railway proxy behavior or enable trust without verified contract.
  const trustProxy = overrides?.trustProxy ?? (env.TRUST_PROXY === 'true');

  return {
    port: overrides?.port ?? Number(env.PORT || 3000),
    allowedOrigins: overrides?.allowedOrigins ?? allowedOrigins,
    upstreamTimeoutMs: overrides?.upstreamTimeoutMs ?? Number(env.UPSTREAM_TIMEOUT_MS || 6000),
    forecastCacheTtlMs: overrides?.forecastCacheTtlMs ?? Number(env.FORECAST_CACHE_TTL_MS || 15 * 60 * 1000),
    forecastCacheMaxEntries: overrides?.forecastCacheMaxEntries ?? Number(env.FORECAST_CACHE_MAX_ENTRIES || 100),
    nowcastCacheTtlMs: overrides?.nowcastCacheTtlMs ?? Number(env.NOWCAST_CACHE_TTL_MS || 5 * 60 * 1000),
    nowcastCacheMaxEntries: overrides?.nowcastCacheMaxEntries ?? Number(env.NOWCAST_CACHE_MAX_ENTRIES || 2),
    maxForecastBytes: overrides?.maxForecastBytes ?? Number(env.MAX_FORECAST_BYTES || 512 * 1024),
    maxNowcastBytes: overrides?.maxNowcastBytes ?? Number(env.MAX_NOWCAST_BYTES || 1024 * 1024),
    rateLimitWindowMs: overrides?.rateLimitWindowMs ?? Number(env.RATE_LIMIT_WINDOW_MS || 60 * 1000),
    rateLimitMaxRequests: overrides?.rateLimitMaxRequests ?? Number(env.RATE_LIMIT_MAX_REQUESTS || 60),
    rateLimitMaxEntries: overrides?.rateLimitMaxEntries ?? Number(env.RATE_LIMIT_MAX_ENTRIES || 2000),
    trustProxy,
  };
}
