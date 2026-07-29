"use client";

import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  /** Directional change; omit when there is nothing to compare against. */
  trend?: { direction: "up" | "down" | "flat"; label: string };
  tone?: "brand" | "success" | "warning" | "danger";
  hint?: string;
  /** Stagger index for the entrance animation. */
  index?: number;
}

const TONES = {
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400",
  success:
    "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  warning: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  danger: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
};

const TREND_STYLES = {
  up: { icon: ArrowUpRight, className: "text-emerald-600 dark:text-emerald-400" },
  down: { icon: ArrowDownRight, className: "text-red-600 dark:text-red-400" },
  flat: { icon: Minus, className: "text-slate-500 dark:text-slate-400" },
} as const;

/**
 * Headline metric tile.
 *
 * A trend arrow is only meaningful when the number is comparable over time, so
 * `trend` is optional rather than a fabricated placeholder.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  tone = "brand",
  hint,
  index = 0,
}: StatCardProps) {
  const trendStyle = trend ? TREND_STYLES[trend.direction] : null;
  const TrendIcon = trendStyle?.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group rounded-card border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
        "dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
            {value}
          </p>
        </div>
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105",
            TONES[tone],
          )}
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </span>
      </div>

      {(trend || hint) && (
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          {trend && TrendIcon && (
            <span className={cn("inline-flex items-center gap-0.5 font-medium", trendStyle!.className)}>
              <TrendIcon className="size-3.5" aria-hidden="true" />
              {trend.label}
            </span>
          )}
          {hint && <span className="truncate text-slate-500 dark:text-slate-400">{hint}</span>}
        </div>
      )}
    </motion.div>
  );
}
