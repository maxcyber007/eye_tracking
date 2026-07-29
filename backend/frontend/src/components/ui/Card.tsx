import { cn } from "@/lib/cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Lift the card slightly on hover; use for clickable cards only. */
  interactive?: boolean;
  padded?: boolean;
}

/** Surface container used for every panel in the app. */
export function Card({
  className,
  interactive = false,
  padded = true,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-card border border-slate-200 bg-white shadow-sm",
        "dark:border-slate-800 dark:bg-slate-900",
        padded && "p-5",
        interactive &&
          "transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:hover:border-slate-700",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-sm font-semibold text-slate-900 dark:text-slate-100",
        className,
      )}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-slate-500 dark:text-slate-400", className)}
      {...props}
    >
      {children}
    </p>
  );
}
