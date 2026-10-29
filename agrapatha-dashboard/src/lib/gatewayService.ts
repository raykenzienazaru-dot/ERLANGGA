/**
 * AGRAPATHA — Frontend Backend Gateway Service Client
 * Consumes read-only backend gateway endpoints:
 * - GET /api/telemetry/stream (Server-Sent Events)
 * - GET /api/vision/latest-frame.jpg (Binary JPEG image cache)
 * - GET /health (Gateway & MQTT connection health check)
 */

export interface GatewayTelemetryPayload {
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

export type GatewayConnectionStatus = 'connecting' | 'connected' | 'error' | 'closed';

export interface TelemetrySubscriptionOptions {
  baseUrl?: string;
  onTelemetry: (payload: GatewayTelemetryPayload) => void;
  onStatusChange?: (status: GatewayConnectionStatus) => void;
  onError?: (error: Event | Error) => void;
  EventSourceClass?: typeof EventSource;
}

export interface CameraFrameMetadata {
  blob: Blob;
  byteLength: number;
  receivedAt: number | null;
  ageSeconds: number | null;
  isStale: boolean;
}

export interface CameraFrameResult {
  hasFrame: boolean;
  frame: CameraFrameMetadata | null;
}

export interface FetchFrameOptions {
  baseUrl?: string;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

export interface GatewayHealthResponse {
  status: string;
  service: string;
  uptimeSeconds: number;
  mqttConnected: boolean;
  actuatorsEnabled: boolean;
}

export interface CheckHealthOptions {
  baseUrl?: string;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

export class GatewayHttpError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(`${message} (HTTP ${statusCode})`);
    this.name = 'GatewayHttpError';
    this.statusCode = statusCode;
  }
}

/**
 * Safely parses and validates incoming telemetry data against the backend contract.
 * Returns null if data is malformed or missing required schema primitives.
 */
export function parseGatewayTelemetry(data: unknown): GatewayTelemetryPayload | null {
  if (data === null || data === undefined) {
    return null;
  }

  let parsed: unknown = data;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const rec = parsed as Record<string, unknown>;

  const getNumOrNull = (k: string): number | null => {
    const v = rec[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const getStrOrNull = (k: string): string | null => {
    const v = rec[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };

  const getBoolOrNull = (k: string): boolean | null => {
    const v = rec[k];
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  };

  // Timestamp must be a valid finite number
  const timestamp = rec.timestamp;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return null;
  }

  // Freshness must be 'FRESH' or 'STALE'
  const rawFreshness = rec.freshness;
  if (rawFreshness !== 'FRESH' && rawFreshness !== 'STALE') {
    return null;
  }

  return {
    temp: getNumOrNull('temp'),
    rh: getNumOrNull('rh'),
    soilMoisture: getNumOrNull('soilMoisture'),
    soilRaw: getNumOrNull('soilRaw'),
    rain: getNumOrNull('rain'),
    rainStatus: getStrOrNull('rainStatus'),
    wind: getNumOrNull('wind'),
    lightLux: getNumOrNull('lightLux'),
    ldrRaw: getNumOrNull('ldrRaw'),
    gasPpm: getNumOrNull('gasPpm') ?? getNumOrNull('gas_ppm'),
    mq135Raw: getNumOrNull('mq135Raw') ?? getNumOrNull('mq135_raw') ?? getNumOrNull('mq135'),
    flameDetected: getNumOrNull('flameDetected') ?? getNumOrNull('flame_detected') ?? (getBoolOrNull('flameDetected') !== null ? (getBoolOrNull('flameDetected') ? 1 : 0) : null) ?? (getBoolOrNull('flame_detected') !== null ? (getBoolOrNull('flame_detected') ? 1 : 0) : null) ?? (getNumOrNull('flame') !== null ? (getNumOrNull('flame')! > 0 ? 1 : 0) : null),
    flameRaw: getNumOrNull('flameRaw') ?? getNumOrNull('flame_raw'),
    motorState: getStrOrNull('motorState'),
    motorDriver: getStrOrNull('motorDriver'),
    limitLeft: getBoolOrNull('limitLeft'),
    limitRight: getBoolOrNull('limitRight'),
    uptimeSeconds: getNumOrNull('uptimeSeconds'),
    visionPrediction: getStrOrNull('visionPrediction'),
    visionConfidence: getNumOrNull('visionConfidence'),
    imageReady: getBoolOrNull('imageReady'),
    freshness: rawFreshness,
    timestamp,
  };
}

/**
 * Subscribes to the backend's Server-Sent Events telemetry stream (/api/telemetry/stream).
 * Listens specifically to the named 'telemetry' event.
 * Returns an idempotent cleanup function to close the connection and remove listeners.
 */
export function subscribeGatewayTelemetry(options: TelemetrySubscriptionOptions): () => void {
  const { baseUrl = '', onTelemetry, onStatusChange, onError, EventSourceClass } = options;
  const ES = EventSourceClass || (typeof EventSource !== 'undefined' ? EventSource : null);

  if (!ES) {
    const err = new Error('EventSource is not supported in this runtime environment');
    onStatusChange?.('error');
    onError?.(err);
    return () => {};
  }

  const endpoint = `${baseUrl}/api/telemetry/stream`;
  const es = new ES(endpoint);
  onStatusChange?.('connecting');

  const handleOpen = () => {
    onStatusChange?.('connected');
  };

  const handleTelemetry = (e: MessageEvent) => {
    const payload = parseGatewayTelemetry(e.data);
    if (payload) {
      onTelemetry(payload);
    }
  };

  const handleError = (e: Event) => {
    onStatusChange?.('error');
    onError?.(e);
  };

  es.addEventListener('open', handleOpen);
  es.addEventListener('telemetry', handleTelemetry as EventListener);
  es.addEventListener('error', handleError);

  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    es.removeEventListener('open', handleOpen);
    es.removeEventListener('telemetry', handleTelemetry as EventListener);
    es.removeEventListener('error', handleError);
    es.close();
    onStatusChange?.('closed');
  };
}

/**
 * Requests the latest camera JPEG frame from the backend cache (/api/vision/latest-frame.jpg).
 * Handles HTTP 200 (Blob and frame metadata) and HTTP 204 (No content / no frame yet).
 */
export async function fetchLatestCameraFrame(
  options: FetchFrameOptions = {}
): Promise<CameraFrameResult> {
  const { baseUrl = '', signal, fetchFn = globalThis.fetch } = options;
  const endpoint = `${baseUrl}/api/vision/latest-frame.jpg`;

  let res: Response;
  try {
    res = await fetchFn(endpoint, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'image/jpeg',
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Network failure fetching camera frame: ${msg}`);
  }

  if (res.status === 204) {
    return {
      hasFrame: false,
      frame: null,
    };
  }

  if (!res.ok) {
    throw new GatewayHttpError(res.status, 'Failed to fetch camera frame');
  }

  const blob = await res.blob();
  const rawTimestamp = res.headers.get('X-Frame-Timestamp');
  const rawAge = res.headers.get('X-Frame-Age-Seconds');
  const rawStale = res.headers.get('X-Frame-Stale');

  const receivedAt = rawTimestamp ? Number(rawTimestamp) : null;
  const ageSeconds = rawAge ? Number(rawAge) : null;
  const isStale = rawStale === '1';

  return {
    hasFrame: true,
    frame: {
      blob,
      byteLength: blob.size,
      receivedAt: Number.isFinite(receivedAt) ? receivedAt : null,
      ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : null,
      isStale,
    },
  };
}

/**
 * Queries the backend gateway health endpoint (/health).
 * Reports server uptime, service identity, and live MQTT adapter connection state.
 */
export async function checkGatewayHealth(
  options: CheckHealthOptions = {}
): Promise<GatewayHealthResponse> {
  const { baseUrl = '', signal, fetchFn = globalThis.fetch } = options;
  const endpoint = `${baseUrl}/health`;

  let res: Response;
  try {
    res = await fetchFn(endpoint, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'application/json',
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Network failure checking gateway health: ${msg}`);
  }

  if (!res.ok) {
    throw new GatewayHttpError(res.status, 'Gateway health check failed');
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('Malformed JSON received from health endpoint');
  }

  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    typeof (data as Record<string, unknown>).status !== 'string' ||
    typeof (data as Record<string, unknown>).service !== 'string' ||
    typeof (data as Record<string, unknown>).uptimeSeconds !== 'number' ||
    typeof (data as Record<string, unknown>).mqttConnected !== 'boolean' ||
    typeof (data as Record<string, unknown>).actuatorsEnabled !== 'boolean'
  ) {
    throw new Error('Invalid health response schema from gateway');
  }

  const typed = data as Record<string, unknown>;
  return {
    status: typed.status as string,
    service: typed.service as string,
    uptimeSeconds: typed.uptimeSeconds as number,
    mqttConnected: typed.mqttConnected as boolean,
    actuatorsEnabled: typed.actuatorsEnabled as boolean,
  };
}
