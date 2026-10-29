export interface StoredFrame {
  data: Buffer;
  receivedAt: number;
  byteLength: number;
}

export interface ImageStoreOptions {
  maxFrameBytes?: number;
  staleTtlMs?: number;
}

/**
 * Validates whether a raw binary buffer satisfies JPEG Start of Image (0xFFD8)
 * and End of Image (0xFFD9) framing markers.
 * NOTE: This is framing validation only; it does not guarantee internal JPEG decode integrity.
 */
export function validateJpegFraming(buf: Buffer | Uint8Array): boolean {
  if (buf.byteLength < 4) {
    return false;
  }
  const isSoi = buf[0] === 0xff && buf[1] === 0xd8;
  const isEoi = buf[buf.byteLength - 2] === 0xff && buf[buf.byteLength - 1] === 0xd9;
  return isSoi && isEoi;
}

export class ImageStore {
  private currentFrame: StoredFrame | null = null;
  private maxFrameBytes: number;
  private staleTtlMs: number;

  constructor(options: ImageStoreOptions = {}) {
    this.maxFrameBytes = options.maxFrameBytes ?? 65536; // 64 KiB cap
    this.staleTtlMs = options.staleTtlMs ?? 60000; // 60s stale threshold
  }

  /**
   * Ingests a candidate camera frame. Enforces the size limit and SOI/EOI framing checks.
   * If the candidate frame is rejected, the existing valid frame is strictly preserved.
   * Returns true if accepted and stored, false if rejected.
   */
  public ingestFrame(rawPayload: Buffer | Uint8Array, nowMs: number = Date.now()): boolean {
    if (!rawPayload || rawPayload.byteLength === 0) {
      return false;
    }

    // 1. Enforce max payload limit
    if (rawPayload.byteLength > this.maxFrameBytes) {
      return false; // Oversized payload dropped
    }

    // 2. Validate JPEG framing (SOI and EOI markers)
    if (!validateJpegFraming(rawPayload)) {
      return false; // Malformed framing dropped
    }

    // 3. Store valid frame copy (overwrites prior frame, bounding memory)
    this.currentFrame = {
      data: Buffer.from(rawPayload),
      receivedAt: nowMs,
      byteLength: rawPayload.byteLength,
    };

    return true;
  }

  /**
   * Retrieves the current frame and metadata, or null if no frame has been ingested.
   */
  public getFrame(nowMs: number = Date.now()): {
    frame: StoredFrame;
    isStale: boolean;
    ageSeconds: number;
  } | null {
    if (!this.currentFrame) {
      return null;
    }

    const ageMs = Math.max(0, nowMs - this.currentFrame.receivedAt);
    const ageSeconds = Math.floor(ageMs / 1000);
    const isStale = ageMs > this.staleTtlMs;

    return {
      frame: this.currentFrame,
      isStale,
      ageSeconds,
    };
  }

  /**
   * Clears the in-memory frame cache.
   */
  public clear(): void {
    this.currentFrame = null;
  }
}
