import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function Spinner({
  className,
  label = "กำลังโหลด",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn("size-5 animate-spin text-brand-600", className)}
    />
  );
}

/**
 * Placeholder block shown while data loads.
 *
 * Skeletons mirror the shape of the real content so the layout does not jump
 * when data arrives.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-slate-200 dark:bg-slate-800",
        className,
      )}
      {...props}
    />
  );
}

/** Skeleton shaped like a statistic card. */
export function StatCardSkeleton() {
  return (
    <div className="rounded-card border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
        </div>
        <Skeleton className="size-10 rounded-lg" />
      </div>
    </div>
  );
}

/** Skeleton shaped like a table body. */
export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn("h-4 flex-1", columnIndex === 0 && "max-w-12")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Full-page loader used by route-level suspense boundaries. */
export function PageLoading({ message = "กำลังโหลด…" }: { message?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <Spinner className="size-8" />
      <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
    </div>
  );
}
