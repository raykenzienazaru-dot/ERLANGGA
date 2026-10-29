/**
 * AGRAPATHA — Sensor Display & Zero-Dummy-Data Formatting Helpers
 *
 * Implements strict zero-dummy-data, software-first presentation:
 * - When valid live telemetry is absent, disconnected, or stale, sensor values format as 'Unavailable' or 'Not Connected'.
 * - Sensor measurements are NEVER represented as zero-valued live measurements when data is unavailable or disconnected.
 * - Stale telemetry is clearly distinguished from fresh telemetry and never conflated with live conditions.
 * - Device status explicitly distinguishes 'LIVE', 'STALE TELEMETRY', 'MQTT DISCONNECTED', and 'NOT CONNECTED'.
 */

export interface SensorDisplayConfig {
  value: string;
  statusLabel: string;
  isWarn: boolean;
  percent: number;
  barColor: string;
  extra: string;
}

/**
 * Formats a sensor number value for display.
 * Returns formatted numeric string if live and valid; returns fallback ('Unavailable' or 'Not Connected') when offline/null.
 * Never represents unavailable data as a zero-valued live measurement.
 */
export function formatSensorValue(
  value: number | null | undefined,
  isLiveValid: boolean,
  decimals = 1,
  fallback = 'Unavailable'
): string {
  if (isLiveValid && typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(decimals);
  }
  return fallback;
}

/**
 * Formats ambient light lux specifically (supports 'k' suffix for large values).
 */
export function formatLightLuxValue(
  lux: number | null | undefined,
  isLiveValid: boolean,
  fallback = 'Unavailable'
): string {
  if (isLiveValid && typeof lux === 'number' && Number.isFinite(lux)) {
    return lux >= 1000 ? `${(lux / 1000).toFixed(1)}k` : String(Math.round(lux));
  }
  return fallback;
}

/**
 * Formats gas concentration for MQ-135 (ppm / integer).
 */
export function formatGasValue(
  value: number | null | undefined,
  isLiveValid: boolean,
  fallback = 'Unavailable'
): string {
  if (isLiveValid && typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.round(value));
  }
  return fallback;
}

/**
 * Formats flame sensor reading (0 = aman, 1 = flame).
 */
export function formatFlameValue(
  value: number | boolean | null | undefined,
  isLiveValid: boolean,
  fallback = 'Unavailable'
): string {
  if (isLiveValid) {
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 0 ? '1' : '0';
    }
  }
  return fallback;
}

/**
 * Returns explicit status label for sensor cards.
 * Returns 'NOT CONNECTED' or 'STALE' when live validity is false, never deriving false environmental categories.
 */
export function getSensorStatusLabel(
  sensorType: 'temp' | 'rh' | 'soil' | 'mq135' | 'flame' | 'ffmc' | 'rain' | 'light',
  value: number | null | undefined,
  isLiveValid: boolean,
  auxiliaryStatus?: string | null,
  isStale = false
): string {
  if (!isLiveValid || typeof value !== 'number' || !Number.isFinite(value)) {
    return isStale ? 'STALE' : 'NOT CONNECTED';
  }

  switch (sensorType) {
    case 'temp':
      return value >= 28 ? 'SUHU TINGGI' : value <= 15 ? 'SEJUK' : 'OPTIMAL';
    case 'rh':
      return value < 35 ? 'KERING KRITIS' : value > 80 ? 'LEMBAP TINGGI' : 'MODERAT';
    case 'soil':
      return value < 25 ? 'TANAH KERING' : value > 75 ? 'BASAH JENUH' : 'LEMBAP SUBUR';
    case 'mq135': {
      if (auxiliaryStatus) return auxiliaryStatus.toUpperCase();
      return value >= 1000 ? 'GAS TINGGI' : value >= 400 ? 'MODERAT' : 'NORMAL';
    }
    case 'flame': {
      if (auxiliaryStatus) return auxiliaryStatus.toUpperCase();
      return value > 0 ? 'FLAME DETECTED' : 'AMAN';
    }
    case 'rain': {
      const status = auxiliaryStatus ? auxiliaryStatus.toUpperCase() : '';
      if (status.includes('LEBAT') || value >= 5.0) return 'HUJAN LEBAT';
      if (status.includes('HUJAN') || status.includes('GERIMIS') || value > 0) return 'GERIMIS';
      return 'TIDAK HUJAN';
    }
    case 'light':
      return value > 45000 ? 'TERIK INTENS' : value > 12000 ? 'TERANG SIANG' : 'TEDUH / MALAM';
    case 'ffmc':
      return value >= 89.5 ? 'ZONA PENYALAAN' : value >= 82.0 ? 'PENGERINGAN' : 'KADAR AIR AMAN';
    default:
      return isStale ? 'STALE' : 'NOT CONNECTED';
  }
}

/**
 * Returns device connectivity badge text.
 */
export function getDeviceConnectivityStatus(
  isLiveTelemetry: boolean,
  isTelemetryStale: boolean,
  gatewayStatus: 'connecting' | 'connected' | 'error' | 'closed',
  mqttConnected = false
): {
  text: string;
  dotClass: string;
  wrapperClass: string;
  isOnline: boolean;
} {
  // Fresh valid live telemetry from physical ESP32
  if (isLiveTelemetry && !isTelemetryStale) {
    return {
      text: 'DEVICE ONLINE · LIVE',
      dotClass: 'bg-[#16A34A] animate-pulse ring-2 ring-[#5DD62C]/40',
      wrapperClass: 'bg-[#EFF3EF] border-[#5DD62C] text-[#263A35]',
      isOnline: true,
    };
  }

  // Telemetry was streaming but has stopped / exceeded 10s watchdog
  if (isLiveTelemetry && isTelemetryStale) {
    return {
      text: 'DEVICE OFFLINE (STALE TELEMETRY)',
      dotClass: 'bg-[#D97706] animate-pulse ring-2 ring-[#D97706]/40',
      wrapperClass: 'bg-[#FEF7E8] border-[#FDE3B5] text-[#8A570C]',
      isOnline: false,
    };
  }

  // Gateway SSE is connected, but broker is disconnected or no telemetry received yet
  if (gatewayStatus === 'connected') {
    if (!mqttConnected) {
      return {
        text: 'DEVICE OFFLINE (MQTT DISCONNECTED)',
        dotClass: 'bg-[#D97706] animate-pulse ring-2 ring-[#D97706]/40',
        wrapperClass: 'bg-[#FEF7E8] border-[#FDE3B5] text-[#8A570C]',
        isOnline: false,
      };
    }
    return {
      text: 'DEVICE NOT CONNECTED (NO TELEMETRY)',
      dotClass: 'bg-[#94A3B8]',
      wrapperClass: 'bg-white border-[#A6B49E] text-[#263A35]',
      isOnline: false,
    };
  }

  // Gateway connecting
  if (gatewayStatus === 'connecting') {
    return {
      text: 'CONNECTING TO GATEWAY...',
      dotClass: 'bg-[#D97706] animate-pulse',
      wrapperClass: 'bg-white border-[#D6DCCE] text-[#263A35]',
      isOnline: false,
    };
  }

  // Gateway closed or error
  return {
    text: 'GATEWAY OFFLINE',
    dotClass: 'bg-[#DC2626]',
    wrapperClass: 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]',
    isOnline: false,
  };
}

/**
 * Strict safety check for Model 1 and Model 2 evaluation.
 * Returns false if telemetry is offline, stale, or any required feature is missing.
 */
export function isModelEvaluationPermitted(
  isLiveTelemetry: boolean,
  isTelemetryStale: boolean,
  requiredFeatures: Array<number | null | undefined>
): boolean {
  if (!isLiveTelemetry || isTelemetryStale) {
    return false;
  }
  for (const feat of requiredFeatures) {
    if (typeof feat !== 'number' || !Number.isFinite(feat)) {
      return false;
    }
  }
  return true;
}

