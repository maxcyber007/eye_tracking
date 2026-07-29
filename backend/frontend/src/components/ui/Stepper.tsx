"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Step {
  id: string;
  label: string;
  /** Shown under the label on wide screens only. */
  description?: string;
}

export interface StepperProps {
  steps: Step[];
  /** Zero-based index of the step currently in progress. */
  current: number;
  className?: string;
}

/**
 * Horizontal progress indicator for a multi-step intake.
 *
 * Clinical workflows are sequential and a participant needs to know how much is
 * left before the camera turns on. Completed steps get a check mark rather than
 * only a colour change, so the state does not rely on colour perception, and
 * the whole strip is exposed as an ordered list with `aria-current`.
 */
export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <nav aria-label="ขั้นตอนการประเมิน" className={className}>
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          const last = index === steps.length - 1;

          return (
            <li
              key={step.id}
              className={cn("flex items-center", !last && "flex-1")}
              aria-current={active ? "step" : undefined}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                    done && "bg-emerald-500 text-white",
                    active &&
                      "bg-brand-600 text-white ring-4 ring-brand-100 dark:ring-brand-500/20",
                    !done &&
                      !active &&
                      "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
                  )}
                >
                  {done ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>

                <span className="hidden min-w-0 sm:block">
                  <span
                    className={cn(
                      "block whitespace-nowrap text-xs font-medium",
                      active
                        ? "text-slate-900 dark:text-slate-100"
                        : "text-slate-500 dark:text-slate-400",
                    )}
                  >
                    {step.label}
                  </span>
                  {step.description && (
                    <span className="hidden whitespace-nowrap text-[11px] text-slate-400 lg:block dark:text-slate-500">
                      {step.description}
                    </span>
                  )}
                </span>
              </div>

              {!last && (
                <span
                  className={cn(
                    "mx-3 h-0.5 flex-1 rounded-full transition-colors",
                    done ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-800",
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Compact label for the current step, since the strip hides labels on phones. */}
      <p className="mt-2 text-xs font-medium text-slate-600 sm:hidden dark:text-slate-300">
        ขั้นที่ {current + 1} จาก {steps.length} · {steps[current]?.label}
      </p>
    </nav>
  );
}
