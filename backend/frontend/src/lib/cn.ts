import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names, letting later Tailwind utilities win.
 *
 * `clsx` resolves the conditionals; `tailwind-merge` then drops earlier
 * utilities from the same group, so a caller can always override a component's
 * default padding or colour by passing `className`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
