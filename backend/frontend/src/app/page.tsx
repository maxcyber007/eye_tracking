"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  Eye,
  FileText,
  IdCard,
  Lightbulb,
  ListChecks,
  Play,
  ShieldAlert,
  SlidersHorizontal,
  Smartphone,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Accordion, AccordionSection } from "@/components/ui/Accordion";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox, Input, Select } from "@/components/ui/Input";
import { Stepper, type Step } from "@/components/ui/Stepper";
import { AssessmentFlow } from "@/components/assessment/AssessmentFlow";
import { PURSUIT_PATTERNS } from "@/lib/constants";
import type { PursuitPattern } from "@/lib/types";

const STEPS: Step[] = [
  { id: "intake", label: "ข้อมูลและการตั้งค่า", description: "ระบุผู้เข้ารับการประเมิน" },
  { id: "consent", label: "คำชี้แจงและความยินยอม", description: "อ่านและยืนยัน" },
  { id: "assess", label: "ทำแบบประเมิน", description: "มองตามสิ่งเร้า" },
];

const PREPARATION = [
  { icon: Lightbulb, text: "อยู่ในที่ที่มีแสงสว่างเพียงพอ ไม่ย้อนแสง" },
  { icon: Smartphone, text: "ถือเครื่องให้มั่นคง ห่างจากใบหน้าประมาณ 30–40 ซม." },
  { icon: Eye, text: "ถอดแว่นที่สะท้อนแสงจ้าออก ถ้าทำได้" },
  { icon: ShieldAlert, text: "ขยับเฉพาะดวงตา อย่าหันศีรษะตามสิ่งเร้า" },
];

/**
 * Participant-facing assessment.
 *
 * Laid out the way a clinical intake is: an identifying banner that stays
 * visible once filled, collapsible sections grouping the form, an explicit
 * consent gate, and only then the procedure itself. The steps are sequential
 * because the camera should not turn on before the participant has read the
 * disclaimer and agreed to it.
 *
 * There is deliberately no label field and no access to other people's
 * results: a participant must never be asked to classify themselves, nor see
 * anyone else's assessment.
 */
export default function ParticipantPage() {
  const [step, setStep] = useState(0);
  const [subjectId, setSubjectId] = useState("");
  const [duration, setDuration] = useState(30);
  const [pattern, setPattern] = useState<PursuitPattern>("horizontal");
  const [consent, setConsent] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [touched, setTouched] = useState(false);

  const patternLabel = useMemo(
    () => PURSUIT_PATTERNS.find((item) => item.value === pattern)?.label ?? pattern,
    [pattern],
  );

  const consentComplete = consent && understood;
  const subjectError =
    touched && !subjectId.trim() ? "กรุณาระบุรหัสผู้เข้ารับการประเมิน" : undefined;

  const goToConsent = () => {
    setTouched(true);
    if (subjectId.trim()) setStep(1);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* ── Clinical header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white"
            aria-hidden="true"
          >
            <Eye className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              แบบประเมินการเคลื่อนไหวดวงตา
            </p>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              Eye-Tracking Assessment · เพื่อการวิจัย
            </p>
          </div>
          <Badge tone="warning" className="shrink-0">
            ไม่ใช่การวินิจฉัย
          </Badge>
        </div>

        <div className="mx-auto max-w-3xl px-4 pb-3 sm:px-6">
          <Stepper steps={STEPS} current={step} />
        </div>
      </header>

      {/* ── Participant banner, the way a clinical record shows it ──── */}
      {subjectId.trim() && step > 0 && (
        <div className="border-b border-brand-100 bg-brand-50/70 dark:border-brand-500/20 dark:bg-brand-500/10">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5 sm:px-6">
            <span className="flex items-center gap-1.5 text-xs">
              <IdCard className="size-3.5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
              <span className="text-slate-500 dark:text-slate-400">รหัส</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {subjectId.trim()}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-xs">
              <CalendarClock
                className="size-3.5 text-brand-600 dark:text-brand-400"
                aria-hidden="true"
              />
              <span className="text-slate-500 dark:text-slate-400">ระยะเวลา</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {duration} วินาที
              </span>
            </span>
            <span className="hidden items-center gap-1.5 text-xs sm:flex">
              <SlidersHorizontal
                className="size-3.5 text-brand-600 dark:text-brand-400"
                aria-hidden="true"
              />
              <span className="text-slate-500 dark:text-slate-400">รูปแบบ</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {patternLabel}
              </span>
            </span>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <AnimatePresence mode="wait">
          {/* ── Step 1: intake ─────────────────────────────────────── */}
          {step === 0 && (
            <motion.div
              key="intake"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22 }}
              className="space-y-5"
            >
              <div>
                <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  ข้อมูลผู้เข้ารับการประเมิน
                </h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  กรอกข้อมูลที่จำเป็นก่อนเริ่มแบบประเมิน หัวข้อที่มี{" "}
                  <span className="text-red-500">*</span> ต้องกรอก
                </p>
              </div>

              <Accordion>
                <AccordionSection
                  title="ข้อมูลระบุตัวผู้เข้ารับการประเมิน"
                  summary="รหัสที่ใช้อ้างอิงผลการประเมิน"
                  icon={UserRound}
                  defaultOpen
                  status={
                    subjectId.trim()
                      ? { label: "กรอกแล้ว", tone: "success" }
                      : { label: "จำเป็น", tone: "danger" }
                  }
                >
                  <div className="space-y-4">
                    <Input
                      label="รหัสผู้เข้ารับการประเมิน (HN / Subject ID)"
                      required
                      value={subjectId}
                      onChange={(event) => setSubjectId(event.target.value)}
                      onBlur={() => setTouched(true)}
                      placeholder="เช่น P001 หรือ HN-123456"
                      autoComplete="off"
                      error={subjectError}
                      hint={
                        !subjectError
                          ? "ใช้อ้างอิงผลย้อนหลัง ไม่ต้องกรอกชื่อ-นามสกุล"
                          : undefined
                      }
                      icon={<IdCard className="size-4" aria-hidden="true" />}
                    />
                    <Alert tone="info">
                      ระบบเก็บเฉพาะรหัสอ้างอิงและวิดีโอการทำแบบประเมิน
                      ไม่ได้เก็บชื่อ นามสกุล หรือเลขบัตรประชาชน
                    </Alert>
                  </div>
                </AccordionSection>

                <AccordionSection
                  title="ตั้งค่าแบบประเมิน"
                  summary={`${duration} วินาที · ${patternLabel}`}
                  icon={SlidersHorizontal}
                  status={{ label: "ค่าเริ่มต้น", tone: "neutral" }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="ระยะเวลาการบันทึก (วินาที)"
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
                      hint="แนะนำ 20–30 วินาที"
                    />
                    <Select
                      label="รูปแบบการเคลื่อนที่ของสิ่งเร้า"
                      value={pattern}
                      onChange={(event) =>
                        setPattern(event.target.value as PursuitPattern)
                      }
                      options={PURSUIT_PATTERNS}
                      hint="ใช้รูปแบบเดียวกันทุกครั้งเพื่อให้เทียบผลกันได้"
                    />
                  </div>
                </AccordionSection>

                <AccordionSection
                  title="ขั้นตอนการประเมินโดยสังเขป"
                  summary="สิ่งที่จะเกิดขึ้นหลังกดเริ่ม"
                  icon={ListChecks}
                >
                  <ol className="space-y-3">
                    {[
                      "ระบบขอสิทธิ์ใช้กล้องหน้าของอุปกรณ์",
                      "จัดตำแหน่งใบหน้าให้อยู่ในกรอบที่กำหนด",
                      `นับถอยหลัง 3 วินาที แล้วบันทึกวิดีโอ ${duration} วินาที`,
                      "ระบบวิเคราะห์การเคลื่อนไหวดวงตาและแสดงผล",
                    ].map((text, index) => (
                      <li key={text} className="flex gap-3">
                        <span
                          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                          aria-hidden="true"
                        >
                          {index + 1}
                        </span>
                        <span className="text-sm text-slate-600 dark:text-slate-300">
                          {text}
                        </span>
                      </li>
                    ))}
                  </ol>
                </AccordionSection>
              </Accordion>

              <div className="flex justify-end">
                <Button size="lg" onClick={goToConsent} className="w-full sm:w-auto">
                  ถัดไป
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              </div>

              <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                เป็นนักวิจัยหรือผู้ดูแลระบบ?{" "}
                <a
                  href="/ui/login/"
                  className="rounded font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
                >
                  เข้าสู่ระบบ
                </a>
              </p>
            </motion.div>
          )}

          {/* ── Step 2: consent ────────────────────────────────────── */}
          {step === 1 && (
            <motion.div
              key="consent"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22 }}
              className="space-y-5"
            >
              <div>
                <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  คำชี้แจงและความยินยอม
                </h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  กรุณาอ่านให้ครบก่อนยืนยัน
                </p>
              </div>

              <Alert tone="warning" title="ข้อจำกัดของเครื่องมือนี้">
                นี่คือซอฟต์แวร์ต้นแบบสำหรับงานวิจัย <strong>ไม่ใช่เครื่องมือแพทย์</strong>{" "}
                ไม่สามารถใช้วินิจฉัย คัดกรอง หรือตัดสินใจรักษาได้
                ผลลัพธ์เป็นเพียงตัวเลขจากแบบจำลองทางสถิติ
                หากคุณกังวลเรื่องความจำหรือการรับรู้ กรุณาปรึกษาแพทย์
              </Alert>

              <Accordion>
                <AccordionSection
                  title="การเตรียมความพร้อม"
                  summary="ปฏิบัติตามเพื่อให้ผลแม่นยำ"
                  icon={ClipboardCheck}
                  defaultOpen
                >
                  <ul className="space-y-3">
                    {PREPARATION.map(({ icon: Icon, text }) => (
                      <li key={text} className="flex items-start gap-3">
                        <Icon
                          className="mt-0.5 size-4 shrink-0 text-brand-500"
                          aria-hidden="true"
                        />
                        <span className="text-sm text-slate-600 dark:text-slate-300">
                          {text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </AccordionSection>

                <AccordionSection
                  title="ข้อมูลที่จัดเก็บและการนำไปใช้"
                  summary="วิดีโอใบหน้า รหัสอ้างอิง และค่าที่วัดได้"
                  icon={FileText}
                >
                  <ul className="space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
                    {[
                      "ระบบบันทึกวิดีโอใบหน้าระหว่างทำแบบประเมิน เพื่อสกัดค่าการเคลื่อนไหวดวงตา",
                      "วิดีโอใบหน้าเป็นข้อมูลชีวมิติซึ่งทำให้ไม่ระบุตัวตนไม่ได้ จึงอยู่ภายใต้ PDPA",
                      "ข้อมูลถูกประมวลผลบนเซิร์ฟเวอร์ของโครงการเท่านั้น ไม่ส่งออกไปยังบุคคลที่สาม",
                      "คุณสามารถขอให้ลบข้อมูลของคุณได้ โดยติดต่อผู้รับผิดชอบโครงการ",
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
                </AccordionSection>

                <AccordionSection
                  title="ผลลัพธ์ที่จะได้รับ"
                  summary="คะแนนความเสี่ยงและค่าที่วัดได้"
                  icon={Stethoscope}
                >
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    เมื่อประมวลผลเสร็จ ระบบจะแสดงคะแนนระหว่าง 0 ถึง 1
                    พร้อมระดับความเสี่ยงสามระดับ และค่าที่วัดได้ทั้งสิบค่า
                    ตัวเลขเหล่านี้อธิบายรูปแบบการเคลื่อนไหวดวงตาที่ตรวจพบในคลิปนี้เท่านั้น
                    ไม่ได้บ่งชี้ภาวะสุขภาพใด และไม่ควรนำไปใช้แทนการตรวจโดยแพทย์
                  </p>
                </AccordionSection>
              </Accordion>

              <Card className="space-y-3.5">
                <Checkbox
                  label="ข้าพเจ้าได้อ่านและเข้าใจว่าเครื่องมือนี้เป็นซอฟต์แวร์วิจัย ไม่ใช่การวินิจฉัยทางการแพทย์"
                  checked={understood}
                  onChange={(event) => setUnderstood(event.target.checked)}
                />
                <Checkbox
                  label="ข้าพเจ้ายินยอมให้บันทึกวิดีโอใบหน้าและนำข้อมูลไปใช้เพื่อการวิจัยตามที่ระบุข้างต้น"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
              </Card>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setStep(0)}
                  icon={<ArrowLeft className="size-4" aria-hidden="true" />}
                >
                  ย้อนกลับ
                </Button>
                <Button
                  size="lg"
                  disabled={!consentComplete}
                  onClick={() => setStep(2)}
                  icon={<Play className="size-4" aria-hidden="true" />}
                >
                  {consentComplete ? "เริ่มแบบประเมิน" : "กรุณายืนยันทั้งสองข้อ"}
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step 3: assessment ─────────────────────────────────── */}
          {step === 2 && (
            <motion.div
              key="assess"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
              className="space-y-4"
            >
              <AssessmentFlow
                subjectId={subjectId.trim()}
                durationSeconds={duration}
                pattern={pattern}
              />
              <button
                type="button"
                onClick={() => setStep(1)}
                className={cn(
                  "mx-auto block rounded text-xs text-slate-400 transition-colors",
                  "hover:text-slate-600 dark:hover:text-slate-300",
                )}
              >
                ← กลับไปแก้ไขข้อมูล
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="mx-auto max-w-3xl px-4 pb-8 sm:px-6">
        <p className="border-t border-slate-200 pt-4 text-center text-[11px] leading-relaxed text-slate-400 dark:border-slate-800 dark:text-slate-500">
          ระบบต้นแบบสำหรับงานวิจัย — ผลลัพธ์ไม่ใช่การวินิจฉัยทางการแพทย์
          <br />
          หากมีข้อสงสัยเกี่ยวกับสุขภาพ กรุณาปรึกษาแพทย์หรือบุคลากรทางการแพทย์
        </p>
      </footer>
    </div>
  );
}
