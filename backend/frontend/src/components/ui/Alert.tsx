import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

export type AlertTone = "success" | "error" | "warning" | "info";

const TONES: Record<
  AlertTone,
  { wrap: string; icon: React.ComponentType<{ className?: string }> }
> = {
  success: {
    wrap: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
    icon: CheckCircle2,
  },
  error: {
    wrap: "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200",
    icon: AlertCircle,
  },
  warning: {
    wrap: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
    icon: TriangleAlert,
  },
  info: {
    wrap: "border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200",
    icon: Info,
  },
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  title?: string;
}

/** Inline message block. Errors get `role="alert"` so they are announced. */
export function Alert({
  className,
  tone = "info",
  title,
  children,
  ...props
}: AlertProps) {
  const { wrap, icon: Icon } = TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border p-3.5 text-sm", wrap, className)}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="mb-0.5 font-semibold">{title}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
