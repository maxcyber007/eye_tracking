import { cn } from "@/lib/cn";

export interface AvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "size-7 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-12 text-sm",
};

/**
 * Initials avatar.
 *
 * Deliberately not an image: the app has no avatar uploads, and generated
 * initials avoid an extra request and a broken-image state.
 */
export function Avatar({ name, size = "md", className }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300",
        SIZES[size],
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}
