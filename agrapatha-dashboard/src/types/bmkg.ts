/**
 * Flora AI Dashboard — BMKG Integration Types
 * Strictly isolated external weather and early warning contracts.
 */

export interface BmkgRawLocation {
  adm1: string;
  adm2: string;
  adm3: string;
  adm4: string;
  provinsi: string;
  kotkab: string;
  kecamatan: string;
  desa: string;
  lon: number;
  lat: number;
  timezone: string;
  type?: string;
}

export interface BmkgRawForecastStep {
  datetime: string;
  utc_datetime: string;
  local_datetime: string;
  t: number;
  hu: number;
  ws: number;
  wd_deg?: number;
  wd?: string;
  wd_to?: string;
  weather?: number;
  weather_desc?: string;
  weather_desc_en?: string;
  tcc?: number;
  tp?: number;
  vs?: number;
  vs_text?: string;
  time_index?: string;
  analysis_date?: string;
  image?: string;
}

export interface BmkgRawDataGroup {
  lokasi?: BmkgRawLocation;
  cuaca?: BmkgRawForecastStep[][];
}

export interface BmkgRawForecastPayload {
  lokasi?: BmkgRawLocation;
  data?: BmkgRawDataGroup[];
}

export interface BmkgForecastStepNormalized {
  utcDatetime: string;
  localDatetime: string;
  isoDatetime: string;
  temperatureC: number;
  humidityPercent: number;
  windSpeedKmh: number;
  windDirectionDegrees?: number;
  windDirectionCardinal?: string;
  weatherCode?: number;
  weatherDesc: string;
  weatherDescEn: string;
  cloudCoverPercent?: number;
  precipitationMm?: number;
  visibilityText?: string;
  iconUrl?: string;
}

export interface BmkgNormalizedForecast {
  adm4: string;
  locationName: string;
  hierarchy: {
    village: string;
    district: string;
    regency: string;
    province: string;
  };
  coordinates: {
    lat: number;
    lon: number;
  };
  timezone: string;
  analysisDate: string | null;
  clientFetchedAt: number;
  currentStep: BmkgForecastStepNormalized;
  allSteps: BmkgForecastStepNormalized[];
}

export type BmkgSpatialApplicability =
  | 'GEOGRAPHIC_MATCH'
  | 'REGIONAL_UNVERIFIED'
  | 'UNKNOWN_SCOPE';

export interface BmkgNormalizedAlert {
  id: string;
  headline: string;
  event: string;
  description: string;
  effectiveTime: string | null;
  expiresTime: string | null;
  validityStatus: 'VALID' | 'EXPIRED' | 'UNKNOWN_EXPIRY';
  sender: string;
  sourceUrl: string;
  applicability: BmkgSpatialApplicability;
  geographicScope: string;
  polygonCoordinates?: [number, number][];
  allPolygons?: [number, number][][];
}

export interface BmkgRegionRecord {
  adm4: string;
  desa: string;
  kecamatan: string;
  kotkab: string;
  provinsi: string;
  timezone: string;
  coordinates: {
    lat: number;
    lon: number;
  };
  isVerified: boolean;
  notes?: string;
}

export type BmkgCacheFreshness =
  | 'FRESH'
  | 'STALE_USABLE'
  | 'EXPIRED_UNUSABLE'
  | 'DISCARDED';

export type BmkgServiceStatus =
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS_FRESH'
  | 'SUCCESS_STALE'
  | 'EXPIRED'
  | 'EMPTY'
  | 'ERROR';

export interface BmkgServiceState {
  status: BmkgServiceStatus;
  forecast: BmkgNormalizedForecast | null;
  alerts: BmkgNormalizedAlert[];
  selectedRegion: BmkgRegionRecord;
  retrievalTimestamp: number | null;
  sourceAnalysisDate: string | null;
  errorMessage: string | null;
  staleReason: string | null;
}
