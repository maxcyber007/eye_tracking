"use client";

import { motion } from "framer-motion";
import { RISK_LABELS } from "@/lib/constants";
import { riskHex, riskTextClass } from "@/lib/format";
import type { RiskLevel } from "@/lib/types";
import { cn } from "@/lib/cn";

export interface RiskGaugeProps {
  score: number;
  level: RiskLevel;
  className?: string;
}

/** Length of the semicircular arc in user units, used for the dash offset. */
const ARC_LENGTH = 270;

/**
 * Semicircular gauge for the risk score.
 *
 * The arc is drawn with `stroke-dashoffset` so it can animate from empty to the
 * final value; the numeric score is also rendered as text so the value is not
 * conveyed by shape and colour alone.
 */
export function RiskGauge({ score, level, className }: RiskGaugeProps) {
  const clamped = Math.max(0, Math.min(1, score));

  return (
    <div className={cn("relative mx-auto w-full max-w-xs", className)}>
      <svg viewBox="0 0 200 116" className="w-full" role="img"
           aria-label={`คะแนนความเสี่ยง ${clamped.toFixed(3)} ระดับ ${RISK_LABELS[level]}`}>
        <path
          d="M14 106 A 86 86 0 0 1 186 106"
          fill="none"
          strokeWidth={15}
          strokeLinecap="round"
          className="stroke-slate-200 dark:stroke-slate-800"
        />
        <motion.path
          d="M14 106 A 86 86 0 0 1 186 106"
          fill="none"
          strokeWidth={15}
          strokeLinecap="round"
          stroke={riskHex(level)}
          strokeDasharray={ARC_LENGTH}
          initial={{ strokeDashoffset: ARC_LENGTH }}
          animate={{ strokeDashoffset: ARC_LENGTH - clamped * ARC_LENGTH }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>

      <div className="absolute inset-x-0 bottom-1 text-center">
        <p className={cn("text-4xl font-bold tabular-nums", riskTextClass(level))}>
          {clamped.toFixed(3)}
        </p>
        <p className={cn("mt-1 text-sm font-semibold", riskTextClass(level))}>
          {RISK_LABELS[level] ?? level}
        </p>
      </div>
    </div>
  );
}
