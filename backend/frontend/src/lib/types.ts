/**
 * Types mirroring the FastAPI response schemas.
 *
 * These are the wire contract, not a redesign of it: field names match
 * `app/schemas.py` exactly so the backend stays untouched.
 */

export type RiskLevel = "Low" | "Moderate" | "High";

export interface UserPayload {
  id: number;
  username: string;
  display_name: string;
  role: string;
  created_at: string;
  last_login_at: string | null;
}

export interface AuthStatus {
  auth_enabled: boolean;
  authenticated: boolean;
  user: UserPayload | null;
}

export interface VideoInfo {
  filename: string;
  width: number;
  height: number;
  fps: number;
  frame_count: number;
  duration: number;
  detected_frames: number;
  detection_ratio: number;
}

/** The ten aggregated features; keys match `Settings.feature_columns`. */
export interface EyeFeatures {
  eye_velocity: number;
  eye_acceleration: number;
  eye_distance: number;
  movement_smoothness: number;
  blink_rate: number;
  fixation_time: number;
  total_distance: number;
  average_velocity: number;
  max_velocity: number;
  tracking_error: number;
}

export interface SampleMetadata {
  sample_id?: string;
  created_at?: string;
  filename?: string;
  subject_id?: string;
  duration?: number;
  frame_count?: number;
  fps?: number;
  detection_ratio?: number;
  blink_count?: number;
  saccade_count?: number;
  fixation_ratio?: number;
  saccade_ratio?: number;
  velocity_std?: number;
  tracking_error_source?: "target" | "self";
}

export interface PredictionPayload {
  risk_score: number;
  risk_level: RiskLevel;
  confidence: number;
  model_type: string;
  history_id?: number | null;
  features?: Record<string, number>;
  metadata?: SampleMetadata;
}

/** `POST /api/predict` — flat shape. */
export interface PredictResponse {
  success: boolean;
  risk_score: number;
  risk_level: RiskLevel;
  confidence: number;
  model_type: string;
  history_id: number | null;
  filename: string | null;
  frame_csv_path: string | null;
  video: VideoInfo | null;
  features: Record<string, number>;
  sample_metadata: SampleMetadata;
}

/** `POST /api/upload` — prediction nested, and absent when no model exists. */
export interface UploadResponse {
  success: boolean;
  message: string;
  filename: string;
  stored_path: string;
  frame_csv_path: string | null;
  dataset_path: string | null;
  video: VideoInfo;
  blink_count: number;
  saccade_count: number;
  features: Record<string, number>;
  sample_metadata: SampleMetadata;
  prediction: PredictionPayload | null;
}

export interface TrainingMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1_score: number;
  roc_auc: number | null;
  cv_mean_accuracy: number | null;
  train_samples: number;
  test_samples: number;
  class_distribution: Record<string, number>;
  confusion_matrix: number[][];
  feature_importance: Record<string, number>;
}

export interface TrainResponse {
  success: boolean;
  message: string;
  model_type: string;
  model_path: string;
  dataset_path: string;
  feature_columns: string[];
  metrics: TrainingMetrics;
  trained_at: string;
}

export interface DatasetSummary {
  exists: boolean;
  path: string;
  rows: number;
  label_counts: Record<string, number>;
}

export interface ModelInfo {
  available: boolean;
  model_path: string;
  model_type?: string;
  feature_columns?: string[];
  classes?: number[];
  metrics?: TrainingMetrics;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface TrainStatus {
  dataset: DatasetSummary;
  model: ModelInfo;
  available_models: string[];
}

export interface HealthResponse {
  status: string;
  app: string;
  version: string;
  environment: string;
  database: boolean;
  model_available: boolean;
  model_type: string | null;
  dataset: DatasetSummary;
  available_models: string[];
  history_count: number;
}

export interface HistoryItem {
  id: number;
  created_at: string;
  filename: string;
  risk_score: number;
  risk_level: RiskLevel;
  confidence: number;
  model_type: string | null;
  subject_id: string | null;
  features: Record<string, number>;
  metadata: SampleMetadata;
}

export interface HistoryListResponse {
  total: number;
  limit: number;
  offset: number;
  items: HistoryItem[];
}

export interface HistoryDeleteResponse {
  success: boolean;
  deleted: number;
  remaining: number;
  message: string;
}

// --------------------------------------------------------------------------- //
// Dataset and model maintenance                                               //
// --------------------------------------------------------------------------- //
export interface MockDatasetRequest {
  samples: number;
  positive_ratio: number;
  /** Omit to draw from entropy, so repeated runs differ. */
  seed?: number | null;
  append: boolean;
}

export interface MockDatasetResponse {
  success: boolean;
  generated: number;
  appended: boolean;
  dataset_path: string;
  dataset: DatasetSummary;
  message: string;
}

export interface DatasetDeleteResponse {
  success: boolean;
  deleted: number;
  dataset_path: string;
  message: string;
}

export interface ModelDeleteResponse {
  success: boolean;
  deleted: boolean;
  model_path: string;
  message: string;
}

/** Uniform error envelope returned by every failing endpoint. */
export interface ApiErrorBody {
  success: false;
  error: string;
  message: string;
  details: Record<string, unknown>;
}

/** One sample of the on-screen stimulus path, sent with a recording. */
export interface TargetPoint {
  t: number;
  x: number;
  y: number;
}

export type PursuitPattern = "horizontal" | "circular" | "lissajous" | "step";
