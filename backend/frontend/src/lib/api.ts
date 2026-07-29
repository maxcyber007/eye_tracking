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
  HealthResponse,
  HistoryDeleteResponse,
  HistoryListResponse,
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
};

// --------------------------------------------------------------------------- //
// Assessments                                                                 //
// --------------------------------------------------------------------------- //
export const history = {
  /** Page through stored assessments, optionally filtered by participant. */
  list: (params: { limit?: number; offset?: number; subjectId?: string } = {}) => {
    const query = new URLSearchParams({
      limit: String(params.limit ?? 25),
      offset: String(params.offset ?? 0),
    });
    if (params.subjectId) query.set("subject_id", params.subjectId);
    return request<HistoryListResponse>(`/api/history?${query.toString()}`);
  },

  /** Delete one assessment. */
  remove: (id: number) =>
    request<HistoryDeleteResponse>(`/api/history/${id}`, { method: "DELETE" }),

  /** Clear assessments, optionally only for one participant. */
  clear: (subjectId?: string) => {
    const query = new URLSearchParams({ confirm: "true" });
    if (subjectId) query.set("subject_id", subjectId);
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
