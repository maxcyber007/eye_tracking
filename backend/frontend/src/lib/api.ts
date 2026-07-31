/**
 * Typed client for the FastAPI backend.
 *
 * Every call is same-origin, so the HttpOnly session cookie travels
 * automatically and this module never touches a token. A 401 is surfaced as a
 * typed `ApiError` and the UI decides where to send the user, rather than the
 * transport layer redirecting behind the caller's back.
 */

import type {
  ApiErrorBody,
  AuthStatus,
  DatasetDeleteResponse,
  HealthResponse,
  HistoryDeleteResponse,
  HistoryListResponse,
  MockDatasetRequest,
  MockDatasetResponse,
  ModelDeleteResponse,
  PredictResponse,
  TrainResponse,
  TrainStatus,
  UploadResponse,
  UserPayload,
} from "@/lib/types";

/** Error carrying the backend's structured envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: Partial<ApiErrorBody> | null) {
    super(body?.message || `เกิดข้อผิดพลาด (HTTP ${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error || "UnknownError";
    this.details = body?.details || {};
  }

  /** Whether the request failed because no session is active. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** Thrown when the network itself failed, so the UI can say so specifically. */
export class NetworkError extends ApiError {
  constructor(message: string) {
    super(0, { error: "NetworkError", message, details: {} });
    this.name = "NetworkError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch (error) {
    throw new NetworkError(
      `ติดต่อเซิร์ฟเวอร์ไม่ได้: ${(error as Error).message}`,
    );
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    throw new ApiError(response.status, body as ApiErrorBody | null);
  }
  return body as T;
}

function json(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

// --------------------------------------------------------------------------- //
// Authentication                                                              //
// --------------------------------------------------------------------------- //
export const auth = {
  /** Report whether auth is enabled and whether a session is active. */
  status: () => request<AuthStatus>("/api/auth/status"),

  /** Sign in; the session cookie is set by the response. */
  login: (username: string, password: string) =>
    request<{ user: UserPayload; message: string; expires_at: string }>(
      "/api/auth/login",
      json({ username, password }),
    ),

  /** Revoke the current session and clear the cookie. */
  logout: () => request<{ message: string }>("/api/auth/logout", { method: "POST" }),

  /** Describe the signed-in account. */
  me: () => request<UserPayload>("/api/auth/me"),
};

// --------------------------------------------------------------------------- //
// System                                                                      //
// --------------------------------------------------------------------------- //
export const system = {
  /** Readiness probe with database, model and dataset counters. */
  health: () => request<HealthResponse>("/health"),
};

// --------------------------------------------------------------------------- //
// Model                                                                       //
// --------------------------------------------------------------------------- //
export const model = {
  /** Dataset summary plus information about the trained artefact. */
  status: () => request<TrainStatus>("/api/train/status"),

  /** Retrain from `dataset.csv` and persist the model. */
  train: () => request<TrainResponse>("/api/train", json({})),

  /** Delete the trained artefact so the next run starts from scratch. */
  remove: () =>
    request<ModelDeleteResponse>("/api/model?confirm=true", { method: "DELETE" }),
};

// --------------------------------------------------------------------------- //
// Dataset maintenance                                                         //
// --------------------------------------------------------------------------- //
export const dataset = {
  /** Fabricate rows so the pipeline can be trained without real recordings. */
  mock: (payload: MockDatasetRequest) =>
    request<MockDatasetResponse>("/api/dataset/mock", json(payload)),

  /** Delete `dataset.csv` entirely. */
  remove: () =>
    request<DatasetDeleteResponse>("/api/dataset?confirm=true", { method: "DELETE" }),
};

// --------------------------------------------------------------------------- //
// Assessments                                                                 //
// --------------------------------------------------------------------------- //
/** Criteria shared by listing, exporting and clearing the history. */
export interface HistoryFilterParams {
  subjectId?: string;
  /** Lowest participant age to include, inclusive. */
  ageMin?: number;
  /** Highest participant age to include, inclusive. */
  ageMax?: number;
}

/** Append the filter to a query string, skipping anything unset. */
function applyHistoryFilter(query: URLSearchParams, filter: HistoryFilterParams): void {
  if (filter.subjectId) query.set("subject_id", filter.subjectId);
  if (filter.ageMin !== undefined) query.set("age_min", String(filter.ageMin));
  if (filter.ageMax !== undefined) query.set("age_max", String(filter.ageMax));
}

export const history = {
  /** Page through stored assessments, optionally filtered by participant and age. */
  list: (params: HistoryFilterParams & { limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams({
      limit: String(params.limit ?? 25),
      offset: String(params.offset ?? 0),
    });
    applyHistoryFilter(query, params);
    return request<HistoryListResponse>(`/api/history?${query.toString()}`);
  },

  /** Delete one assessment. */
  remove: (id: number) =>
    request<HistoryDeleteResponse>(`/api/history/${id}`, { method: "DELETE" }),

  /** Clear assessments matching a filter; clears everything when it is empty. */
  clear: (filter: HistoryFilterParams = {}) => {
    const query = new URLSearchParams({ confirm: "true" });
    applyHistoryFilter(query, filter);
    return request<HistoryDeleteResponse>(`/api/history?${query.toString()}`, {
      method: "DELETE",
    });
  },
};

// --------------------------------------------------------------------------- //
// Recordings                                                                  //
// --------------------------------------------------------------------------- //
export interface RecordingPayload {
  blob: Blob;
  extension: string;
  trajectory: unknown[];
  subjectId?: string;
  /** Participant age in years; stored with the record, never used for scoring. */
  age?: number;
  /** Present only in research mode; routes the upload to /api/upload. */
  label?: string;
}

/**
 * Send a recording, reporting upload progress.
 *
 * `XMLHttpRequest` rather than `fetch` because only XHR exposes upload
 * progress, and a 30-second video on a phone connection needs a real progress
 * bar rather than an indeterminate spinner.
 */
export function uploadRecording(
  payload: RecordingPayload,
  onProgress: (ratio: number) => void,
): Promise<UploadResponse | PredictResponse> {
  const form = new FormData();
  form.append("file", payload.blob, `recording.${payload.extension}`);
  form.append("target_trajectory", JSON.stringify(payload.trajectory));
  if (payload.subjectId) form.append("subject_id", payload.subjectId);
  if (Number.isFinite(payload.age)) form.append("age", String(payload.age));

  const research = payload.label !== undefined && payload.label !== "";
  if (research) form.append("label", payload.label as string);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", research ? "/api/upload" : "/api/predict");
    xhr.withCredentials = true;
    xhr.timeout = 300_000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        reject(new ApiError(xhr.status, null));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as UploadResponse | PredictResponse);
      } else {
        reject(new ApiError(xhr.status, body as ApiErrorBody));
      }
    };
    xhr.onerror = () => reject(new NetworkError("ติดต่อเซิร์ฟเวอร์ไม่ได้"));
    xhr.ontimeout = () =>
      reject(new NetworkError("เซิร์ฟเวอร์ใช้เวลานานเกินไป ลองลดระยะเวลาการทดสอบ"));

    xhr.send(form);
  });
}
