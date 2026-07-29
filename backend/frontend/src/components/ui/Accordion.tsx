"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";

export interface AccordionSectionProps {
  title: string;
  /** Short line shown under the title while collapsed. */
  summary?: string;
  icon?: LucideIcon;
  /** Start expanded; use for the section the user must fill in first. */
  defaultOpen?: boolean;
  /** Right-aligned status chip, e.g. "จำเป็น" or "กรอกแล้ว". */
  status?: { label: string; tone: "neutral" | "brand" | "success" | "warning" | "danger" };
  children: React.ReactNode;
  className?: string;
}

/**
 * Collapsible form section.
 *
 * Clinical intake forms are long, so grouping fields into labelled sections
 * that open one at a time keeps the required fields visible without hiding the
 * overall structure — the section headers stay on screen and act as a
 * checklist of what the form covers.
 *
 * The trigger is a real `<button>` wired with `aria-expanded` and
 * `aria-controls`, so the section is operable and announced correctly by
 * keyboard and screen reader.
 */
export function AccordionSection({
  title,
  summary,
  icon: Icon,
  defaultOpen = false,
  status,
  children,
  className,
}: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const buttonId = `${panelId}-trigger`;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-card border border-slate-200 bg-white",
        "dark:border-slate-800 dark:bg-slate-900",
        className,
      )}
    >
      <h3>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
            "hover:bg-slate-50 dark:hover:bg-slate-800/60",
          )}
        >
          {Icon && (
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
              aria-hidden="true"
            >
              <Icon className="size-4.5" />
            </span>
          )}

          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </span>
            {summary && (
              <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                {summary}
              </span>
            )}
          </span>

          {status && (
            <Badge tone={status.tone} className="shrink-0">
              {status.label}
            </Badge>
          )}

          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-slate-400 transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </h3>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            role="region"
            aria-labelledby={buttonId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-slate-100 px-4 py-4 dark:border-slate-800">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Vertical stack of accordion sections with consistent spacing. */
export function Accordion({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("space-y-3", className)}>{children}</div>;
}
