"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Eye, Lightbulb, ShieldAlert, Smartphone, UserRound } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { AssessmentFlow } from "@/components/assessment/AssessmentFlow";
import { PURSUIT_PATTERNS } from "@/lib/constants";
import type { PursuitPattern } from "@/lib/types";

/**
 * Participant-facing test page.
 *
 * Deliberately has no label field and no access to other people's results: a
 * participant must never be asked to classify themselves, nor see anyone
 * else's assessment.
 */
export default function ParticipantPage() {
  const [started, setStarted] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [duration, setDuration] = useState(30);
  const [pattern, setPattern] = useState<PursuitPattern>("horizontal");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <div
        role="note"
        className="sticky top-0 z-20 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
      >
        เครื่องมือวิจัย — ไม่ใช่การวินิจฉัยทางการแพทย์
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        {!started ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-5"
          >
            <header className="text-center">
              <span
                className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/20"
                aria-hidden="true"
              >
                <Eye className="size-8" />
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                ทดสอบการเคลื่อนไหวดวงตา
              </h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                แบบทดสอบใช้เวลาประมาณ {duration} วินาที
                โดยให้คุณมองตามลูกบอลที่เคลื่อนที่บนหน้าจอ
                ระบบจะวิเคราะห์รูปแบบการเคลื่อนไหวของดวงตาจากกล้องหน้า
              </p>
            </header>

            <Alert tone="warning" title="โปรดอ่านก่อนเริ่ม">
              นี่คือซอฟต์แวร์ต้นแบบสำหรับงานวิจัย <strong>ไม่ใช่เครื่องมือแพทย์</strong>{" "}
              และไม่สามารถใช้วินิจฉัยหรือคัดกรองโรคได้
              ผลลัพธ์ที่ได้เป็นเพียงตัวเลขจากแบบจำลองทางสถิติ
              หากคุณกังวลเรื่องความจำหรือการรับรู้ กรุณาปรึกษาแพทย์
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle>เตรียมตัว</CardTitle>
              </CardHeader>
              <ul className="space-y-2.5">
                {[
                  { icon: Lightbulb, text: "อยู่ในที่ที่มีแสงสว่างเพียงพอ ไม่ย้อนแสง" },
                  { icon: Smartphone, text: "ถือเครื่องให้มั่นคง ห่างจากใบหน้าประมาณ 30–40 ซม." },
                  { icon: UserRound, text: "ถอดแว่นที่สะท้อนแสงจ้าออก ถ้าทำได้" },
                  { icon: ShieldAlert, text: "ขยับเฉพาะดวงตา อย่าหันศีรษะตามลูกบอล" },
                ].map(({ icon: Icon, text }) => (
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
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>ตั้งค่าการทดสอบ</CardTitle>
              </CardHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="รหัสผู้เข้าร่วม"
                  value={subjectId}
                  onChange={(event) => setSubjectId(event.target.value)}
                  placeholder="เช่น P001"
                  autoComplete="off"
                  hint="ไม่บังคับ"
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
                <div className="sm:col-span-2">
                  <Select
                    label="รูปแบบการเคลื่อนที่"
                    value={pattern}
                    onChange={(event) =>
                      setPattern(event.target.value as PursuitPattern)
                    }
                    options={PURSUIT_PATTERNS}
                  />
                </div>
              </div>
            </Card>

            <Button size="lg" fullWidth onClick={() => setStarted(true)}>
              เริ่มต้น
            </Button>

            <p className="text-center text-xs text-slate-400 dark:text-slate-500">
              เป็นนักวิจัย?{" "}
              <a
                href="/ui/login/"
                className="rounded font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
              >
                เข้าสู่ระบบ
              </a>
            </p>
          </motion.div>
        ) : (
          <AssessmentFlow
            subjectId={subjectId}
            durationSeconds={duration}
            pattern={pattern}
          />
        )}
      </main>
    </div>
  );
}
