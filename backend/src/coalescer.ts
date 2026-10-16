/**
 * Request Coalescer
 * Merges concurrent identical in-flight requests to eliminate duplicate upstream fetches.
 * Guarantees cleanup on both resolution and failure so in-flight map is never poisoned.
 */
export class RequestCoalescer<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  public async execute(key: string, fetchFn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const task = (async () => {
      try {
        return await fetchFn();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, task);
    return task;
  }

  public isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  public getInFlightCount(): number {
    return this.inFlight.size;
  }

  public clear(): void {
    this.inFlight.clear();
  }
}
