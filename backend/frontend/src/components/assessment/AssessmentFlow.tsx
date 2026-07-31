"use client";

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CameraOff,
  CheckCircle2,
  Circle,
  Play,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Loading";
import { RiskGauge } from "@/components/dashboard/RiskGauge";
import { ApiError, uploadRecording } from "@/lib/api";
import { ERROR_HINTS, FEATURE_LABELS } from "@/lib/constants";
import { formatMegabytes, formatPercent } from "@/lib/format";
import {
  usePursuitTask,
  type RecordingResult,
} from "@/hooks/usePursuitTask";
import type {
  PredictResponse,
  PursuitPattern,
  UploadResponse,
} from "@/lib/types";

type Stage = "setup" | "task" | "uploading" | "result" | "error";

export interface AssessmentFlowProps {
  subjectId: string;
  /** Participant age in years; stored with the sample, never scored. */
  age?: number;
  durationSeconds: number;
  pattern: PursuitPattern;
  /** Present in research mode; routes the upload to /api/upload with a label. */
  label?: string;
  /** Called after a successful submission, so the caller can refresh counters. */
  onSubmitted?: () => void;
  /** Rendered above the camera, e.g. the settings summary. */
  header?: React.ReactNode;
}

/** Normalised view of either response shape the backend can return. */
interface Outcome {
  prediction: {
    risk_score: number;
    risk_level: "Low" | "Moderate" | "High";
    confidence: number;
  } | null;
  features: Record<string, number>;
  detectionRatio: number;
  duration: number;
  blinkCount: number;
  usedTarget: boolean;
  savedToDataset: boolean;
  videoDeleted: boolean;
}

function normalise(body: UploadResponse | PredictResponse): Outcome {
  const upload = body as UploadResponse;
  const predict = body as PredictResponse;
  const prediction =
    upload.prediction ??
    (predict.risk_score !== undefined
      ? {
          risk_score: predict.risk_score,
          risk_level: predict.risk_level,
          confidence: predict.confidence,
        }
      : null);
  const metadata = body.sample_metadata ?? {};

  return {
    prediction: prediction
      ? {
          risk_score: prediction.risk_score,
          risk_level: prediction.risk_level,
          confidence: prediction.confidence,
        }
      : null,
    features: body.features ?? {},
    detectionRatio: body.video?.detection_ratio ?? metadata.detection_ratio ?? 0,
    duration: metadata.duration ?? body.video?.duration ?? 0,
    blinkCount: metadata.blink_count ?? 0,
    usedTarget: metadata.tracking_error_source === "target",
    savedToDataset: Boolean(upload.dataset_path),
    videoDeleted: Boolean(upload.video_deleted),
  };
}

/**
 * The complete recording flow: camera setup, pursuit task, upload, result.
 *
 * Shared by the participant page and the researcher collection page; the only
 * difference between them is whether a `label` is supplied, which is what
 * decides the endpoint. Keeping one component means the camera and timing
 * logic — the part that is easy to get subtly wrong — exists once.
 */
export function AssessmentFlow({
  subjectId,
  age,
  durationSeconds,
  pattern,
  label,
  onSubmitted,
  header,
}: AssessmentFlowProps) {
  const [stage, setStage] = useState<Stage>("setup");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSize, setUploadSize] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(
    null,
  );

  const submit = useCallback(
    async (recording: RecordingResult) => {
      setStage("uploading");
      setUploadProgress(0);
      setUploadSize(recording.blob.size);
      try {
        const body = await uploadRecording(
          {
            blob: recording.blob,
            extension: recording.extension,
            trajectory: recording.trajectory,
            subjectId: subjectId || undefined,
            age,
            label,
          },
          setUploadProgress,
        );
        setOutcome(normalise(body));
        setStage("result");
        onSubmitted?.();
      } catch (caught) {
        const error = caught as ApiError;
        setFailure({ code: error.code, message: error.message });
        setStage("error");
      }
    },
    [subjectId, age, label, onSubmitted],
  );

  const task = usePursuitTask({
    durationSeconds,
    pattern,
    onComplete: submit,
  });

  const restart = () => {
    setOutcome(null);
    setFailure(null);
    setStage("setup");
  };

  return (
    <div className="space-y-5">
      <AnimatePresence mode="wait">
        {/* ── Camera setup ─────────────────────────────────────────── */}
        {stage === "setup" && (
          <motion.div
            key="setup"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {header}

            <Card padded={false} className="overflow-hidden">
              <div className="relative aspect-3/4 bg-slate-900 sm:aspect-4/3">
                <video
                  ref={task.videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="size-full -scale-x-100 object-cover"
                />
                <svg
                  viewBox="0 0 300 400"
                  preserveAspectRatio="xMidYMid meet"
                  className="pointer-events-none absolute inset-0 size-full"
                  aria-hidden="true"
                >
                  <ellipse
                    cx="150"
                    cy="190"
                    rx="96"
                    ry="128"
                    fill="none"
                    stroke="rgba(59,130,246,0.85)"
                    strokeWidth="2.5"
                    strokeDasharray="10 9"
                  />
                </svg>
                {task.cameraState !== "ready" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/80 p-6 text-center">
                    <CameraOff className="size-8 text-slate-400" aria-hidden="true" />
                    <p className="text-sm text-slate-300">
                      {task.cameraMessage || "กดปุ่มด้านล่างเพื่อเปิดกล้อง"}
                    </p>
                  </div>
                )}
              </div>
            </Card>

            {task.cameraState === "ready" ? (
              <Alert tone="success">{task.cameraMessage}</Alert>
            ) : task.cameraState === "denied" || task.cameraState === "error" ? (
              <Alert tone="error" title="เปิดกล้องไม่ได้">
                {task.cameraMessage}
              </Alert>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              {task.cameraState !== "ready" ? (
                <Button
                  size="lg"
                  fullWidth
                  loading={task.cameraState === "requesting"}
                  onClick={() => void task.openCamera()}
                >
                  เปิดกล้อง
                </Button>
              ) : (
                <Button
                  size="lg"
                  fullWidth
                  onClick={() => {
                    setStage("task");
                    void task.start();
                  }}
                  icon={<Play className="size-4" aria-hidden="true" />}
                >
                  เริ่มทดสอบ ({durationSeconds} วินาที)
                </Button>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Pursuit task ─────────────────────────────────────────── */}
        {stage === "task" && (
          <motion.div
            key="task"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <Card padded={false} className="overflow-hidden">
              <div className="relative aspect-3/4 bg-slate-900 sm:aspect-4/3">
                <video
                  ref={task.videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="size-full -scale-x-100 object-cover"
                />

                {task.phase === "running" && (
                  <>
                    <span
                      className="absolute size-9 rounded-full shadow-[0_0_26px_rgba(59,130,246,0.9)]"
                      style={{
                        left: `${task.ballPosition.x * 100}%`,
                        top: `${task.ballPosition.y * 100}%`,
                        marginLeft: "-1.125rem",
                        marginTop: "-1.125rem",
                        background:
                          "radial-gradient(circle at 34% 34%, #fff, #3b82f6 62%)",
                      }}
                      aria-hidden="true"
                    />
                    <Badge
                      tone="danger"
                      dot
                      className="absolute right-3 top-3 animate-pulse"
                    >
                      REC
                    </Badge>
                  </>
                )}

                {task.phase === "countdown" && (
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-slate-900/60"
                    aria-live="assertive"
                  >
                    <motion.span
                      key={task.countdown}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="text-7xl font-bold text-white"
                    >
                      {task.countdown}
                    </motion.span>
                  </div>
                )}
              </div>
            </Card>

            <div
              className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
              role="progressbar"
              aria-valuenow={Math.round(task.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="ความคืบหน้าของการทดสอบ"
            >
              <div
                className="h-full bg-brand-600 transition-[width] duration-100"
                style={{ width: `${task.progress * 100}%` }}
              />
            </div>

            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              มองตามลูกบอลโดยไม่ขยับศีรษะ
            </p>

            <Button
              variant="outline"
              fullWidth
              onClick={() => {
                task.abort();
                setStage("setup");
              }}
            >
              ยกเลิก
            </Button>
          </motion.div>
        )}

        {/* ── Uploading ────────────────────────────────────────────── */}
        {stage === "uploading" && (
          <motion.div
            key="uploading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4 py-16 text-center"
          >
            <Spinner className="size-9" />
            <div>
              <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {uploadProgress >= 1 ? "กำลังวิเคราะห์…" : "กำลังอัปโหลด…"}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {uploadProgress >= 1
                  ? "ตรวจจับใบหน้าและคำนวณค่าการเคลื่อนไหวดวงตา"
                  : `ขนาดไฟล์ ${formatMegabytes(uploadSize)}`}
              </p>
            </div>
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full bg-brand-600 transition-[width] duration-150"
                style={{ width: `${Math.min(uploadProgress, 1) * 100}%` }}
              />
            </div>
          </motion.div>
        )}

        {/* ── Result ───────────────────────────────────────────────── */}
        {stage === "result" && outcome && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            {outcome.savedToDataset && (
              <Alert tone="success" title="บันทึกเข้าชุดข้อมูลแล้ว">
                ตัวอย่างถูกต่อท้าย dataset.csv เรียบร้อย —{" "}
                {label === "1" ? "กลุ่มเสี่ยง (1)" : "กลุ่มควบคุม (0)"}
                {outcome.videoDeleted && (
                  <>
                    {" "}
                    ไฟล์วิดีโอถูกลบแล้วเพื่อประหยัดพื้นที่
                    เก็บไว้เฉพาะค่าที่วัดได้รายเฟรม
                  </>
                )}
              </Alert>
            )}

            {outcome.prediction ? (
              <Card>
                <RiskGauge
                  score={outcome.prediction.risk_score}
                  level={outcome.prediction.risk_level}
                />
                <p className="mt-4 text-center text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  ตัวเลขนี้เป็นผลจากแบบจำลองสถิติ{" "}
                  <strong className="text-slate-700 dark:text-slate-300">
                    ไม่ใช่การวินิจฉัย
                  </strong>{" "}
                  และไม่ควรใช้ตัดสินใจเรื่องสุขภาพ
                </p>
              </Card>
            ) : (
              <Alert tone="warning" title="ยังไม่มีโมเดล">
                บันทึกตัวอย่างเรียบร้อยแล้ว แต่ยังไม่มีโมเดลจึงยังทำนายไม่ได้
                ไปที่หน้าภาพรวมเพื่อเทรนเมื่อเก็บข้อมูลครบทั้งสองกลุ่มแล้ว
              </Alert>
            )}

            <Card>
              <CardHeader>
                <CardTitle>คุณภาพการบันทึก</CardTitle>
              </CardHeader>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  {
                    label: "ตรวจพบใบหน้า",
                    value: formatPercent(outcome.detectionRatio),
                    good: outcome.detectionRatio >= 0.9,
                  },
                  {
                    label: "ความยาวที่วิเคราะห์",
                    value: `${outcome.duration.toFixed(1)} วิ`,
                    good: true,
                  },
                  {
                    label: "จำนวนการกะพริบตา",
                    value: String(outcome.blinkCount),
                    good: true,
                  },
                  {
                    label: "เทียบกับเป้าหมายจริง",
                    value: outcome.usedTarget ? "ใช่" : "ไม่ใช่",
                    good: outcome.usedTarget,
                  },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {item.label}
                    </p>
                    <p
                      className={cn(
                        "flex items-center gap-1 text-base font-semibold",
                        item.good
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {item.good ? (
                        <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="size-3.5" aria-hidden="true" />
                      )}
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>ค่าที่วัดได้ทั้งหมด</CardTitle>
                <Badge tone="neutral">{Object.keys(outcome.features).length} ค่า</Badge>
              </CardHeader>
              <dl className="divide-y divide-slate-100 dark:divide-slate-800">
                {Object.entries(outcome.features).map(([key, value]) => {
                  const meta = FEATURE_LABELS[key];
                  return (
                    <div
                      key={key}
                      className="flex items-baseline justify-between gap-4 py-2.5"
                    >
                      <dt className="min-w-0">
                        <span className="block text-sm text-slate-700 dark:text-slate-300">
                          {meta?.label ?? key}
                        </span>
                        {meta && (
                          <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                            {meta.unit}
                          </span>
                        )}
                      </dt>
                      <dd className="shrink-0 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {value.toFixed(4)}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </Card>

            <Button
              size="lg"
              fullWidth
              onClick={restart}
              icon={<RotateCcw className="size-4" aria-hidden="true" />}
            >
              ทดสอบอีกครั้ง
            </Button>
          </motion.div>
        )}

        {/* ── Failure ──────────────────────────────────────────────── */}
        {stage === "error" && failure && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4 py-6"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <span
                className="flex size-14 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                aria-hidden="true"
              >
                <AlertTriangle className="size-7" />
              </span>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {failure.code === "NoFaceDetectedError"
                  ? "ตรวจไม่พบใบหน้า"
                  : failure.code === "ModelNotTrainedError"
                    ? "ระบบยังไม่พร้อมใช้งาน"
                    : "เกิดข้อผิดพลาด"}
              </h2>
              <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
                {failure.message}
              </p>
            </div>

            {ERROR_HINTS[failure.code] && (
              <Alert tone="info">{ERROR_HINTS[failure.code]}</Alert>
            )}

            <Button size="lg" fullWidth onClick={restart}>
              ลองใหม่
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {stage === "setup" && (
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          <Circle className="size-2 fill-current" aria-hidden="true" />
          วิดีโอถูกส่งไปประมวลผลบนเซิร์ฟเวอร์ของโครงการเท่านั้น
        </p>
      )}
    </div>
  );
}
