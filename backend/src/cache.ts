import type { CacheEntry, ClockFunction } from './types.ts';

/**
 * Bounded in-memory Least-Recently-Used (LRU) Cache with TTL and clock injection.
 * Memory cannot exceed maxEntries.
 */
export class BoundedCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: ClockFunction;

  constructor(maxEntries: number, ttlMs: number, now: ClockFunction = Date.now) {
    if (maxEntries <= 0) throw new Error('maxEntries must be greater than 0');
    if (ttlMs <= 0) throw new Error('ttlMs must be greater than 0');
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  public get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    const currentTime = this.now();
    if (currentTime > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    entry.lastAccessed = currentTime;
    return entry.value;
  }

  public set(key: string, value: T): void {
    if (!key || typeof key !== 'string' || key.length > 128) {
      throw new Error('Invalid cache key: must be a string up to 128 characters');
    }

    const currentTime = this.now();

    // If key already exists, overwrite in place
    if (this.store.has(key)) {
      this.store.set(key, {
        value,
        expiresAt: currentTime + this.ttlMs,
        lastAccessed: currentTime,
      });
      return;
    }

    // First purge any expired items to make room
    if (this.store.size >= this.maxEntries) {
      for (const [k, e] of this.store.entries()) {
        if (currentTime > e.expiresAt) {
          this.store.delete(k);
        }
      }
    }

    // If still at capacity, evict the least recently accessed entry (LRU)
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

    this.store.set(key, {
      value,
      expiresAt: currentTime + this.ttlMs,
      lastAccessed: currentTime,
    });
  }

  public has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  public delete(key: string): boolean {
    return this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }
}
