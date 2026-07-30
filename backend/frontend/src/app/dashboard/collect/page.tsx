"use client";

import { useCallback, useState } from "react";
import { ArrowLeft, CheckCircle2, Database, ScrollText } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Loading";
import { AssessmentFlow } from "@/components/assessment/AssessmentFlow";
import { model } from "@/lib/api";
import { PURSUIT_PATTERNS } from "@/lib/constants";
import { useAsync } from "@/hooks/useAsync";
import type { PursuitPattern } from "@/lib/types";

const LABEL_OPTIONS = [
  { value: "", label: "— ต้องเลือกก่อนเริ่ม —" },
  { value: "0", label: "0 — กลุ่มควบคุม (control)" },
  { value: "1", label: "1 — กลุ่มเสี่ยง (at risk)" },
];

/**
 * Researcher collection page.
 *
 * Recordings made here carry a label and therefore go to `/api/upload`, which
 * appends the sample to `dataset.csv`. Both the label and the participant id
 * are required before the camera opens: an unlabelled or anonymous sample is
 * useless for training and cannot be grouped by subject later.
 */
export default function CollectPage() {
  const [subjectId, setSubjectId] = useState("");
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState(30);
  const [pattern, setPattern] = useState<PursuitPattern>("horizontal");
  const [recording, setRecording] = useState(false);
  const [touched, setTouched] = useState(false);

  const status = useAsync(() => model.status(), []);
  const counts = status.data?.dataset.label_counts ?? {};
  const control = Number(counts["0"] ?? 0);
  const atRisk = Number(counts["1"] ?? 0);

  const subjectError =
    touched && !subjectId.trim() ? "กรุณาใส่รหัสผู้เข้าร่วม" : undefined;
  const labelError = touched && !label ? "กรุณาเลือกกลุ่มก่อนเริ่ม" : undefined;
  const ready = Boolean(subjectId.trim() && label);

  const onSubmitted = useCallback(() => {
    void status.reload();
  }, [status]);

  // While recording, the settings collapse away and the camera takes the whole
  // width, centred: the operator is looking at the participant's face, not at
  // a form they have already filled in.
  if (recording) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              กำลังเก็บข้อมูล
            </h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              ผู้เข้าร่วม <strong>{subjectId.trim()}</strong> ·{" "}
              {label === "1" ? "กลุ่มเสี่ยง (1)" : "กลุ่มควบคุม (0)"} · {duration}{" "}
              วินาที
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRecording(false)}
            icon={<ArrowLeft className="size-3.5" aria-hidden="true" />}
          >
            แก้ไขการตั้งค่า
          </Button>
        </div>

        <AssessmentFlow
          subjectId={subjectId.trim()}
          durationSeconds={duration}
          pattern={pattern}
          label={label}
          onSubmitted={onSubmitted}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          เก็บข้อมูล
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          บันทึกตัวอย่างพร้อม label เข้าชุดข้อมูลสำหรับเทรนโมเดล
        </p>
      </div>

      <Alert tone="warning" title="ก่อนเก็บข้อมูลจากผู้เข้าร่วมจริง">
        ต้องผ่านการอนุมัติจากคณะกรรมการจริยธรรมการวิจัยในมนุษย์
        และได้รับความยินยอมเป็นลายลักษณ์อักษรแล้ว
        วิดีโอใบหน้าเป็นข้อมูลชีวมิติที่ทำให้ไม่ระบุตัวตนไม่ได้ จึงอยู่ภายใต้ PDPA
      </Alert>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>ชุดข้อมูลปัจจุบัน</CardTitle>
              <Badge tone="neutral">
                <Database className="size-3" aria-hidden="true" />
                {status.data?.dataset.rows ?? 0} ตัวอย่าง
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
              <CardTitle>ตั้งค่าตัวอย่าง</CardTitle>
            </CardHeader>
            <fieldset className="space-y-4">
              <legend className="sr-only">รายละเอียดตัวอย่างที่จะบันทึก</legend>
              <Input
                label="รหัสผู้เข้าร่วม"
                required
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="เช่น P001"
                autoComplete="off"
                error={subjectError}
                hint={!subjectError ? "ใช้แบ่งข้อมูลตามคนตอนวิเคราะห์" : undefined}
              />
              <Select
                label="Label สำหรับ dataset"
                required
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                onBlur={() => setTouched(true)}
                options={LABEL_OPTIONS}
                error={labelError}
              />
              <Input
                label="ระยะเวลา (วินาที)"
                type="number"
                min={10}
                max={60}
                step={5}
                value={duration}
                onChange={(event) =>
                  setDuration(
                    Math.min(60, Math.max(10, Number(event.target.value) || 30)),
                  )
                }
              />
              <Select
                label="รูปแบบการเคลื่อนที่"
                value={pattern}
                onChange={(event) => setPattern(event.target.value as PursuitPattern)}
                options={PURSUIT_PATTERNS}
              />
            </fieldset>

            <Button
              fullWidth
              className="mt-4"
              disabled={!ready}
              onClick={() => {
                setTouched(true);
                if (ready) setRecording(true);
              }}
              icon={<CheckCircle2 className="size-4" aria-hidden="true" />}
            >
              {ready ? "เริ่มบันทึกตัวอย่าง" : "กรอกข้อมูลให้ครบก่อน"}
            </Button>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>คำแนะนำ</CardTitle>
              <ScrollText
                className="size-4 shrink-0 text-slate-400"
                aria-hidden="true"
              />
            </CardHeader>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              {[
                "ใส่รหัสผู้เข้าร่วมให้ตรงกับฐานข้อมูลของโครงการทุกครั้ง",
                "ใช้อุปกรณ์ ระยะห่าง และสภาพแสงเดียวกันทุกคน",
                "เก็บกลุ่มควบคุมและกลุ่มเสี่ยงให้จำนวนใกล้เคียงกัน",
                "บันทึกอายุและเพศไว้นอกระบบ เพื่อควบคุมตัวกวนตอนวิเคราะห์",
              ].map((text) => (
                <li key={text} className="flex gap-2">
                  <span
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500"
                    aria-hidden="true"
                  />
                  {text}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card className="flex min-h-72 flex-col items-center justify-center text-center">
            <span
              className="mb-4 flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
              aria-hidden="true"
            >
              <Database className="size-6" />
            </span>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              ยังไม่ได้เริ่มบันทึก
            </p>
            <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
              กรอกรหัสผู้เข้าร่วมและเลือกกลุ่ม แล้วกดเริ่มบันทึกตัวอย่าง
              กล้องจะแสดงเต็มหน้าจอตรงกลาง
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
