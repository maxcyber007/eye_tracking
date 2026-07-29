"use client";

import { useCallback, useState } from "react";
import {
  Activity,
  BrainCircuit,
  Database,
  RefreshCw,
  ServerCog,
  Users,
} from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/Modal";
import { StatCardSkeleton, Skeleton } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { StatCard } from "@/components/dashboard/StatCard";
import { FeatureImportanceChart } from "@/components/dashboard/Charts";
import { model, system } from "@/lib/api";
import { FEATURE_LABELS } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import { useAsync } from "@/hooks/useAsync";
import type { TrainingMetrics } from "@/lib/types";

/** Grid of the metrics returned by a training run. */
function MetricsGrid({ metrics }: { metrics: TrainingMetrics }) {
  const entries: [string, number | null][] = [
    ["Accuracy", metrics.accuracy],
    ["F1", metrics.f1_score],
    ["Precision", metrics.precision],
    ["Recall", metrics.recall],
    ["ROC AUC", metrics.roc_auc],
    ["CV accuracy", metrics.cv_mean_accuracy],
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {entries
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50"
          >
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
            <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {formatNumber(value)}
            </p>
          </div>
        ))}
    </div>
  );
}

export default function OverviewPage() {
  const { notify } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [training, setTraining] = useState(false);
  const [justTrained, setJustTrained] = useState<TrainingMetrics | null>(null);

  const status = useAsync(() => model.status(), []);
  const health = useAsync(() => system.health(), []);

  const dataset = status.data?.dataset;
  const modelInfo = status.data?.model;
  const counts = dataset?.label_counts ?? {};
  const control = Number(counts["0"] ?? 0);
  const atRisk = Number(counts["1"] ?? 0);
  const trainable = control >= 2 && atRisk >= 2;

  const runTraining = useCallback(async () => {
    setConfirmOpen(false);
    setTraining(true);
    try {
      const result = await model.train();
      setJustTrained(result.metrics);
      notify("success", result.message);
      await Promise.all([status.reload(), health.reload()]);
    } catch (caught) {
      notify("error", (caught as Error).message);
    } finally {
      setTraining(false);
    }
  }, [notify, status, health]);

  const metrics = justTrained ?? modelInfo?.metrics ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            ภาพรวมระบบ
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            สถานะชุดข้อมูล โมเดล และบริการทั้งหมด
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void status.reload();
            void health.reload();
          }}
          icon={<RefreshCw className="size-3.5" aria-hidden="true" />}
        >
          รีเฟรช
        </Button>
      </div>

      {status.error && (
        <Alert tone="error" title="โหลดสถานะไม่สำเร็จ">
          {status.error.message}
        </Alert>
      )}

      <section
        aria-label="ตัวเลขสรุป"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {status.loading || health.loading ? (
          Array.from({ length: 4 }).map((_, index) => <StatCardSkeleton key={index} />)
        ) : (
          <>
            <StatCard
              index={0}
              label="ตัวอย่างในชุดข้อมูล"
              value={dataset?.rows ?? 0}
              icon={Database}
              tone="brand"
              hint={`ควบคุม ${control} · เสี่ยง ${atRisk}`}
            />
            <StatCard
              index={1}
              label="ผลประเมินสะสม"
              value={health.data?.history_count ?? 0}
              icon={Users}
              tone="success"
              hint="บันทึกในตาราง test_history"
            />
            <StatCard
              index={2}
              label="โมเดลปัจจุบัน"
              value={modelInfo?.available ? (modelInfo.model_type ?? "—") : "ยังไม่มี"}
              icon={BrainCircuit}
              tone={modelInfo?.available ? "success" : "warning"}
              hint={
                modelInfo?.available ? "พร้อมใช้ทำนาย" : "ต้องเทรนก่อนจึงจะทำนายได้"
              }
            />
            <StatCard
              index={3}
              label="สถานะบริการ"
              value={health.data?.status === "ok" ? "ปกติ" : "ผิดปกติ"}
              icon={ServerCog}
              tone={health.data?.status === "ok" ? "success" : "danger"}
              hint={`เวอร์ชัน ${health.data?.version ?? "—"} · ${health.data?.environment ?? "—"}`}
            />
          </>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>เทรนโมเดล</CardTitle>
            {modelInfo?.available && (
              <Badge tone="success" dot>
                มีโมเดลแล้ว
              </Badge>
            )}
          </CardHeader>

          {status.loading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    กลุ่มควบคุม (0)
                  </p>
                  <p
                    className={`text-lg font-semibold tabular-nums ${
                      control >= 2
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {control}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    กลุ่มเสี่ยง (1)
                  </p>
                  <p
                    className={`text-lg font-semibold tabular-nums ${
                      atRisk >= 2
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {atRisk}
                  </p>
                </div>
              </div>

              <Button
                fullWidth
                disabled={!trainable}
                loading={training}
                onClick={() => setConfirmOpen(true)}
                icon={<Activity className="size-4" aria-hidden="true" />}
              >
                {trainable ? "เทรนโมเดล" : "ต้องมีอย่างน้อย 2 ตัวอย่างในแต่ละกลุ่ม"}
              </Button>

              {metrics && (
                <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    {justTrained ? "เทรนสำเร็จ" : "โมเดลที่ใช้อยู่"} —{" "}
                    {metrics.train_samples} train / {metrics.test_samples} test
                  </p>
                  <MetricsGrid metrics={metrics} />
                  {metrics.test_samples < 10 && (
                    <Alert tone="warning">
                      ชุดทดสอบมีเพียง {metrics.test_samples} ตัวอย่าง
                      ตัวเลขข้างบนจึงยังไม่มีความหมายทางสถิติ
                      ใช้ยืนยันได้แค่ว่าระบบเทรนผ่านเท่านั้น
                    </Alert>
                  )}
                  <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    ตัวเลขนี้วัดจากการแบ่งข้อมูลแบบสุ่ม ไม่ได้แบ่งตามผู้เข้าร่วม
                    ถ้ามีหลายคลิปต่อคน ค่าที่เห็นจะสูงกว่าความเป็นจริง
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>ความสำคัญของแต่ละค่าที่วัด</CardTitle>
            <Badge tone="neutral">จากโมเดลที่เทรนแล้ว</Badge>
          </CardHeader>
          {status.loading ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <FeatureImportanceChart
              importance={metrics?.feature_importance ?? {}}
              labels={FEATURE_LABELS}
            />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายละเอียดระบบ</CardTitle>
        </CardHeader>
        {health.loading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["สถานะบริการ", health.data?.status ?? "—"],
              ["เวอร์ชัน", health.data?.version ?? "—"],
              ["สภาพแวดล้อม", health.data?.environment ?? "—"],
              ["ฐานข้อมูล", health.data?.database ? "เชื่อมต่อได้" : "มีปัญหา"],
              ["โมเดลพร้อมใช้", health.data?.model_available ? "ใช่" : "ยังไม่มี"],
              [
                "อัลกอริทึมที่ลงทะเบียน",
                (health.data?.available_models ?? []).join(", ") || "—",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2 dark:border-slate-800"
              >
                <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
                <dd className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="เทรนโมเดลใหม่?"
        description={
          "ระบบจะเทรนจาก dataset.csv ทั้งหมดแล้วเขียนทับ eye_model.pkl เดิม\n" +
          "การทำนายครั้งถัดไปจะใช้โมเดลใหม่ทันที"
        }
        confirmLabel="เทรนเลย"
        tone="primary"
        loading={training}
        onConfirm={runTraining}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
