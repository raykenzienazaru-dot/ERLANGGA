/**
 * Flora AI Dashboard — BMKG Service & Cache Manager
 * Enforces Flora project cache freshness policies, state transitions, and request lifecycles.
 */

import type {
  BmkgCacheFreshness,
  BmkgNormalizedAlert,
  BmkgNormalizedForecast,
  BmkgRegionRecord,
  BmkgServiceState,
} from '../types/bmkg.ts';
import { parseBmkgForecast } from './bmkgForecastParser.ts';
import { fetchRawForecast, fetchRawWarnings } from './bmkgTransport.ts';
import { parseBmkgWarnings } from './bmkgWarningParser.ts';

// Flora Project Cache Policy Boundaries (in milliseconds)
export const FRESH_THRESHOLD_MS = 15 * 60 * 1000;      // 0 - 15 minutes
export const STALE_THRESHOLD_MS = 60 * 60 * 1000;      // 15 - 60 minutes
export const DISCARD_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedForecastEntry {
  adm4: string;
  forecast: BmkgNormalizedForecast;
  fetchedAt: number;
}

interface CachedWarningFeedEntry {
  xmlText: string;
  fetchedAt: number;
}

// In-Memory cache records
const forecastMemoryCache = new Map<string, CachedForecastEntry>();
let warningFeedMemoryCache: CachedWarningFeedEntry | null = null;

// Track latest request to prevent delayed asynchronous responses from overwriting the active region
let latestRequestedAdm4 = '';
let latestRequestId = 0;

// Track in-flight request controllers to cancel stale queries on region switch
let activeForecastAbortController: AbortController | null = null;
let activeWarningAbortController: AbortController | null = null;

/**
 * Evaluates cache freshness state deterministically.
 */
export function evaluateCacheFreshness(fetchedAt: number, now: number = Date.now()): BmkgCacheFreshness {
  const age = Math.max(0, now - fetchedAt);
  if (age <= FRESH_THRESHOLD_MS) return 'FRESH';
  if (age <= STALE_THRESHOLD_MS) return 'STALE_USABLE';
  if (age <= DISCARD_THRESHOLD_MS) return 'EXPIRED_UNUSABLE';
  return 'DISCARDED';
}

/**
 * Format relative minutes/hours for human-readable freshness badges.
 */
export function formatDataAge(fetchedAt: number, now: number = Date.now()): string {
  const diffMinutes = Math.floor(Math.max(0, now - fetchedAt) / 60000);
  if (diffMinutes < 1) return 'baru saja';
  if (diffMinutes < 60) return `${diffMinutes} menit yang lalu`;
  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours} jam yang lalu`;
}

/**
 * Loads forecast from in-memory cache or sessionStorage if valid.
 */
function getCachedForecast(adm4: string, now: number = Date.now()): CachedForecastEntry | null {
  // Check in-memory
  const entry = forecastMemoryCache.get(adm4);
  if (entry) {
    const freshness = evaluateCacheFreshness(entry.fetchedAt, now);
    if (freshness === 'DISCARDED') {
      forecastMemoryCache.delete(adm4);
      return null;
    }
    return entry;
  }

  // Check sessionStorage fallback
  if (typeof sessionStorage !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(`flora_bmkg_fc_${adm4}`);
      if (raw) {
        const parsed = JSON.parse(raw) as CachedForecastEntry;
        const freshness = evaluateCacheFreshness(parsed.fetchedAt, now);
        if (freshness === 'DISCARDED') {
          sessionStorage.removeItem(`flora_bmkg_fc_${adm4}`);
          return null;
        }
        forecastMemoryCache.set(adm4, parsed);
        return parsed;
      }
    } catch {
      // Ignore storage read errors
    }
  }

  return null;
}

/**
 * Persists forecast into in-memory cache and sessionStorage.
 */
function setCachedForecast(adm4: string, forecast: BmkgNormalizedForecast, fetchedAt: number): void {
  const entry: CachedForecastEntry = { adm4, forecast, fetchedAt };
  forecastMemoryCache.set(adm4, entry);

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(`flora_bmkg_fc_${adm4}`, JSON.stringify(entry));
    } catch {
      // Storage quota full or unavailable
    }
  }
}

export interface ServiceExecutionOptions {
  forceRefresh?: boolean;
  mockFixtureForecast?: unknown;
  mockFixtureWarningXml?: string;
  now?: number;
}

/**
 * Main service orchestrator to fetch and resolve BMKG weather forecast and nowcast warnings.
 */
export async function getBmkgRegionalData(
  region: BmkgRegionRecord,
  options: ServiceExecutionOptions = {}
): Promise<BmkgServiceState> {
  const now = options.now ?? Date.now();
  const adm4 = region.adm4.trim();

  // Track request sequence to prevent delayed asynchronous responses from an old region overwriting active state
  const currentRequestId = ++latestRequestId;
  latestRequestedAdm4 = adm4;

  // Cancel prior in-flight forecast request
  if (activeForecastAbortController) {
    activeForecastAbortController.abort();
  }
  activeForecastAbortController = new AbortController();
  const forecastSignal = activeForecastAbortController.signal;

  // Helper to ensure current response is still relevant
  const isSuperseded = () => latestRequestId !== currentRequestId || latestRequestedAdm4 !== adm4;

  // Check existing cache
  const cached = getCachedForecast(adm4, now);
  let cachedForecast: BmkgNormalizedForecast | null = null;
  let freshness: BmkgCacheFreshness = 'DISCARDED';

  if (cached) {
    freshness = evaluateCacheFreshness(cached.fetchedAt, now);
    if (freshness === 'FRESH' && !options.forceRefresh && options.mockFixtureForecast === undefined) {
      // Serve immediately from FRESH cache, evaluating warnings specifically for this region
      const alerts = await getBmkgWarnings(region, {
        signal: forecastSignal,
        mockXml: options.mockFixtureWarningXml,
        now,
      });

      if (isSuperseded()) {
        return {
          status: 'LOADING',
          forecast: null,
          alerts: [],
          selectedRegion: region,
          retrievalTimestamp: null,
          sourceAnalysisDate: null,
          errorMessage: null,
          staleReason: null,
        };
      }

      return {
        status: 'SUCCESS_FRESH',
        forecast: cached.forecast,
        alerts,
        selectedRegion: region,
        retrievalTimestamp: cached.fetchedAt,
        sourceAnalysisDate: cached.forecast.analysisDate,
        errorMessage: null,
        staleReason: null,
      };
    }
    // STALE_USABLE or EXPIRED_UNUSABLE can be retained as fallback
    cachedForecast = cached.forecast;
  }

  // Network fetch needed
  try {
    const rawForecast = await fetchRawForecast(adm4, {
      signal: forecastSignal,
      mockFixture: options.mockFixtureForecast,
    });

    if (isSuperseded()) {
      return {
        status: 'LOADING',
        forecast: null,
        alerts: [],
        selectedRegion: region,
        retrievalTimestamp: null,
        sourceAnalysisDate: null,
        errorMessage: null,
        staleReason: null,
      };
    }

    const parseResult = parseBmkgForecast(rawForecast, now);

    if (!parseResult.success || !parseResult.data) {
      throw new Error(parseResult.error || 'Failed to parse BMKG forecast payload');
    }

    const liveForecast = parseResult.data;
    setCachedForecast(adm4, liveForecast, now);

    const alerts = await getBmkgWarnings(region, {
      signal: forecastSignal,
      mockXml: options.mockFixtureWarningXml,
      now,
    });

    if (isSuperseded()) {
      return {
        status: 'LOADING',
        forecast: null,
        alerts: [],
        selectedRegion: region,
        retrievalTimestamp: null,
        sourceAnalysisDate: null,
        errorMessage: null,
        staleReason: null,
      };
    }

    return {
      status: 'SUCCESS_FRESH',
      forecast: liveForecast,
      alerts,
      selectedRegion: region,
      retrievalTimestamp: now,
      sourceAnalysisDate: liveForecast.analysisDate,
      errorMessage: null,
      staleReason: null,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown network failure';

    // If abort occurred due to user switching region or cancelled request, handle cleanly
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        status: 'LOADING',
        forecast: null,
        alerts: [],
        selectedRegion: region,
        retrievalTimestamp: null,
        sourceAnalysisDate: null,
        errorMessage: null,
        staleReason: null,
      };
    }

    if (isSuperseded()) {
      return {
        status: 'LOADING',
        forecast: null,
        alerts: [],
        selectedRegion: region,
        retrievalTimestamp: null,
        sourceAnalysisDate: null,
        errorMessage: null,
        staleReason: null,
      };
    }

    // Attempt fallback to cached data if available
    if (cached && cachedForecast) {
      const currentFreshness = evaluateCacheFreshness(cached.fetchedAt, now);
      if (currentFreshness === 'STALE_USABLE') {
        const alerts = await getBmkgWarnings(region, {
          signal: forecastSignal,
          mockXml: options.mockFixtureWarningXml,
          now,
        });
        return {
          status: 'SUCCESS_STALE',
          forecast: cachedForecast,
          alerts,
          selectedRegion: region,
          retrievalTimestamp: cached.fetchedAt,
          sourceAnalysisDate: cachedForecast.analysisDate,
          errorMessage: errorMsg,
          staleReason: `BMKG belum dapat dihubungi (${errorMsg}). Menampilkan data tersimpan (${formatDataAge(cached.fetchedAt, now)}).`,
        };
      }
      if (currentFreshness === 'EXPIRED_UNUSABLE') {
        // Expired data must NOT be displayed as current operational forecast
        return {
          status: 'EXPIRED',
          forecast: null, // Suppress from current view
          alerts: [],
          selectedRegion: region,
          retrievalTimestamp: cached.fetchedAt,
          sourceAnalysisDate: cachedForecast.analysisDate,
          errorMessage: `Prakiraan cuaca telah kedaluwarsa (${formatDataAge(cached.fetchedAt, now)}). Harap perbarui koneksi BMKG.`,
          staleReason: 'Kedaluwarsa',
        };
      }
    }

    // No usable cache available -> Return ERROR
    return {
      status: 'ERROR',
      forecast: null,
      alerts: [],
      selectedRegion: region,
      retrievalTimestamp: null,
      sourceAnalysisDate: null,
      errorMessage: errorMsg,
      staleReason: null,
    };
  }
}

/**
 * Fetch and parse active warnings for the given region.
 * Stores raw XML in memory cache and evaluates applicability specifically per region.
 */
export async function getBmkgWarnings(
  region: BmkgRegionRecord,
  options: { signal?: AbortSignal; mockXml?: string; now?: number } = {}
): Promise<BmkgNormalizedAlert[]> {
  const now = options.now ?? Date.now();

  // If local mock XML is provided, cache raw XML and evaluate for current region
  if (options.mockXml !== undefined) {
    warningFeedMemoryCache = {
      xmlText: options.mockXml,
      fetchedAt: now,
    };
    const parseResult = parseBmkgWarnings(options.mockXml, region);
    return parseResult.success ? parseResult.alerts : [];
  }

  // If raw XML cache exists and is fresh (< 15 min), evaluate specifically for the requested region
  if (warningFeedMemoryCache) {
    const age = now - warningFeedMemoryCache.fetchedAt;
    if (age <= FRESH_THRESHOLD_MS) {
      const parseResult = parseBmkgWarnings(warningFeedMemoryCache.xmlText, region);
      return parseResult.success ? parseResult.alerts : [];
    }
  }

  // Cancel prior warning request
  if (activeWarningAbortController) {
    activeWarningAbortController.abort();
  }
  activeWarningAbortController = new AbortController();

  try {
    const xmlText = await fetchRawWarnings({
      signal: options.signal || activeWarningAbortController.signal,
      mockFixtureXml: options.mockXml,
    });

    warningFeedMemoryCache = {
      xmlText,
      fetchedAt: now,
    };

    const result = parseBmkgWarnings(xmlText, region);
    return result.success ? result.alerts : [];
  } catch {
    // If warnings fetch fails, fallback to stale cached raw XML evaluated specifically for current region
    if (warningFeedMemoryCache) {
      const freshness = evaluateCacheFreshness(warningFeedMemoryCache.fetchedAt, now);
      if (freshness === 'FRESH' || freshness === 'STALE_USABLE') {
        const result = parseBmkgWarnings(warningFeedMemoryCache.xmlText, region);
        return result.success ? result.alerts : [];
      }
    }
    return [];
  }
}

/**
 * Clears in-memory and stored caches (useful for testing and reset).
 */
export function clearBmkgCache(): void {
  forecastMemoryCache.clear();
  warningFeedMemoryCache = null;
  latestRequestedAdm4 = '';
  latestRequestId = 0;
  if (typeof sessionStorage !== 'undefined') {
    try {
      const keys = Object.keys(sessionStorage).filter((k) => k.startsWith('flora_bmkg_'));
      for (const k of keys) {
        sessionStorage.removeItem(k);
      }
    } catch {
      // Ignore
    }
  }
}
