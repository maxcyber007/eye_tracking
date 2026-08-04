import type { PursuitPattern, RiskLevel } from "@/lib/types";

/**
 * Product name of the trained model, shown wherever a model is named.
 *
 * The backend reports `model_type` — the algorithm, e.g. `random_forest` —
 * which is what the registry swaps when the estimator changes. That stays
 * visible as a secondary line rather than being replaced by this name, so the
 * screen never hides which algorithm actually produced a score.
 */
export const MODEL_DISPLAY_NAME = "MyEye";

/**
 * Accepted participant age range, mirroring `MIN_AGE`/`MAX_AGE` on the server.
 *
 * Age is recorded and reported on, but never fed to the model: it is the
 * strongest known predictor of Alzheimer's, so including it would let a model
 * trained on a few hundred samples score age instead of eye movement.
 */
export const MIN_AGE = 1;
export const MAX_AGE = 120;

/** Human readable name and unit for every model feature. */
export const FEATURE_LABELS: Record<string, { label: string; unit: string }> = {
  eye_velocity: { label: "ความเร็วเฉลี่ยของสายตา", unit: "หน่วยตา/วินาที" },
  eye_acceleration: { label: "ความเร่งเฉลี่ย", unit: "หน่วยตา/วินาที²" },
  eye_distance: { label: "ระยะห่างระหว่างตา", unit: "สัดส่วนของความกว้างภาพ" },
  movement_smoothness: { label: "ความราบรื่นของการเคลื่อนไหว", unit: "ค่าสูง = ราบรื่นกว่า" },
  blink_rate: { label: "อัตราการกะพริบตา", unit: "ครั้ง/นาที" },
  fixation_time: { label: "เวลาที่จ้องนิ่ง", unit: "วินาที" },
  total_distance: { label: "ระยะทางรวมที่สายตาเคลื่อนที่", unit: "หน่วยตา" },
  average_velocity: { label: "ความเร็วเฉลี่ยตลอดการทดสอบ", unit: "หน่วยตา/วินาที" },
  max_velocity: { label: "ความเร็วสูงสุด", unit: "หน่วยตา/วินาที" },
  tracking_error: { label: "ความคลาดเคลื่อนจากเป้าหมาย", unit: "ค่าต่ำ = ตามได้แม่นกว่า" },
};

/** Thai copy for each risk band, matching the backend's labels. */
export const RISK_LABELS: Record<RiskLevel, string> = {
  Low: "ความเสี่ยงต่ำ",
  Moderate: "ความเสี่ยงปานกลาง",
  High: "ความเสี่ยงสูง",
};

/**
 * What to do about each band.
 *
 * Only the highest band advises seeing a doctor. Consulting a professional is
 * the safe direction — it defers the judgement rather than making one — but
 * putting it on every band would make the advice meaningless, and the score is
 * not calibrated well enough to alarm someone whose result came out low.
 */
export const RISK_ADVICE: Record<RiskLevel, string> = {
  Low: "",
  Moderate: "",
  High: "ควรพบแพทย์",
};

/**
 * Where the band boundaries come from, shown under the table.
 *
 * Deliberately not a citation. The boundaries are an equal three-way split of
 * the model's output probability; no publication proposes 0.34 and 0.67,
 * because they are properties of this model rather than of the disease.
 * Claiming a source here would be inventing authority the numbers do not have.
 */
export const RISK_BAND_PROVENANCE =
  "ระดับความเสี่ยงแบ่งช่วงคะแนนของโมเดลออกเป็นสามส่วนเท่าๆ กัน " +
  "ยังไม่ได้ปรับเทียบ (calibrate) กับข้อมูลผู้ป่วยจริง จึงยังไม่มีงานวิจัยรองรับตัวเลขจุดตัดนี้ " +
  "การกำหนดจุดตัดที่อ้างอิงได้ต้องคำนวณจาก ROC curve ของข้อมูลที่เก็บเอง เช่นด้วยวิธี Youden's J (Youden, 1950)";

/** Recovery hints keyed by the backend's error class names. */
export const ERROR_HINTS: Record<string, string> = {
  ModelNotTrainedError:
    "ยังไม่มีโมเดลบนเซิร์ฟเวอร์ ผู้ดูแลระบบต้องเก็บข้อมูลให้ครบทั้งสองกลุ่มแล้วกดเทรนก่อน",
  NoFaceDetectedError:
    "ระบบตรวจไม่พบใบหน้าในหลายเฟรม ลองย้ายไปที่ที่สว่างขึ้น ไม่ย้อนแสง และจัดให้ใบหน้าอยู่เต็มกรอบตลอดการทดสอบ",
  InvalidVideoError:
    "ไฟล์วิดีโอไม่ผ่านการตรวจสอบ อาจมีขนาดใหญ่เกินไปหรือสกุลไฟล์ไม่รองรับ ลองลดระยะเวลาการทดสอบ",
  VideoProcessingError:
    "เซิร์ฟเวอร์ถอดรหัสวิดีโอไม่ได้ อาจเป็นเพราะ codec ที่เบราว์เซอร์นี้ใช้ ลองเบราว์เซอร์อื่น",
  FeatureExtractionError:
    "การบันทึกสั้นเกินไปจนคำนวณค่าไม่ได้ ลองตั้งระยะเวลาอย่างน้อย 15 วินาที",
  UnauthorizedError: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง",
};

/** Selectable stimulus patterns shown in the settings form. */
export const PURSUIT_PATTERNS: { value: PursuitPattern; label: string }[] = [
  { value: "horizontal", label: "แนวนอน — smooth pursuit" },
  { value: "circular", label: "วงกลม" },
  { value: "lissajous", label: "เลข 8 — Lissajous" },
  { value: "step", label: "กระโดดเป็นจุด — saccade" },
];

/** Default page size for the assessment report. */
export const PAGE_SIZE = 25;
