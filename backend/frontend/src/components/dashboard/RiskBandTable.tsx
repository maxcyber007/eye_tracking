"use client";

import { cn } from "@/lib/cn";
import { RISK_ADVICE, RISK_BAND_PROVENANCE, RISK_LABELS } from "@/lib/constants";
import { riskTextClass } from "@/lib/format";
import type { RiskBand, RiskLevel } from "@/lib/types";

export interface RiskBandTableProps {
  /** Bands as reported by the backend, in ascending order. */
  bands: RiskBand[];
  /** Band the current result fell into; highlighted in the table. */
  current?: RiskLevel;
  className?: string;
}

/** Render one band's score range as "< 0.34", "0.34 – 0.67" or "≥ 0.67". */
function formatRange(band: RiskBand): string {
  const low = band.lower;
  const high = band.upper;
  if (low === null && high !== null) return `< ${high.toFixed(2)}`;
  if (low !== null && high === null) return `≥ ${low.toFixed(2)}`;
  if (low !== null && high !== null) return `${low.toFixed(2)} – ${high.toFixed(2)}`;
  return "—";
}

/**
 * The score-to-level table that sits beside a result.
 *
 * The bounds are taken from the response that produced the score rather than
 * from a constant in this file: they are configurable on the server, and a
 * table carrying its own copy would disagree with the number next to it the
 * moment someone changed the setting.
 *
 * The provenance note underneath is not decoration. Without it a reader
 * reasonably assumes a table this specific came from somewhere clinical.
 */
export function RiskBandTable({ bands, current, className }: RiskBandTableProps) {
  if (bands.length === 0) return null;

  return (
    <div className={className}>
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <caption className="sr-only">
            เกณฑ์การแบ่งระดับความเสี่ยงจากคะแนนของโมเดล
          </caption>
          <thead>
            <tr className="bg-slate-50 text-left dark:bg-slate-800/50">
              <th scope="col" className="px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                คะแนน
              </th>
              <th scope="col" className="px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                ระดับการประเมิน
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {bands.map((band) => {
              const level = band.level as RiskLevel;
              const active = current === level;
              return (
                <tr
                  key={band.level}
                  // aria-current marks the row for a screen reader; the ring and
                  // weight carry it visually, so it is never colour alone.
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    active && "bg-brand-50/70 dark:bg-brand-500/10",
                  )}
                >
                  <td
                    className={cn(
                      "px-4 py-2.5 tabular-nums",
                      active
                        ? "font-semibold text-slate-900 dark:text-slate-100"
                        : "text-slate-600 dark:text-slate-400",
                    )}
                  >
                    {formatRange(band)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        active ? "font-semibold" : "font-medium",
                        riskTextClass(level),
                      )}
                    >
                      {RISK_LABELS[level] ?? band.level}
                      {RISK_ADVICE[level] ? ` (${RISK_ADVICE[level]})` : ""}
                    </span>
                    {active && (
                      <span className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">
                        ← ผลของคุณ
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        <span className="font-semibold">* อ้างอิงเกณฑ์: </span>
        {RISK_BAND_PROVENANCE}
      </p>
    </div>
  );
}
