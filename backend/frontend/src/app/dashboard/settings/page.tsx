"use client";

import { useCallback, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  Database,
  FlaskConical,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Checkbox, Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Loading";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { dataset as datasetApi, model } from "@/lib/api";
import { MODEL_DISPLAY_NAME } from "@/lib/constants";
import { useAsync } from "@/hooks/useAsync";

/** Bounds mirrored from `MockDatasetRequest`, so the form rejects what the API would. */
const MIN_SAMPLES = 4;
const MAX_SAMPLES = 5000;

type Action = "mock" | "dataset" | "model" | null;

/**
 * Maintenance page.
 *
 * The three destructive-or-fabricating operations live here rather than on the
 * overview, so they cannot be hit while reading the numbers. Each one is behind
 * a confirmation whose text spells out precisely which store is affected and
 * which are not — "ลบ dataset" and "ลบโมเดล" sound interchangeable until the
 * moment one of them has thrown away weeks of collection.
 */
export default function SettingsPage() {
  const { notify } = useToast();
  const status = useAsync(() => model.status(), []);

  const [samples, setSamples] = useState(200);
  const [positiveRatio, setPositiveRatio] = useState(50);
  const [append, setAppend] = useState(false);

  const [pending, setPending] = useState<Action>(null);
  const [confirming, setConfirming] = useState<Action>(null);

  const dataset = status.data?.dataset;
  const modelInfo = status.data?.model;
  const counts = dataset?.label_counts ?? {};
  const control = Number(counts["0"] ?? 0);
  const atRisk = Number(counts["1"] ?? 0);
  const rows = dataset?.rows ?? 0;

  const samplesValid = samples >= MIN_SAMPLES && samples <= MAX_SAMPLES;
  const ratioValid = positiveRatio > 0 && positiveRatio < 100;

  /** Run one maintenance call, then refresh the counters it changed. */
  const run = useCallback(
    async (action: Exclude<Action, null>) => {
      setConfirming(null);
      setPending(action);
      try {
        const result =
          action === "mock"
            ? await datasetApi.mock({
                samples,
                positive_ratio: positiveRatio / 100,
                append,
              })
            : action === "dataset"
              ? await datasetApi.remove()
              : await model.remove();
        notify("success", result.message);
        await status.reload();
      } catch (caught) {
        notify("error", (caught as Error).message);
      } finally {
        setPending(null);
      }
    },
    [samples, positiveRatio, append, notify, status],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            ตั้งค่า
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            จัดการชุดข้อมูลและโมเดล สำหรับเตรียมระบบและเริ่มเทรนใหม่
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void status.reload()}
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

      {/* ── Current state, so every action below has visible consequences ── */}
      <section
        aria-label="สถานะปัจจุบัน"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <Card>
          <CardHeader>
            <CardTitle>ชุดข้อมูลปัจจุบัน</CardTitle>
            <Badge tone={rows > 0 ? "neutral" : "warning"}>
              <Database className="size-3" aria-hidden="true" />
              {rows} ตัวอย่าง
            </Badge>
          </CardHeader>
          {status.loading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  กลุ่มควบคุม (0)
                </p>
                <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {control}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  กลุ่มเสี่ยง (1)
                </p>
                <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {atRisk}
                </p>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>โมเดลปัจจุบัน</CardTitle>
            <Badge tone={modelInfo?.available ? "success" : "warning"} dot>
              {modelInfo?.available ? "พร้อมใช้งาน" : "ยังไม่มีโมเดล"}
            </Badge>
          </CardHeader>
          {status.loading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">ชื่อโมเดล</dt>
                <dd className="font-semibold text-slate-900 dark:text-slate-100">
                  {modelInfo?.available ? MODEL_DISPLAY_NAME : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">อัลกอริทึม</dt>
                <dd className="font-mono text-xs text-slate-700 dark:text-slate-300">
                  {modelInfo?.model_type ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-slate-500 dark:text-slate-400">ไฟล์</dt>
                <dd className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                  {/* Only once it exists — naming a file that is not there reads
                      as though a model is present. */}
                  {modelInfo?.available
                    ? (modelInfo.model_path.split("/").pop() ?? "—")
                    : "—"}
                </dd>
              </div>
            </dl>
          )}
        </Card>
      </section>

      {/* ── Mock data ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>เพิ่มข้อมูลจำลอง (mockup)</CardTitle>
          <FlaskConical
            className="size-4 shrink-0 text-slate-400"
            aria-hidden="true"
          />
        </CardHeader>

        <Alert tone="warning" title="ข้อมูลนี้ถูกสร้างขึ้น ไม่ใช่การวัดจริง">
          ใช้สำหรับทดสอบและสาธิตระบบเท่านั้น
          โมเดลที่เทรนจากข้อมูลนี้ไม่มีความหมายทางคลินิก
          และห้ามนำผลไปใช้อ้างอิงใดๆ ทุกแถวจะถูกทำเครื่องหมาย{" "}
          <code className="rounded bg-amber-100 px-1 font-mono text-[11px] dark:bg-amber-500/20">
            synthetic_
          </code>{" "}
          ไว้ในชุดข้อมูลเสมอ
        </Alert>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="จำนวนตัวอย่าง"
            type="number"
            min={MIN_SAMPLES}
            max={MAX_SAMPLES}
            step={10}
            value={samples}
            onChange={(event) => setSamples(Number(event.target.value))}
            error={
              !samplesValid
                ? `ต้องอยู่ระหว่าง ${MIN_SAMPLES} ถึง ${MAX_SAMPLES}`
                : undefined
            }
            hint={samplesValid ? "แนะนำอย่างน้อย 100 เพื่อให้ตัวเลขนิ่ง" : undefined}
          />
          <Input
            label="สัดส่วนกลุ่มเสี่ยง (%)"
            type="number"
            min={1}
            max={99}
            step={5}
            value={positiveRatio}
            onChange={(event) => setPositiveRatio(Number(event.target.value))}
            error={!ratioValid ? "ต้องอยู่ระหว่าง 1 ถึง 99" : undefined}
            hint={ratioValid ? "50% คือแบ่งสองกลุ่มเท่ากัน" : undefined}
          />
        </div>

        <div className="mt-4">
          <Checkbox
            label="เพิ่มต่อท้ายข้อมูลเดิม"
            hint={
              append
                ? "ข้อมูลเดิมจะยังอยู่ และเพิ่มแถวใหม่ต่อท้าย"
                : "ข้อมูลเดิมทั้งหมดจะถูกเขียนทับ"
            }
            checked={append}
            onChange={(event) => setAppend(event.target.checked)}
          />
        </div>

        <Button
          className="mt-5"
          fullWidth
          disabled={!samplesValid || !ratioValid}
          loading={pending === "mock"}
          onClick={() => setConfirming("mock")}
          icon={<FlaskConical className="size-4" aria-hidden="true" />}
        >
          {append ? "เพิ่มข้อมูลจำลอง" : "สร้างข้อมูลจำลองใหม่"}
        </Button>
      </Card>

      {/* ── Destructive actions ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>ล้างข้อมูล</CardTitle>
          <AlertTriangle
            className="size-4 shrink-0 text-red-500"
            aria-hidden="true"
          />
        </CardHeader>

        <Alert tone="error" title="ย้อนกลับไม่ได้">
          การลบทั้งสองอย่างนี้กู้คืนไม่ได้จากในระบบ
          ถ้ายังต้องการข้อมูลเดิม ให้สำรองไฟล์ไว้ก่อน
        </Alert>

        <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          <li className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Database className="size-4 text-slate-400" aria-hidden="true" />
                ลบชุดข้อมูล (dataset.csv)
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                ลบตัวอย่างที่มี label ทั้ง {rows} แถว
                โมเดลที่เทรนไว้แล้วและผลประเมินย้อนหลังจะไม่ถูกแตะต้อง
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              disabled={rows === 0}
              loading={pending === "dataset"}
              onClick={() => setConfirming("dataset")}
              icon={<Trash2 className="size-3.5" aria-hidden="true" />}
            >
              ลบ dataset
            </Button>
          </li>

          <li className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <BrainCircuit className="size-4 text-slate-400" aria-hidden="true" />
                ลบโมเดล เพื่อเทรนใหม่
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                ลบไฟล์โมเดลที่เทรนไว้ ชุดข้อมูลยังอยู่ครบ
                ระหว่างที่ยังไม่เทรนใหม่ หน้าประเมินจะทำนายไม่ได้
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              disabled={!modelInfo?.available}
              loading={pending === "model"}
              onClick={() => setConfirming("model")}
              icon={<Trash2 className="size-3.5" aria-hidden="true" />}
            >
              ลบโมเดล
            </Button>
          </li>
        </ul>
      </Card>

      <ConfirmDialog
        open={confirming === "mock"}
        title={append ? "เพิ่มข้อมูลจำลอง?" : "สร้างข้อมูลจำลองใหม่?"}
        description={
          append
            ? `ระบบจะเพิ่มข้อมูลที่สร้างขึ้น ${samples} ตัวอย่าง ` +
              `(กลุ่มเสี่ยง ${positiveRatio}%) ต่อท้ายข้อมูลเดิม ${rows} ตัวอย่าง\n` +
              "ข้อมูลนี้ไม่ใช่การวัดจริง และจะปนอยู่กับข้อมูลจริงในไฟล์เดียวกัน"
            : `ระบบจะเขียนทับ dataset.csv ทั้งไฟล์ด้วยข้อมูลที่สร้างขึ้น ${samples} ตัวอย่าง\n` +
              `ข้อมูลเดิม ${rows} ตัวอย่างจะหายทั้งหมดและกู้คืนไม่ได้`
        }
        confirmLabel={append ? "เพิ่มเลย" : "เขียนทับเลย"}
        tone={append || rows === 0 ? "primary" : "danger"}
        loading={pending === "mock"}
        onConfirm={() => void run("mock")}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        open={confirming === "dataset"}
        title="ลบชุดข้อมูลทั้งหมด?"
        description={
          `ตัวอย่างที่มี label ทั้ง ${rows} แถวจะถูกลบและกู้คืนไม่ได้\n` +
          "โมเดลที่เทรนไว้แล้ว ผลประเมินย้อนหลัง และวิดีโอที่อัปโหลดไว้จะไม่ถูกแตะต้อง"
        }
        confirmLabel="ลบชุดข้อมูล"
        tone="danger"
        loading={pending === "dataset"}
        onConfirm={() => void run("dataset")}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        open={confirming === "model"}
        title="ลบโมเดลปัจจุบัน?"
        description={
          "ไฟล์โมเดลจะถูกลบทันที และหน้าประเมินจะทำนายไม่ได้จนกว่าจะเทรนใหม่\n" +
          `ชุดข้อมูล ${rows} ตัวอย่างยังอยู่ครบ จึงเทรนใหม่ได้จากหน้าภาพรวม`
        }
        confirmLabel="ลบโมเดล"
        tone="danger"
        loading={pending === "model"}
        onConfirm={() => void run("model")}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
