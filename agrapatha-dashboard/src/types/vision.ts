/**
 * Vision and Camera Type Definitions for AGRAPATHA
 * Strictly separates Wildfire and Leaf Disease classification domains.
 */

export type VisionDomain = 'wildfire' | 'leaf_disease';

// ==========================================
// 1. WILDFIRE CLASSIFICATION DOMAIN
// Deployed API: POST /api/v1/predict (MobileNetV2 TFLite)
// ==========================================

export type WildfireClass = 'Non-Fire' | 'Smoke' | 'Fire';

export interface WildfireClassScore {
  class_name: WildfireClass;
  score: number;      // 0.0 - 1.0
  percentage: number; // 0.0 - 100.0
}

export interface WildfirePredictionData {
  predicted_label: WildfireClass;
  confidence: number;
  confidence_percentage: number;
  scores: Record<WildfireClass, number>;
  sorted_scores: WildfireClassScore[];
  output_type: string;
  inference_time_ms: number;
  input_resolution: [number, number];
  model_name: string;
  timestamp: string;
}

export interface WildfirePredictionResponse {
  success: boolean;
  data: WildfirePredictionData | null;
  error: string | null;
  detail?: string | null;
}

export interface WildfireHealthResponse {
  status: string;
  server: string;
  model_ready: boolean;
  model_file_exists: boolean;
  model_path: string | null;
  runtime: string | null;
  python_version: string | null;
  error: string | null;
}

// ==========================================
// 2. LEAF DISEASE CLASSIFICATION DOMAIN
// Target: MobileNetV3 / PlantDoc 3-class (Healthy, Powdery Mildew, Leaf Rust)
// ==========================================

export type LeafDiseaseClass = 'Healthy' | 'Powdery Mildew' | 'Leaf Rust';

export interface LeafDiseaseClassScore {
  class_name: LeafDiseaseClass;
  score: number;      // 0.0 - 1.0
  percentage: number; // 0.0 - 100.0
}

export interface LeafDiseasePredictionData {
  predicted_label: LeafDiseaseClass;
  confidence: number;
  confidence_percentage: number;
  scores: Record<LeafDiseaseClass, number>;
  sorted_scores: LeafDiseaseClassScore[];
  inference_time_ms: number;
  model_name: string;
  timestamp: string;
}

export interface LeafDiseasePredictionResponse {
  success: boolean;
  data: LeafDiseasePredictionData | null;
  error: string | null;
  detail?: string | null;
}

export interface LeafDiseaseHealthResponse {
  status: string;
  server: string;
  model_ready: boolean;
  model_name?: string;
  error: string | null;
}

// ==========================================
// 3. CAMERA & CAPTURE UI LIFECYCLE
// ==========================================

export type CaptureSource = 'none' | 'camera' | 'upload';

export type CameraStatus = 
  | 'idle' 
  | 'requesting' 
  | 'streaming' 
  | 'captured' 
  | 'permission_denied' 
  | 'device_error' 
  | 'unsupported';

export type InferenceStatus = 'idle' | 'analyzing' | 'success' | 'error';
