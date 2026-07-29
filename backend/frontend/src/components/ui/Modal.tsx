"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

/**
 * Accessible dialog with a backdrop and a small entrance animation.
 *
 * Escape closes it, focus moves into the panel on open and returns to the
 * trigger on close, and body scroll is locked while it is open — the three
 * things a hand-rolled modal usually gets wrong.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;

    triggerRef.current = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 40);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      window.clearTimeout(focusTimer);
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "relative w-full rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl",
              "dark:bg-slate-900 dark:ring-1 dark:ring-slate-800",
              SIZES[size],
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-800">
              <div className="min-w-0">
                <h2
                  id="modal-title"
                  className="text-base font-semibold text-slate-900 dark:text-slate-100"
                >
                  {title}
                </h2>
                {description && (
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {description}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="ปิดหน้าต่าง"
                className="-mr-2 -mt-1 shrink-0 px-2"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>

            {children && (
              <div className="max-h-[60vh] overflow-y-auto p-5 text-sm text-slate-600 dark:text-slate-300">
                {children}
              </div>
            )}

            {footer && (
              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 p-5 sm:flex-row sm:justify-end dark:border-slate-800">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation for destructive actions.
 *
 * Replaces `window.confirm`, which cannot be styled, cannot show a pending
 * state, and reads poorly on mobile.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "ยืนยัน",
  tone = "danger",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            ยกเลิก
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="whitespace-pre-line leading-relaxed">{description}</p>
    </Modal>
  );
}
