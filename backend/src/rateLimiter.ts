import type { IncomingHttpHeaders } from 'node:http';
import type { ClockFunction, RateLimitEntry } from './types.ts';

/**
 * Extracts and sanitizes the client IP address.
 * 
 * Policy:
 * 1. Default (trustProxy = false): Uses the unforgeable direct TCP socket remoteAddress.
 *    Any client-supplied X-Forwarded-For header is strictly IGNORED to prevent header-spoofing
 *    rate-limit evasion attacks.
 *    Operational consequence: Behind an unconfigured reverse proxy, all requests will map to
 *    the proxy socket address.
 * 2. Trusted Proxy (trustProxy = true): Only enabled when an explicit, verified reverse-proxy
 *    contract is confirmed via TRUST_PROXY=true. Reads the RIGHTMOST IP appended by the trusted
 *    edge proxy, rather than the client-controlled leftmost IP.
 *    Note: A robust per-client policy on Railway requires confirming Railway's proxy header contract.
 */
export function getClientIp(
  headers: IncomingHttpHeaders,
  socketAddress?: string,
  trustProxy: boolean = false
): string {
  if (!trustProxy) {
    // Strictly ignore client-supplied forwarding headers when proxy trust is not explicitly configured
    return socketAddress || '127.0.0.1';
  }

  const xForwardedFor = headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
    // Extract the rightmost IP (the one appended by the immediate trusted reverse proxy)
    const parts = xForwardedFor.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      const rightmostIp = parts[parts.length - 1];
      if (/^[a-fA-F0-9.:]{3,45}$/.test(rightmostIp)) {
        return rightmostIp;
      }
    }
  }

  return socketAddress || '127.0.0.1';
}

/**
 * Bounded sliding-window IP rate limiter.
 * Automatically evicts least recently accessed IPs to prevent memory exhaustion attacks.
 */
export class BoundedRateLimiter {
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly now: ClockFunction;

  constructor(
    maxRequests: number = 60,
    windowMs: number = 60000,
    maxEntries: number = 2000,
    now: ClockFunction = Date.now
  ) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  public isRateLimited(ip: string): boolean {
    const currentTime = this.now();
    const entry = this.store.get(ip);

    if (entry) {
      // Purge timestamps older than windowMs
      entry.timestamps = entry.timestamps.filter((t) => currentTime - t < this.windowMs);
      entry.lastAccessed = currentTime;

      if (entry.timestamps.length >= this.maxRequests) {
        return true;
      }

      entry.timestamps.push(currentTime);
      return false;
    }

    // New IP entry: check capacity
    if (this.store.size >= this.maxEntries) {
      let oldestKey: string | null = null;
      let oldestAccess = Infinity;

      for (const [k, e] of this.store.entries()) {
        if (e.lastAccessed < oldestAccess) {
          oldestAccess = e.lastAccessed;
          oldestKey = k;
        }
      }

      if (oldestKey !== null) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(ip, {
      timestamps: [currentTime],
      lastAccessed: currentTime,
    });

    return false;
  }

  public getEntryCount(): number {
    return this.store.size;
  }

  public clear(): void {
    this.store.clear();
  }
}
