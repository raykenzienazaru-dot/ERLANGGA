/**
 * Agrapatha BMKG Gateway — Core Type Definitions
 */

export interface GatewayConfig {
  port: number;
  allowedOrigins: Set<string>;
  upstreamTimeoutMs: number;
  forecastCacheTtlMs: number;
  forecastCacheMaxEntries: number;
  nowcastCacheTtlMs: number;
  nowcastCacheMaxEntries: number;
  maxForecastBytes: number;
  maxNowcastBytes: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  rateLimitMaxEntries: number;
  trustProxy: boolean;
}

export interface UpstreamPayload {
  statusCode: number;
  contentType: string;
  body: Uint8Array;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccessed: number;
}

export type FetchFunction = typeof globalThis.fetch;
export type ClockFunction = () => number;

export interface ServerDependencies {
  fetch?: FetchFunction;
  now?: ClockFunction;
  config?: Partial<GatewayConfig>;
}

export interface RateLimitEntry {
  timestamps: number[];
  lastAccessed: number;
}
