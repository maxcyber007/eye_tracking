import type { RiskLevel } from "@/lib/types";

/**
 * Format an ISO timestamp for Thai readers.
 *
 * @param iso ISO-8601 timestamp.
 * @param withTime Include the time of day.
 */
export function formatDateTime(iso: string, withTime = true): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || "—";
  return date.toLocaleString("th-TH", {
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  });
}

/** Format a 0–1 ratio as a whole percentage. */
export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Format a number with a fixed number of decimals, tolerating null. */
export function formatNumber(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

/** Format a byte count as MB. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** Tailwind text colour for a risk band. */
export function riskTextClass(level: RiskLevel | string): string {
  return (
    {
      Low: "text-emerald-600 dark:text-emerald-400",
      Moderate: "text-amber-600 dark:text-amber-400",
      High: "text-red-600 dark:text-red-400",
    }[level] || "text-slate-500"
  );
}

/** Hex colour for a risk band, for SVG and chart fills. */
export function riskHex(level: RiskLevel | string): string {
  return { Low: "#10b981", Moderate: "#f59e0b", High: "#ef4444" }[level] || "#94a3b8";
}

/**
 * Build a CSV document from records.
 *
 * A UTF-8 BOM is prepended so Excel on Windows renders Thai correctly instead
 * of mojibake, which is the usual complaint with plain UTF-8 CSV.
 */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: (keyof T)[],
): Blob {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const body = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(",")),
  ].join("\r\n");
  return new Blob(["﻿" + body], { type: "text/csv;charset=utf-8;" });
}

/** Trigger a browser download for a blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
