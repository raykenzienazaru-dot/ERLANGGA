/**
 * Leaf Disease Inference Client Service
 * Independent contract for Plant Pathology diagnostics:
 * Classes: Healthy, Powdery Mildew, Leaf Rust
 *
 * NOTE: As identified in Phase 2A audit, no public backend REST endpoint is currently deployed.
 * If VITE_LEAF_API_BASE_URL is unconfigured, this service returns an explicit,
 * actionable service-unavailable response and NEVER falls back to the wildfire endpoint.
 */

import type {
  LeafDiseaseClass,
  LeafDiseaseClassScore,
  LeafDiseaseHealthResponse,
  LeafDiseasePredictionData,
  LeafDiseasePredictionResponse,
} from '../types/vision';

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

import { getIotConfig } from '../config/iotConfig.ts';

export function getLeafDiseaseApiBaseUrl(): string | null {
  const envUrl = getEnvVar('VITE_LEAF_API_BASE_URL');
  if (typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return getIotConfig().railway.leafUrl;
}

export function isLeafDiseaseApiConfigured(): boolean {
  return getLeafDiseaseApiBaseUrl() !== null;
}

/**
 * Normalizes raw candidate labels ('Powdery', 'Rust') or canonical labels
 * to the verified frontend classes: 'Healthy' | 'Powdery Mildew' | 'Leaf Rust'.
 */
export function normalizeLeafClass(label: unknown): LeafDiseaseClass | null {
  if (typeof label !== 'string') return null;
  const trimmed = label.trim();
  if (trimmed === 'Healthy') return 'Healthy';
  if (trimmed === 'Powdery' || trimmed === 'Powdery Mildew' || trimmed === 'Powdery_Mildew') {
    return 'Powdery Mildew';
  }
  if (trimmed === 'Rust' || trimmed === 'Leaf Rust' || trimmed === 'Leaf_Rust') {
    return 'Leaf Rust';
  }
  return null;
}

/**
 * Validates and normalizes raw backend prediction data into a typed LeafDiseasePredictionData object.
 * Maps candidate model class names ('Powdery' -> 'Powdery Mildew', 'Rust' -> 'Leaf Rust') across
 * predicted_label, scores, and sorted_scores.
 */
export function parseLeafPredictionData(raw: unknown): LeafDiseasePredictionData | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;

  const normalizedLabel = normalizeLeafClass(d.predicted_label);
  if (!normalizedLabel) return null;

  const confidence =
    typeof d.confidence === 'number' && !Number.isNaN(d.confidence) && d.confidence >= 0 && d.confidence <= 1
      ? d.confidence
      : null;

  const confidencePct =
    typeof d.confidence_percentage === 'number' && !Number.isNaN(d.confidence_percentage) && d.confidence_percentage >= 0 && d.confidence_percentage <= 100
      ? d.confidence_percentage
      : confidence !== null
      ? confidence * 100
      : null;

  if (confidence === null || confidencePct === null) return null;

  // Normalize scores dictionary
  const rawScores = d.scores && typeof d.scores === 'object' ? (d.scores as Record<string, unknown>) : {};
  const scores: Record<LeafDiseaseClass, number> = {
    Healthy: 0,
    'Powdery Mildew': 0,
    'Leaf Rust': 0,
  };

  for (const [key, val] of Object.entries(rawScores)) {
    const normKey = normalizeLeafClass(key);
    if (normKey && typeof val === 'number' && !Number.isNaN(val)) {
      scores[normKey] = val;
    }
  }

  // Normalize sorted_scores
  let sorted_scores: LeafDiseaseClassScore[] = [];
  if (Array.isArray(d.sorted_scores)) {
    for (const item of d.sorted_scores) {
      if (item && typeof item === 'object') {
        const itemObj = item as Record<string, unknown>;
        const normName = normalizeLeafClass(itemObj.class_name);
        const score = typeof itemObj.score === 'number' ? itemObj.score : 0;
        const percentage = typeof itemObj.percentage === 'number' ? itemObj.percentage : score * 100;
        if (normName) {
          sorted_scores.push({
            class_name: normName,
            score,
            percentage,
          });
        }
      }
    }
  }

  // If sorted_scores is empty or incomplete, derive from scores dictionary
  if (sorted_scores.length === 0) {
    sorted_scores = (['Healthy', 'Powdery Mildew', 'Leaf Rust'] as LeafDiseaseClass[])
      .map((className) => ({
        class_name: className,
        score: scores[className],
        percentage: Number((scores[className] * 100).toFixed(2)),
      }))
      .sort((a, b) => b.score - a.score);
  }

  return {
    predicted_label: normalizedLabel,
    confidence,
    confidence_percentage: Number(confidencePct.toFixed(2)),
    scores,
    sorted_scores,
    inference_time_ms: typeof d.inference_time_ms === 'number' ? d.inference_time_ms : 0,
    model_name: typeof d.model_name === 'string' ? d.model_name : 'MobileNetV3 (PlantDoc)',
    timestamp: typeof d.timestamp === 'string' ? d.timestamp : new Date().toISOString(),
  };
}

/**
 * Predicts plant leaf pathology from a captured or uploaded image.
 */
export async function predictLeafDiseaseImage(
  imageBlob: Blob | File,
  signal?: AbortSignal
): Promise<LeafDiseasePredictionResponse> {
  const baseUrl = getLeafDiseaseApiBaseUrl();

  if (!baseUrl) {
    return {
      success: false,
      data: null,
      error:
        'Layanan inferensi penyakit daun (Healthy, Powdery Mildew, Leaf Rust) belum dikonfigurasi pada server backend (VITE_LEAF_API_BASE_URL belum diatur). Endpoint model daun belum dideploy.',
    };
  }

  const endpoint = `${baseUrl}/api/v1/leaf/predict`;
  const formData = new FormData();
  const fileName = imageBlob instanceof File && imageBlob.name ? imageBlob.name : 'leaf_frame.jpg';
  formData.append('file', imageBlob, fileName);

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
        const errJson = JSON.parse(text);
        if (errJson.error) errorMsg = String(errJson.error);
        else if (errJson.detail) errorMsg = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
      } catch {
        // fallback to status text
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
        error: json.error || 'Server tidak mengembalikan hasil analisis daun yang valid.',
      };
    }

    const parsedData = parseLeafPredictionData(json.data);
    if (!parsedData) {
      return {
        success: false,
        data: null,
        error: 'Struktur respon data model tidak sesuai dengan kontrak kelas [Healthy, Powdery Mildew, Leaf Rust].',
      };
    }

    return {
      success: true,
      data: parsedData,
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
      return { success: false, data: null, error: 'Koneksi ke backend model daun timeout (melebihi 15 detik).' };
    }

    const message = err instanceof Error ? err.message : 'Gagal menghubungi server model daun.';
    return {
      success: false,
      data: null,
      error: `Kendala jaringan: ${message}`,
    };
  }
}

/**
 * Checks model readiness and server status for the leaf pathology service.
 * Returns an unconfigured response if VITE_LEAF_API_BASE_URL is not set.
 */
export async function checkLeafDiseaseHealth(signal?: AbortSignal): Promise<LeafDiseaseHealthResponse> {
  const baseUrl = getLeafDiseaseApiBaseUrl();
  if (!baseUrl) {
    return {
      status: 'unconfigured',
      server: 'PlanTech Leaf AI',
      model_ready: false,
      error: 'VITE_LEAF_API_BASE_URL belum dikonfigurasi.',
    };
  }

  const endpoint = `${baseUrl}/api/v1/leaf/health`;
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) {
      return {
        status: 'error',
        server: 'PlanTech Leaf AI',
        model_ready: false,
        error: `Server mengembalikan status HTTP ${response.status}`,
      };
    }
    return (await response.json()) as LeafDiseaseHealthResponse;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gagal menghubungi endpoint health model daun.';
    return {
      status: 'unavailable',
      server: 'PlanTech Leaf AI',
      model_ready: false,
      error: msg,
    };
  }
}

