"use client";

import { useCallback, useState } from "react";
import { CheckCircle2, Database, RefreshCw, ScrollText, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Loading";
import { Modal } from "@/components/ui/Modal";
import { AssessmentFlow } from "@/components/assessment/AssessmentFlow";
import { model } from "@/lib/api";
import { MAX_AGE, MIN_AGE, PURSUIT_PATTERNS } from "@/lib/constants";
import { generateSubjectId } from "@/lib/subject";
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
  // Generated in a state initialiser so the static export and the first client
  // render agree; computing it during render would trip a hydration mismatch.
  const [subjectId, setSubjectId] = useState(() => generateSubjectId());
  const [age, setAge] = useState("");
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState(30);
  const [pattern, setPattern] = useState<PursuitPattern>("horizontal");
  const [recording, setRecording] = useState(false);
  const [touched, setTouched] = useState(false);

  const status = useAsync(() => model.status(), []);
  const counts = status.data?.dataset.label_counts ?? {};
  const control = Number(counts["0"] ?? 0);
  const atRisk = Number(counts["1"] ?? 0);

  const parsedAge = Number(age);
  const ageValid =
    age.trim() !== "" &&
    Number.isInteger(parsedAge) &&
    parsedAge >= MIN_AGE &&
    parsedAge <= MAX_AGE;

  const subjectError =
    touched && !subjectId.trim() ? "กรุณาใส่รหัสผู้เข้าร่วม" : undefined;
  const ageError = touched && !ageValid ? `กรุณาใส่อายุ ${MIN_AGE}–${MAX_AGE} ปี` : undefined;
  const labelError = touched && !label ? "กรุณาเลือกกลุ่มก่อนเริ่ม" : undefined;
  const ready = Boolean(subjectId.trim() && label && ageValid);

  const onSubmitted = useCallback(() => {
    void status.reload();
  }, [status]);

  /**
   * Close the recording dialog and hand the operator a fresh id.
   *
   * Reusing the previous id is the classic collection mistake: two different
   * participants land under one code and neither can be told apart afterwards.
   * The reset happens on close rather than on submit so the result stays
   * labelled with the participant it actually belongs to while it is on screen.
   */
  const closeRecording = useCallback(() => {
    setRecording(false);
    setSubjectId(generateSubjectId());
    setAge("");
    setTouched(false);
  }, []);

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

      {/* The camera lives in the dialog below, so nothing here previews it —
          the form is the whole page until recording actually starts. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-5">
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
              <div>
                <Input
                  label="รหัสผู้เข้าร่วม"
                  required
                  value={subjectId}
                  onChange={(event) => setSubjectId(event.target.value)}
                  onBlur={() => setTouched(true)}
                  placeholder="เช่น P001"
                  autoComplete="off"
                  error={subjectError}
                  hint={
                    !subjectError
                      ? "สร้างให้อัตโนมัติ และสร้างใหม่ทุกครั้งหลังบันทึกเสร็จ"
                      : undefined
                  }
                />
                <button
                  type="button"
                  onClick={() => setSubjectId(generateSubjectId())}
                  className="mt-1.5 inline-flex items-center gap-1 rounded text-xs font-medium text-brand-600 outline-none transition-colors hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  <RefreshCw className="size-3" aria-hidden="true" />
                  สร้างรหัสใหม่
                </button>
              </div>
              <Input
                label="อายุ (ปี)"
                required
                type="number"
                inputMode="numeric"
                min={MIN_AGE}
                max={MAX_AGE}
                value={age}
                onChange={(event) => setAge(event.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="เช่น 68"
                autoComplete="off"
                error={ageError}
                hint={
                  !ageError
                    ? "เก็บเป็นข้อมูลประกอบ ไม่ได้ใช้เป็น feature ของโมเดล"
                    : undefined
                }
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
        </div>

        <div className="space-y-5">
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
                "จับคู่ช่วงอายุของสองกลุ่มให้ใกล้เคียงกัน เพราะอายุเป็นตัวกวนที่แรงที่สุด",
                "บันทึกเพศและข้อมูลอื่นไว้นอกระบบ ระบบนี้เก็บเฉพาะรหัสและอายุ",
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

          <Card>
            <CardHeader>
              <CardTitle>วิดีโอถูกลบหลังบันทึก</CardTitle>
              <Trash2 className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
            </CardHeader>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              เมื่อตัวอย่างถูกเพิ่มเข้า <code>dataset.csv</code> แล้ว
              ระบบจะลบไฟล์วิดีโอทิ้งทันทีเพื่อไม่ให้เปลืองพื้นที่
              โดยเก็บเฉพาะไฟล์ค่าที่วัดได้รายเฟรม ซึ่งย้อนกลับไปเป็นใบหน้าไม่ได้
              ทั้งการเทรนและการตรวจสอบย้อนหลังใช้ไฟล์นั้นอยู่แล้ว
            </p>
          </Card>
        </div>
      </div>

      {/* ── Recording dialog ───────────────────────────────────────────── */}
      <Modal
        open={recording}
        onClose={closeRecording}
        size="xl"
        title="บันทึกตัวอย่าง"
        description={`ผู้เข้าร่วม ${subjectId.trim()} · อายุ ${parsedAge} ปี · ${
          label === "1" ? "กลุ่มเสี่ยง (1)" : "กลุ่มควบคุม (0)"
        } · ${duration} วินาที`}
        bodyClassName="max-h-[78vh]"
      >
        <AssessmentFlow
          subjectId={subjectId.trim()}
          age={parsedAge}
          durationSeconds={duration}
          pattern={pattern}
          label={label}
          onSubmitted={onSubmitted}
        />
      </Modal>
    </div>
  );
}
