import type { ServerResponse } from 'node:http';

export interface PublicTelemetryPayload {
  temp: number | null;
  rh: number | null;
  soilMoisture: number | null;
  soilRaw: number | null;
  rain: number | null;
  rainStatus: string | null;
  wind?: number | null;
  lightLux: number | null;
  ldrRaw: number | null;
  gasPpm?: number | null;
  mq135Raw?: number | null;
  flameDetected?: number | null;
  flameRaw?: number | null;
  motorState: string | null;
  motorDriver: string | null;
  limitLeft: boolean | null;
  limitRight: boolean | null;
  uptimeSeconds: number | null;
  visionPrediction: string | null;
  visionConfidence: number | null;
  imageReady: boolean | null;
  freshness: 'FRESH' | 'STALE';
  timestamp: number;
}

export interface TelemetryHubOptions {
  maxClientsPerIp?: number;
  pingIntervalMs?: number;
  freshnessThresholdMs?: number;
}

interface SseClient {
  res: ServerResponse;
  ip: string;
  connectedAt: number;
}

/**
 * Filters and sanitizes raw incoming IoT telemetry, projecting only approved
 * public fields and strictly stripping MAC addresses, channels, and internal identifiers.
 */
export function sanitizeTelemetry(raw: unknown, nowMs: number, lastReceivedMs: number): PublicTelemetryPayload | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const data = raw as Record<string, unknown>;

  const getNum = (key: string): number | null => {
    const val = data[key];
    return typeof val === 'number' && Number.isFinite(val) ? val : null;
  };

  const getStr = (key: string): string | null => {
    const val = data[key];
    return typeof val === 'string' && val.trim() !== '' ? val.trim() : null;
  };

  const getBool = (key: string): boolean | null => {
    const val = data[key];
    if (typeof val === 'boolean') return val;
    if (val === 'true') return true;
    if (val === 'false') return false;
    return null;
  };

  // Suhu & Kelembapan
  const temp = getNum('temp') ?? getNum('temperature');
  const rh = getNum('rh') ?? getNum('humidity');

  // Tanah
  const soilMoisture = getNum('soilMoisture') ?? getNum('soil_moisture');
  const soilRaw = getNum('soilRaw') ?? getNum('soil_raw');

  // Hujan
  const rain = getNum('rain');
  const rainStatus = getStr('rainStatus') ?? getStr('rain_status');
  const wind = getNum('wind') ?? getNum('wind_speed');

  // Cahaya
  const lightLux = getNum('lightLux') ?? getNum('light_lux');
  const ldrRaw = getNum('ldrRaw') ?? getNum('ldr_raw');

  // MQ-135 Gas & Flame Sensor
  // Note: Raw ADC is kept strictly distinct from any calibrated ppm concentration
  const mq135Raw = getNum('mq135Raw') ?? getNum('mq135_raw') ?? getNum('mq135');
  const gasPpm = getNum('gasPpm') ?? getNum('gas_ppm');
  const flameRaw = getNum('flameRaw') ?? getNum('flame_raw');

  let flameDetected = getNum('flameDetected') ?? getNum('flame_detected');
  if (flameDetected === null) {
    const boolVal = getBool('flameDetected') ?? getBool('flame_detected');
    if (boolVal !== null) {
      flameDetected = boolVal ? 1 : 0;
    } else if (getNum('flame') !== null) {
      flameDetected = getNum('flame')! > 0 ? 1 : 0;
    }
  }

  // Motor & Limit
  const motorState = getStr('motorState') ?? getStr('motor_state');
  const motorDriver = getStr('motorDriver') ?? getStr('motor_driver');
  const limitLeft = getBool('limitLeft') ?? getBool('limit_left');
  const limitRight = getBool('limitRight') ?? getBool('limit_right');

  // Uptime
  const uptimeSeconds = getNum('uptimeSeconds') ?? getNum('uptime_seconds');

  // Vision
  const visionPrediction = getStr('visionPrediction') ?? getStr('vision_prediction');
  const visionConfidence = getNum('visionConfidence') ?? getNum('vision_confidence');
  const imageReady = getBool('imageReady') ?? getBool('image_ready');

  const isFresh = nowMs - lastReceivedMs <= 10000;

  return {
    temp,
    rh,
    soilMoisture,
    soilRaw,
    rain,
    rainStatus,
    wind,
    lightLux,
    ldrRaw,
    gasPpm,
    mq135Raw,
    flameDetected,
    flameRaw,
    motorState,
    motorDriver,
    limitLeft,
    limitRight,
    uptimeSeconds,
    visionPrediction,
    visionConfidence,
    imageReady,
    freshness: isFresh ? 'FRESH' : 'STALE',
    timestamp: nowMs,
  };
}

export class TelemetryHub {
  private clients = new Set<SseClient>();
  private ipConnections = new Map<string, number>();
  private latestTelemetry: PublicTelemetryPayload | null = null;
  private lastReceivedAt = 0;
  private pingTimer: NodeJS.Timeout | null = null;
  private maxClientsPerIp: number;
  private freshnessThresholdMs: number;

  constructor(options: TelemetryHubOptions = {}) {
    this.maxClientsPerIp = options.maxClientsPerIp ?? 3;
    this.freshnessThresholdMs = options.freshnessThresholdMs ?? 10000;
    const interval = options.pingIntervalMs ?? 15000;

    if (interval > 0) {
      this.pingTimer = setInterval(() => this.broadcastPing(), interval);
      if (this.pingTimer.unref) {
        this.pingTimer.unref();
      }
    }
  }

  public getConnectedClientCount(): number {
    return this.clients.size;
  }

  public getLatestTelemetry(nowMs: number = Date.now()): PublicTelemetryPayload | null {
    if (!this.latestTelemetry) {
      return null;
    }
    const isFresh = nowMs - this.lastReceivedAt <= this.freshnessThresholdMs;
    return {
      ...this.latestTelemetry,
      freshness: isFresh ? 'FRESH' : 'STALE',
    };
  }

  /**
   * Ingests a raw MQTT message payload, sanitizes it, updates in-memory state,
   * and fans out the event to all active SSE subscribers.
   */
  public ingestTelemetry(raw: unknown, nowMs: number = Date.now()): PublicTelemetryPayload | null {
    let parsed = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
    }

    this.lastReceivedAt = nowMs;
    const sanitized = sanitizeTelemetry(parsed, nowMs, this.lastReceivedAt);
    if (!sanitized) {
      return null;
    }

    this.latestTelemetry = sanitized;
    this.broadcastEvent('telemetry', sanitized);
    return sanitized;
  }

  /**
   * Subscribes an HTTP response socket to the SSE stream.
   * Enforces per-IP concurrency bounds. Returns an unsubscribe cleanup function.
   */
  public subscribe(res: ServerResponse, clientIp: string, nowMs: number = Date.now()): (() => void) | null {
    const currentForIp = this.ipConnections.get(clientIp) || 0;
    if (currentForIp >= this.maxClientsPerIp) {
      return null; // Concurrency limit exceeded
    }

    this.ipConnections.set(clientIp, currentForIp + 1);

    const client: SseClient = {
      res,
      ip: clientIp,
      connectedAt: nowMs,
    };
    this.clients.add(client);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send immediate initial event if telemetry is cached
    const current = this.getLatestTelemetry(nowMs);
    if (current) {
      res.write(`event: telemetry\ndata: ${JSON.stringify(current)}\n\n`);
    } else {
      res.write(`:connected\n\n`);
    }

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.clients.delete(client);
      const remaining = (this.ipConnections.get(clientIp) || 1) - 1;
      if (remaining <= 0) {
        this.ipConnections.delete(clientIp);
      } else {
        this.ipConnections.set(clientIp, remaining);
      }
      try {
        if (!res.writableEnded) {
          res.end();
        }
      } catch {}
    };

    res.on('close', cleanup);
    res.on('finish', cleanup);

    return cleanup;
  }

  private broadcastEvent(event: string, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        if (!client.res.writableEnded) {
          client.res.write(message);
        }
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private broadcastPing(): void {
    for (const client of this.clients) {
      try {
        if (!client.res.writableEnded) {
          client.res.write(':ping\n\n');
        }
      } catch {
        this.clients.delete(client);
      }
    }
  }

  public destroy(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const client of this.clients) {
      try {
        client.res.end();
      } catch {}
    }
    this.clients.clear();
    this.ipConnections.clear();
  }
}
