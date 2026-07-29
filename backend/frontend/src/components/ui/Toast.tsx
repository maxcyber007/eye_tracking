"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AlertTone } from "@/components/ui/Alert";

interface Toast {
  id: number;
  tone: AlertTone;
  message: string;
}

interface ToastContextValue {
  /** Show a transient notification. */
  notify: (tone: AlertTone, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info,
} as const;

const TONES: Record<AlertTone, string> = {
  success:
    "border-emerald-200 bg-white text-emerald-800 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-emerald-200",
  error:
    "border-red-200 bg-white text-red-800 dark:border-red-500/30 dark:bg-slate-900 dark:text-red-200",
  warning:
    "border-amber-200 bg-white text-amber-900 dark:border-amber-500/30 dark:bg-slate-900 dark:text-amber-200",
  info: "border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
};

/**
 * Toast host.
 *
 * Errors stay on screen twice as long as successes: a failure needs reading,
 * a confirmation only needs noticing.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (tone: AlertTone, message: string) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, tone, message }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 8000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:top-0 sm:items-end"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = ICONS[toast.tone];
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3.5 shadow-lg",
                  TONES[toast.tone],
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-sm leading-relaxed">{toast.message}</p>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  aria-label="ปิดการแจ้งเตือน"
                  className="shrink-0 rounded text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/** Access the toast API. Falls back to a no-op outside the provider. */
export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? { notify: () => undefined };
}
