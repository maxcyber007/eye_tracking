import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  /** Primary call to action; omit for a purely informational empty state. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Shown wherever a list has no rows.
 *
 * An empty state always explains *why* it is empty and offers the next step,
 * so a first-run user is never left staring at a blank panel.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-14 text-center",
        className,
      )}
    >
      <div
        className="mb-4 flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
        aria-hidden="true"
      >
        {icon}
      </div>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
