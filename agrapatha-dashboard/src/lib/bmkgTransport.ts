/**
 * Flora AI Dashboard — BMKG Transport Layer
 * Handles network requests, timeout enforcement, AbortSignal lifecycles, and mock injection.
 */

const DEFAULT_TIMEOUT_MS = 8000;

export function getBmkgBaseUrl(): string {
  // Allows override via environment variable if deployed behind custom gateway
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BMKG_BASE_URL) {
    return import.meta.env.VITE_BMKG_BASE_URL;
  }
  return '/api/bmkg';
}

export function buildForecastEndpointUrl(adm4: string): string {
  const base = getBmkgBaseUrl();
  return `${base}/forecast?adm4=${encodeURIComponent(adm4.trim())}`;
}

export function buildWarningEndpointUrl(lang: 'id' | 'en' = 'id'): string {
  const base = getBmkgBaseUrl();
  return `${base}/nowcast/${lang}`;
}

export interface FetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  mockFixture?: unknown;
  mockFixtureXml?: string;
}

/**
 * Fetch raw forecast payload from BMKG endpoint or mock fixture.
 */
export async function fetchRawForecast(adm4: string, options: FetchOptions = {}): Promise<unknown> {
  // If test or local mock fixture is provided, return immediately without network call
  if (options.mockFixture !== undefined) {
    return options.mockFixture;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const signal = options.signal
    ? anySignal([options.signal, controller.signal])
    : controller.signal;

  try {
    const url = buildForecastEndpointUrl(adm4);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms or was cancelled`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch raw warning feed XML string from BMKG endpoint or mock fixture.
 */
export async function fetchRawWarnings(options: FetchOptions = {}): Promise<string> {
  // If test or local mock XML is provided, return immediately without network call
  if (options.mockFixtureXml !== undefined) {
    return options.mockFixtureXml;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const signal = options.signal
    ? anySignal([options.signal, controller.signal])
    : controller.signal;

  try {
    const url = buildWarningEndpointUrl('id');
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    return xmlText;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms or was cancelled`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Helper to combine multiple AbortSignals for Node / Browser compatibility.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort();
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
