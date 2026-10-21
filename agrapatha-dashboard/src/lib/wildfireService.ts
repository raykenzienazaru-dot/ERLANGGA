/**
 * Wildfire Inference Client Service
 * Connects directly to the verified Railway FastAPI TFLite MobileNetV2 backend.
 * Endpoints: GET /api/v1/health, POST /api/v1/predict
 */

import type {
  WildfireClass,
  WildfireHealthResponse,
  WildfirePredictionData,
  WildfirePredictionResponse,
} from '../types/vision';

const DEFAULT_WILDFIRE_API_URL = 'https://tes-tflite-production.up.railway.app';

function getEnvVar(key: string): string | undefined {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string, string> }).env) {
      const val = (import.meta as unknown as { env?: Record<string, string> }).env?.[key];
      if (typeof val === 'string') return val;
    }
  } catch {
    // ignore
  }
  try {
    const g = typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>) : undefined;
    const proc = g && typeof g.process === 'object' && g.process !== null ? (g.process as { env?: Record<string, string> }) : undefined;
    if (proc?.env && typeof proc.env[key] === 'string') {
      return proc.env[key];
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function getWildfireApiBaseUrl(): string {
  const envUrl = getEnvVar('VITE_VISION_API_BASE_URL');
  if (typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return DEFAULT_WILDFIRE_API_URL;
}

/**
 * Type guard to validate whether an object matches WildfirePredictionData
 */
export function isValidWildfireData(data: unknown): data is WildfirePredictionData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;

  const validClasses: WildfireClass[] = ['Non-Fire', 'Smoke', 'Fire'];
  if (!validClasses.includes(d.predicted_label as WildfireClass)) {
    return false;
  }

  if (typeof d.confidence !== 'number' || typeof d.confidence_percentage !== 'number') {
    return false;
  }

  if (!d.scores || typeof d.scores !== 'object') {
    return false;
  }

  const scores = d.scores as Record<string, unknown>;
  for (const c of validClasses) {
    if (typeof scores[c] !== 'number') {
      return false;
    }
  }

  return true;
}

/**
 * Predicts wildfire hazard from a captured or uploaded image Blob/File.
 * Sends multipart/form-data with field name 'file'.
 */
export async function predictWildfireImage(
  imageBlob: Blob | File,
  signal?: AbortSignal
): Promise<WildfirePredictionResponse> {
  const baseUrl = getWildfireApiBaseUrl();
  const endpoint = `${baseUrl}/api/v1/predict`;

  const formData = new FormData();
  const fileName = imageBlob instanceof File && imageBlob.name ? imageBlob.name : 'frame.jpg';
  formData.append('file', imageBlob, fileName);

  // Setup 15s timeout controller merged with caller signal if provided
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 15000);

  const onCallerAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      return { success: false, data: null, error: 'Permintaan dibatalkan.' };
    }
    signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        // Do NOT set Content-Type: browser must append multipart boundary
      },
      body: formData,
      signal: timeoutController.signal,
    });

    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onCallerAbort);
    }

    if (!response.ok) {
      let errorMsg = `Server mengembalikan status HTTP ${response.status} (${response.statusText})`;
      try {
        const text = await response.text();
        if (text.includes('Disallowed CORS origin')) {
          errorMsg = 'Origin browser ini tidak masuk dalam allowlist CORS server Railway. Harap jalankan dari port yang diizinkan (http://localhost:5173).';
        } else {
          const errJson = JSON.parse(text);
          if (errJson.error) {
            errorMsg = String(errJson.error);
          } else if (errJson.detail) {
            errorMsg = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
          }
        }
      } catch {
        // use fallback status message
      }

      return {
        success: false,
        data: null,
        error: errorMsg,
      };
    }

    const json = await response.json();

    if (!json.success || !json.data) {
      return {
        success: false,
        data: null,
        error: json.error || 'Server tidak mengembalikan hasil analisis citra yang valid.',
      };
    }

    if (!isValidWildfireData(json.data)) {
      return {
        success: false,
        data: null,
        error: 'Struktur data respon model tidak sesuai dengan kontrak kelas [Non-Fire, Smoke, Fire].',
      };
    }

    return {
      success: true,
      data: json.data,
      error: null,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onCallerAbort);
    }

    if (err instanceof DOMException && err.name === 'AbortError') {
      if (signal?.aborted) {
        return { success: false, data: null, error: 'Permintaan dibatalkan oleh pengguna.' };
      }
      return { success: false, data: null, error: 'Koneksi ke backend inferensi timeout (melebihi 15 detik).' };
    }

    const message = err instanceof Error ? err.message : 'Gagal menghubungi server inferensi.';
    return {
      success: false,
      data: null,
      error: `Kendala jaringan / CORS: ${message}`,
    };
  }
}

/**
 * Checks model readiness and server status via GET /api/v1/health.
 */
export async function checkWildfireHealth(signal?: AbortSignal): Promise<WildfireHealthResponse> {
  const baseUrl = getWildfireApiBaseUrl();
  const endpoint = `${baseUrl}/api/v1/health`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  return (await response.json()) as WildfireHealthResponse;
}
