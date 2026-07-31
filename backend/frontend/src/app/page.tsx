"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Activity,
  Camera,
  ClipboardCheck,
  Eye,
  Gauge,
  GraduationCap,
  Home,
  Landmark,
  LayoutDashboard,
  ScanLine,
  School,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Target,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Public landing page.
 *
 * Describes what the system actually does — analysing a front-camera *video* of
 * a smooth-pursuit task — rather than any imaging modality it does not support.
 * The disclaimer appears in the hero, beside the call to action and again in
 * the footer, because this is health-adjacent output and a visitor should never
 * reach the assessment without having seen it.
 */

const WORKFLOW: { icon: LucideIcon; step: string; title: string; body: string }[] = [
  {
    icon: ClipboardCheck,
    step: "01",
    title: "กรอกข้อมูลและยินยอม",
    body: "ระบุรหัสผู้เข้ารับการประเมิน อ่านคำชี้แจง แล้วยืนยันความยินยอมก่อนเริ่ม",
  },
  {
    icon: Camera,
    step: "02",
    title: "มองตามสิ่งเร้า",
    body: "เปิดกล้องหน้า มองตามจุดที่เคลื่อนที่ประมาณ 30 วินาที โดยไม่ขยับศีรษะ",
  },
  {
    icon: Gauge,
    step: "03",
    title: "รับผลการประเมิน",
    body: "ดูคะแนนความเสี่ยง ระดับผล และค่าที่วัดได้ทั้งสิบค่าพร้อมคำอธิบาย",
  },
];

const HIGHLIGHTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ScanLine,
    title: "ตรวจจับดวงตาด้วย MediaPipe",
    body: "ใช้ FaceMesh หาตำแหน่งม่านตาทุกเฟรม แล้วคำนวณความเร็ว ความเร่ง และความราบรื่นของการเคลื่อนไหว",
  },
  {
    icon: Eye,
    title: "อธิบายผลได้",
    body: "แสดงค่าที่วัดได้ทั้งสิบค่าพร้อมหน่วยและความหมาย ไม่ใช่คะแนนลอยๆ ที่ตรวจสอบย้อนกลับไม่ได้",
  },
  {
    icon: ShieldCheck,
    title: "ปลอดภัยและโปร่งใส",
    body: "ประมวลผลบนเซิร์ฟเวอร์ของโครงการเท่านั้น แจ้งชัดเจนว่าผลลัพธ์ไม่ใช่การวินิจฉัยทางการแพทย์",
  },
  {
    icon: Activity,
    title: "ติดตามผลย้อนหลัง",
    body: "บันทึกผลทุกครั้งพร้อมรหัสผู้เข้าร่วม สำหรับนักวิจัยใช้เทียบแนวโน้มและส่งออกเป็น CSV",
  },
];

/** Focus ring that stays visible against the blue header, where a brand-coloured one would not. */
const FOCUS_ON_BLUE =
  "outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-600";

/** Focus ring for controls sitting on the page background. */
const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900";

/** Project authors, in the order the team supplied them. */
const DEVELOPERS = [
  "เด็กหญิงกุลรดา รังสิยานนท์",
  "เด็กชายธีราธร ลิ้มสกุล",
  "เด็กชายปัณณวิชญ์ จอมชาญพันธ์",
];

const CHIPS = [
  { icon: Target, label: "Smooth Pursuit" },
  { icon: Stethoscope, label: "Research Grade" },
  { icon: Sparkles, label: "Explainable Insights" },
];

/** Stylised eye, drawn rather than shipped as an image asset. */
function EyeArtwork() {
  return (
    <svg viewBox="0 0 320 200" className="h-full w-full" role="img" aria-label="ภาพประกอบดวงตา">
      <defs>
        <radialGradient id="iris" cx="42%" cy="38%">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="45%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0c4a6e" />
        </radialGradient>
        <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      <circle cx="118" cy="70" r="62" fill="url(#glow)" />
      <circle cx="215" cy="130" r="72" fill="url(#glow)" />

      <rect x="72" y="34" width="176" height="132" rx="20" fill="#0f172a" opacity="0.55" />

      <circle cx="160" cy="100" r="52" fill="#e2e8f0" opacity="0.16" />
      <circle cx="160" cy="100" r="40" fill="url(#iris)" />
      <circle cx="160" cy="100" r="15" fill="#0f172a" />
      <circle cx="149" cy="88" r="6" fill="#f8fafc" opacity="0.9" />

      {/* Tracking arcs, echoing the pursuit path the task measures. */}
      <path
        d="M160 44 a56 56 0 0 1 48 28"
        fill="none"
        stroke="#7dd3fc"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M112 128 a56 56 0 0 0 34 26"
        fill="none"
        stroke="#7dd3fc"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.7"
      />

      <rect x="104" y="152" width="78" height="7" rx="3.5" fill="#7dd3fc" opacity="0.5" />
      <rect x="104" y="166" width="52" height="7" rx="3.5" fill="#7dd3fc" opacity="0.3" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-100 via-sky-50 to-white dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-gradient-to-r from-brand-700 via-brand-600 to-sky-500 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/25"
            aria-hidden="true"
          >
            <Home className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-white">MyEye</p>
            {/* Dropped below sm so the brand never collapses to nothing at 320px. */}
            <p className="hidden truncate text-[11px] text-sky-100 sm:block">
              Early Alzheimer Risk Screening
            </p>
          </div>

          <nav aria-label="เมนูหลัก" className="flex shrink-0 items-center gap-2">
            <span
              aria-current="page"
              className="hidden items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2 text-xs font-medium text-white ring-1 ring-white/25 md:flex"
            >
              <Home className="size-3.5" aria-hidden="true" />
              หน้าหลัก
            </span>
            <Link
              href="/assessment/"
              className={cn(
                "hidden items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2 text-xs font-medium text-white ring-1 ring-white/25 sm:flex",
                "transition-colors hover:bg-white/25",
                FOCUS_ON_BLUE,
              )}
            >
              <ScanLine className="size-3.5" aria-hidden="true" />
              เริ่มประเมิน
            </Link>
            {/* Anchor rather than a route: the credits live on this page, and a
                same-page jump keeps the landing page a single scroll. */}
            <a
              href="#developers"
              className={cn(
                "hidden items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2 text-xs font-medium text-white ring-1 ring-white/25 md:flex",
                "transition-colors hover:bg-white/25",
                FOCUS_ON_BLUE,
              )}
            >
              <Users className="size-3.5" aria-hidden="true" />
              ผู้พัฒนา
            </a>
            <Link
              href="/dashboard/"
              className={cn(
                "flex items-center gap-1.5 rounded-full bg-white/25 px-3.5 py-2 text-xs font-semibold text-white ring-1 ring-white/30",
                "transition-colors hover:bg-white/35",
                FOCUS_ON_BLUE,
              )}
            >
              <LayoutDashboard className="size-3.5" aria-hidden="true" />
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
        {/* ── Hero ───────────────────────────────────────────────────── */}
        <section className="grid items-start gap-8 lg:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-3xl bg-white p-7 shadow-xl shadow-sky-900/5 sm:p-9 dark:bg-slate-900"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              AI Screening Tool · Research Use Only
            </span>

            <h1 className="mt-5 text-3xl font-bold leading-snug tracking-tight text-slate-900 sm:text-4xl dark:text-slate-50">
              ระบบประเมินความเสี่ยง
              <br />
              โรคอัลไซเมอร์เบื้องต้นด้วย AI
              <br />
              จากการเคลื่อนไหวดวงตา
            </h1>

            <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
              เครื่องมือวิจัยที่วิเคราะห์รูปแบบการมองตามวัตถุจากกล้องหน้าสมาร์ทโฟน
              เพื่อให้ทีมวิจัยได้สัญญาณเชิงปริมาณอย่างปลอดภัยและตรวจสอบย้อนกลับได้
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/assessment/"
                className={cn(
                  "inline-flex items-center gap-2 rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/25",
                  "transition-all hover:bg-brand-700 active:scale-[0.98]",
                  FOCUS_RING,
                )}
              >
                <ScanLine className="size-4" aria-hidden="true" />
                เริ่มประเมิน
              </Link>
              <Link
                href="/login/"
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700",
                  "transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
                  FOCUS_RING,
                )}
              >
                <LayoutDashboard className="size-4" aria-hidden="true" />
                สำหรับนักวิจัย
              </Link>
            </div>

            <ul className="mt-7 flex flex-wrap gap-2.5">
              {CHIPS.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3.5 py-2 text-xs font-medium text-white"
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-3xl bg-gradient-to-br from-sky-400 via-brand-500 to-brand-700 p-6 shadow-xl shadow-brand-900/15 sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-sky-100">AI Screening Assistant</p>
                <p className="text-2xl font-bold text-white">MyEye</p>
              </div>
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/20 text-white ring-1 ring-white/30"
                aria-hidden="true"
              >
                <ShieldCheck className="size-5" />
              </span>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl bg-slate-950/70 p-4 ring-1 ring-white/10">
              <div className="aspect-video">
                <EyeArtwork />
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/15 p-4 ring-1 ring-white/20">
                <p className="text-[11px] font-medium text-sky-100">ผลลัพธ์ที่ได้</p>
                <p className="mt-1 text-lg font-bold leading-snug text-white">
                  ความเสี่ยงต่ำ /<br />
                  ปานกลาง / สูง
                </p>
              </div>
              <div className="rounded-2xl bg-white/15 p-4 ring-1 ring-white/20">
                <p className="text-[11px] font-medium text-sky-100">คำเตือน</p>
                <p className="mt-1 text-xs leading-relaxed text-white">
                  ผลลัพธ์นี้ไม่ใช้แทนการวินิจฉัยของแพทย์
                  และควรได้รับการตรวจยืนยันจากผู้เชี่ยวชาญ
                </p>
              </div>
            </div>
          </motion.div>
        </section>

        {/* ── Workflow ───────────────────────────────────────────────── */}
        <section className="mt-16" aria-labelledby="workflow-heading">
          <p className="text-xs font-bold tracking-[0.2em] text-brand-600 dark:text-brand-400">
            WORKFLOW
          </p>
          <h2
            id="workflow-heading"
            className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100"
          >
            ขั้นตอนใช้งานง่ายและปลอดภัย
          </h2>

          <div className="mt-7 grid gap-5 md:grid-cols-3">
            {WORKFLOW.map(({ icon: Icon, step, title, body }, index) => (
              <motion.article
                key={step}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.3, delay: index * 0.07 }}
                className="rounded-2xl border border-white/60 bg-white/70 p-6 shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/70"
              >
                <span
                  className="flex size-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-md shadow-brand-600/25"
                  aria-hidden="true"
                >
                  <Icon className="size-5" />
                </span>
                <p className="mt-5 text-xs font-bold tracking-widest text-slate-400 dark:text-slate-500">
                  {step}
                </p>
                <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {body}
                </p>
              </motion.article>
            ))}
          </div>
        </section>

        {/* ── Highlights ─────────────────────────────────────────────── */}
        <section className="mt-16" aria-labelledby="highlights-heading">
          <p className="text-xs font-bold tracking-[0.2em] text-brand-600 dark:text-brand-400">
            HIGHLIGHTS
          </p>
          <h2
            id="highlights-heading"
            className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100"
          >
            จุดเด่นของระบบที่ออกแบบมาเพื่อการศึกษาและงานวิจัย
          </h2>

          <div className="mt-7 grid gap-5 md:grid-cols-2">
            {HIGHLIGHTS.map(({ icon: Icon, title, body }, index) => (
              <motion.article
                key={title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.3, delay: index * 0.06 }}
                className="rounded-2xl border border-white/60 bg-white/70 p-6 shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/70"
              >
                <span
                  className="flex size-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-md shadow-brand-600/25"
                  aria-hidden="true"
                >
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {body}
                </p>
              </motion.article>
            ))}
          </div>
        </section>

        {/* ── Developers ─────────────────────────────────────────────── */}
        <section
          id="developers"
          // Clears the sticky header, so the heading is not hidden under it
          // when the nav link jumps here.
          className="mt-16 scroll-mt-24"
          aria-labelledby="developers-heading"
        >
          <p className="text-xs font-bold tracking-[0.2em] text-brand-600 dark:text-brand-400">
            DEVELOPERS
          </p>
          <h2
            id="developers-heading"
            className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100"
          >
            ผู้พัฒนา
          </h2>

          <ul className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {DEVELOPERS.map((name, index) => (
              <motion.li
                key={name}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.3, delay: index * 0.06 }}
                className="flex items-center gap-4 rounded-2xl border border-white/60 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/70"
              >
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-md shadow-brand-600/25"
                  aria-hidden="true"
                >
                  <UserRound className="size-5" />
                </span>
                <span className="min-w-0 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {name}
                </span>
              </motion.li>
            ))}
          </ul>

          <div className="mt-5 rounded-2xl border border-white/60 bg-white/70 p-6 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
            <dl className="grid gap-4 sm:grid-cols-3">
              {[
                { icon: GraduationCap, label: "ระดับชั้น", value: "มัธยมศึกษาปีที่ 1–3" },
                { icon: School, label: "โรงเรียน", value: "ยุพราชวิทยาลัยเชียงใหม่" },
                {
                  icon: Landmark,
                  label: "สังกัด",
                  value:
                    "สำนักงานเขตพื้นที่การศึกษามัธยมศึกษาเชียงใหม่ (สพม.เชียงใหม่)",
                },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex gap-3">
                  <Icon
                    className="mt-0.5 size-4 shrink-0 text-brand-600 dark:text-brand-400"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <dt className="text-[11px] text-slate-500 dark:text-slate-400">
                      {label}
                    </dt>
                    <dd className="mt-0.5 text-sm font-medium leading-relaxed text-slate-900 dark:text-slate-100">
                      {value}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Closing call to action ─────────────────────────────────── */}
        <section className="mt-14 rounded-3xl border border-white/60 bg-white/70 p-7 shadow-sm backdrop-blur sm:p-9 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="grid items-center gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <h2 className="text-xl font-bold text-slate-900 sm:text-2xl dark:text-slate-100">
                พร้อมสำหรับการใช้งานและต่อยอด
              </h2>
              <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                โปรเจกต์นี้ออกแบบให้เป็นฐานสำหรับงานวิจัย
                สลับอัลกอริทึมจาก RandomForest ไปเป็นโมเดลลำดับเวลาได้โดยไม่ต้องแก้ส่วนอื่น
                และเก็บค่าที่วัดได้ทุกเฟรมไว้ตรวจสอบย้อนกลับ
              </p>
              <Link
                href="/assessment/"
                className={cn(
                  "mt-6 inline-flex items-center gap-2 rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/25",
                  "transition-all hover:bg-brand-700 active:scale-[0.98]",
                  FOCUS_RING,
                )}
              >
                <ScanLine className="size-4" aria-hidden="true" />
                เริ่มประเมิน
              </Link>
            </div>

            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <span className="font-bold">Medical disclaimer:</span>{" "}
              เครื่องมือนี้ไม่ใช่เครื่องมือแพทย์ ไม่ใช้แทนการวินิจฉัย
              และต้องได้รับการยืนยันจากผู้เชี่ยวชาญ
            </p>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="bg-gradient-to-r from-brand-700 via-brand-600 to-sky-500">
        <p className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-4 text-center text-xs font-medium text-white sm:px-6">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          Research use only · Not for diagnosis · Consult a medical professional
        </p>
      </footer>
    </div>
  );
}
