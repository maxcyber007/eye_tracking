"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface PaginationProps {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}

/** Offset-based pager matching the API's `limit`/`offset` contract. */
export function Pagination({ offset, limit, total, onChange }: PaginationProps) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const canPrevious = offset > 0;
  const canNext = offset + limit < total;

  return (
    <nav
      aria-label="แบ่งหน้า"
      className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800"
    >
      <p className="text-xs text-slate-500 dark:text-slate-400">
        แสดง <span className="font-medium text-slate-700 dark:text-slate-200">{from}–{to}</span>{" "}
        จาก <span className="font-medium text-slate-700 dark:text-slate-200">{total}</span>
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canPrevious}
          onClick={() => onChange(Math.max(0, offset - limit))}
          icon={<ChevronLeft className="size-3.5" aria-hidden="true" />}
        >
          ก่อนหน้า
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canNext}
          onClick={() => onChange(offset + limit)}
        >
          ถัดไป
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
