/**
 * Flora AI Dashboard — BMKG Forecast Parser
 * Defensively parses raw JSON responses and validates numeric bounds and timestamps.
 */

import type {
  BmkgForecastStepNormalized,
  BmkgNormalizedForecast,
  BmkgRawForecastPayload,
  BmkgRawForecastStep,
} from '../types/bmkg.ts';

export interface ParseForecastResult {
  success: boolean;
  data?: BmkgNormalizedForecast;
  error?: string;
  isDrift?: boolean;
}

/**
 * Validates whether an adm4 administrative code matches the standard dot-delimited format.
 */
export function isValidAdm4Code(code: string): boolean {
  if (typeof code !== 'string') return false;
  return /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(code.trim());
}

/**
 * Normalizes an individual forecast step defensively.
 */
export function normalizeForecastStep(
  raw: unknown
): BmkgForecastStepNormalized | null {
  if (!raw || typeof raw !== 'object') return null;

  const step = raw as Partial<BmkgRawForecastStep>;

  // Required numeric checks
  const t = Number(step.t);
  const hu = Number(step.hu);
  const ws = Number(step.ws);

  if (!Number.isFinite(t) || t < -40 || t > 65) return null;
  if (!Number.isFinite(hu) || hu < 0 || hu > 100) return null;
  if (!Number.isFinite(ws) || ws < 0 || ws > 250) return null;

  // Timestamps: Preserve source verbatim without fabricating timezones or appending Z
  const utcDatetime = typeof step.utc_datetime === 'string' ? step.utc_datetime.trim() : '';
  const localDatetime = typeof step.local_datetime === 'string' ? step.local_datetime.trim() : '';
  const isoDatetime = typeof step.datetime === 'string' ? step.datetime.trim() : (utcDatetime || localDatetime);

  if (!utcDatetime && !localDatetime && !isoDatetime) {
    return null;
  }

  // Optional fields with safe fallbacks
  const wdDeg = Number(step.wd_deg);
  const weatherCode = Number(step.weather);
  const tcc = Number(step.tcc);
  const tp = Number(step.tp);

  return {
    utcDatetime,
    localDatetime,
    isoDatetime,
    temperatureC: Math.round(t * 10) / 10,
    humidityPercent: Math.round(hu),
    windSpeedKmh: Math.round(ws * 10) / 10,
    windDirectionDegrees: Number.isFinite(wdDeg) ? wdDeg : undefined,
    windDirectionCardinal: typeof step.wd === 'string' ? step.wd.trim() : undefined,
    weatherCode: Number.isFinite(weatherCode) ? weatherCode : undefined,
    weatherDesc: typeof step.weather_desc === 'string' ? step.weather_desc.trim() : 'Cuaca tidak terdokumentasi',
    weatherDescEn: typeof step.weather_desc_en === 'string' ? step.weather_desc_en.trim() : 'Undocumented weather',
    cloudCoverPercent: Number.isFinite(tcc) && tcc >= 0 && tcc <= 100 ? tcc : undefined,
    precipitationMm: Number.isFinite(tp) && tp >= 0 ? tp : undefined,
    visibilityText: typeof step.vs_text === 'string' ? step.vs_text.trim() : undefined,
    iconUrl: typeof step.image === 'string' ? step.image.trim() : undefined,
  };
}

/**
 * Parses and flattens a complete BMKG forecast payload.
 */
export function parseBmkgForecast(
  rawPayload: unknown,
  clientFetchedAt: number = Date.now()
): ParseForecastResult {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return {
      success: false,
      error: 'Payload is null, undefined, or not a JSON object',
      isDrift: true,
    };
  }

  const payload = rawPayload as Partial<BmkgRawForecastPayload>;

  // Check envelope lokasi
  const rootLokasi = payload.lokasi;
  const dataGroups = payload.data;

  if (!Array.isArray(dataGroups) || dataGroups.length === 0) {
    return {
      success: false,
      error: 'Payload data property is missing or empty array',
      isDrift: true,
    };
  }

  // Flatten all cuaca steps across all data groups and all day intervals
  const rawSteps: unknown[] = [];
  let firstGroupLokasi = rootLokasi;

  for (const group of dataGroups) {
    if (group && typeof group === 'object') {
      if (!firstGroupLokasi && group.lokasi) {
        firstGroupLokasi = group.lokasi;
      }
      if (Array.isArray(group.cuaca)) {
        for (const interval of group.cuaca) {
          if (Array.isArray(interval)) {
            rawSteps.push(...interval);
          } else if (interval && typeof interval === 'object') {
            rawSteps.push(interval);
          }
        }
      }
    }
  }

  if (rawSteps.length === 0) {
    return {
      success: false,
      error: 'No forecast steps found under data[].cuaca',
      isDrift: false,
    };
  }

  const normalizedSteps: BmkgForecastStepNormalized[] = [];
  let failedStepCount = 0;

  for (const rawStep of rawSteps) {
    const normalized = normalizeForecastStep(rawStep);
    if (normalized) {
      normalizedSteps.push(normalized);
    } else {
      failedStepCount++;
    }
  }

  // Drift check: If over 50% of forecast records fail validation, reject
  if (normalizedSteps.length === 0 || failedStepCount > normalizedSteps.length) {
    return {
      success: false,
      error: `Severe schema drift: ${failedStepCount} of ${rawSteps.length} records were invalid`,
      isDrift: true,
    };
  }

  // Deduplicate intervals only when records can reliably be identified as the same interval
  const deduplicatedSteps: BmkgForecastStepNormalized[] = [];
  const seenStepKeys = new Set<string>();

  for (const step of normalizedSteps) {
    const key = step.utcDatetime || step.isoDatetime || step.localDatetime;
    if (key) {
      if (!seenStepKeys.has(key)) {
        seenStepKeys.add(key);
        deduplicatedSteps.push(step);
      }
    } else {
      deduplicatedSteps.push(step);
    }
  }

  // Sort intervals chronologically only when timestamps can be interpreted safely
  const sortedSteps = [...deduplicatedSteps].sort((a, b) => {
    const epochA = getSafeStepEpoch(a);
    const epochB = getSafeStepEpoch(b);
    if (epochA !== null && epochB !== null) {
      return epochA - epochB;
    }
    return 0; // Preserve relative stable order if uninterpretable
  });

  // Location metadata extraction
  const adm4 = typeof firstGroupLokasi?.adm4 === 'string' ? firstGroupLokasi.adm4.trim() : 'Unknown';
  const desa = typeof firstGroupLokasi?.desa === 'string' ? firstGroupLokasi.desa.trim() : 'Lokasi';
  const kecamatan = typeof firstGroupLokasi?.kecamatan === 'string' ? firstGroupLokasi.kecamatan.trim() : '';
  const kotkab = typeof firstGroupLokasi?.kotkab === 'string' ? firstGroupLokasi.kotkab.trim() : '';
  const provinsi = typeof firstGroupLokasi?.provinsi === 'string' ? firstGroupLokasi.provinsi.trim() : '';
  const timezone = typeof firstGroupLokasi?.timezone === 'string' ? firstGroupLokasi.timezone.trim() : 'WIB';

  const lat = Number(firstGroupLokasi?.lat);
  const lon = Number(firstGroupLokasi?.lon);

  // Extract analysis date from the first step if present
  const firstRawStep = rawSteps[0] as Partial<BmkgRawForecastStep> | undefined;
  const analysisDate = typeof firstRawStep?.analysis_date === 'string' ? firstRawStep.analysis_date.trim() : null;

  const locationName = [desa, kecamatan, kotkab].filter(Boolean).join(', ') || adm4;

  // Determine currentStep dynamically rather than blindly picking index 0
  const currentStep = findBestCurrentStep(sortedSteps, clientFetchedAt);

  const normalizedForecast: BmkgNormalizedForecast = {
    adm4,
    locationName,
    hierarchy: {
      village: desa,
      district: kecamatan,
      regency: kotkab,
      province: provinsi,
    },
    coordinates: {
      lat: Number.isFinite(lat) ? lat : 0,
      lon: Number.isFinite(lon) ? lon : 0,
    },
    timezone,
    analysisDate,
    clientFetchedAt,
    currentStep,
    allSteps: sortedSteps,
  };

  return {
    success: true,
    data: normalizedForecast,
  };
}

/**
 * Safely extracts epoch milliseconds from a normalized step without inventing timezone offsets
 * or altering the original timestamp strings.
 */
export function getSafeStepEpoch(step: BmkgForecastStepNormalized): number | null {
  // 1. UTC Datetime with explicit or implicit Z
  if (step.utcDatetime) {
    const cleaned = step.utcDatetime.replace(' ', 'T');
    const withZ = cleaned.endsWith('Z') ? cleaned : `${cleaned}Z`;
    const epoch = Date.parse(withZ);
    if (!isNaN(epoch)) return epoch;
  }

  // 2. ISO Datetime with explicit timezone offset or Z
  if (step.isoDatetime && (step.isoDatetime.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(step.isoDatetime))) {
    const epoch = Date.parse(step.isoDatetime);
    if (!isNaN(epoch)) return epoch;
  }

  // 3. Fallback: Parse localDatetime if standard ISO-like format exists
  if (step.localDatetime) {
    const epoch = Date.parse(step.localDatetime.replace(' ', 'T'));
    if (!isNaN(epoch)) return epoch;
  }

  return null;
}

/**
 * Finds the forecast step closest to clientFetchedAt without assuming the first item
 * in the payload is current.
 */
export function findBestCurrentStep(
  steps: BmkgForecastStepNormalized[],
  clientFetchedAt: number
): BmkgForecastStepNormalized {
  if (steps.length === 0) {
    throw new Error('Steps array cannot be empty');
  }

  if (!Number.isFinite(clientFetchedAt) || clientFetchedAt <= 0) {
    return steps[0];
  }

  let bestStep = steps[0];
  let minDiff = Infinity;
  let hasValidEpoch = false;

  for (const step of steps) {
    const epoch = getSafeStepEpoch(step);
    if (epoch !== null) {
      hasValidEpoch = true;
      const diff = Math.abs(epoch - clientFetchedAt);
      if (diff < minDiff) {
        minDiff = diff;
        bestStep = step;
      }
    }
  }

  if (!hasValidEpoch) {
    return steps[0];
  }

  return bestStep;
}

/**
 * Translates IANA timezone identifiers to standard Indonesian timezone abbreviations
 * or truthful neutral labels without hardcoding WIB indiscriminately.
 */
export function getTimezoneLabel(ianaTimezone?: string | null): string {
  if (!ianaTimezone) return 'Waktu Lokal';
  const clean = ianaTimezone.trim();
  switch (clean) {
    case 'Asia/Jakarta':
    case 'Asia/Pontianak':
    case '+0700':
    case '+07:00':
    case 'WIB':
      return 'WIB';
    case 'Asia/Makassar':
    case 'Asia/Ujung_Pandang':
    case 'Asia/Denpasar':
    case '+0800':
    case '+08:00':
    case 'WITA':
      return 'WITA';
    case 'Asia/Jayapura':
    case '+0900':
    case '+09:00':
    case 'WIT':
      return 'WIT';
    default:
      return clean;
  }
}
