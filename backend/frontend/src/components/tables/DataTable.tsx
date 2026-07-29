"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/Input";
import { TableSkeleton } from "@/components/ui/Loading";

export interface Column<T> {
  key: string;
  header: string;
  /** Render the cell; defaults to the raw value at `key`. */
  render?: (row: T) => React.ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  /** Hide below the `sm` breakpoint to keep phone layouts readable. */
  hideOnMobile?: boolean;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  /** Rendered in place of the table body when there are no rows. */
  empty?: React.ReactNode;
  /** Enable the client-side search box over `searchFields`. */
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFields?: (row: T) => string;
  /** Rendered below the body, typically a `<Pagination>`. */
  footer?: React.ReactNode;
  toolbar?: React.ReactNode;
}

type SortState = { key: string; direction: "asc" | "desc" } | null;

/**
 * Table with sticky header, zebra striping, hover, sort and search.
 *
 * Sorting and searching are client-side and therefore scoped to the rows the
 * caller passed in. With server-side paging that means the current page only —
 * which is why the report page also exposes a server-side participant filter
 * for queries that must span every page.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  searchable = false,
  searchPlaceholder = "ค้นหา…",
  searchFields,
  footer,
  toolbar,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);

  const visibleRows = useMemo(() => {
    let result = rows;

    if (query && searchFields) {
      const needle = query.trim().toLowerCase();
      result = result.filter((row) => searchFields(row).toLowerCase().includes(needle));
    }

    if (sort) {
      const column = columns.find((item) => item.key === sort.key);
      if (column?.sortValue) {
        const factor = sort.direction === "asc" ? 1 : -1;
        result = [...result].sort((left, right) => {
          const a = column.sortValue!(left);
          const b = column.sortValue!(right);
          if (typeof a === "number" && typeof b === "number") return (a - b) * factor;
          return String(a).localeCompare(String(b), "th") * factor;
        });
      }
    }

    return result;
  }, [rows, query, searchFields, sort, columns]);

  const toggleSort = (key: string) => {
    setSort((current) =>
      current?.key === key
        ? current.direction === "asc"
          ? { key, direction: "desc" }
          : null
        : { key, direction: "asc" },
    );
  };

  return (
    <div className="overflow-hidden rounded-card border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {(searchable || toolbar) && (
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          {searchable && (
            <div className="w-full sm:max-w-xs">
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                icon={<Search className="size-4" aria-hidden="true" />}
              />
            </div>
          )}
          {toolbar && <div className="flex shrink-0 gap-2">{toolbar}</div>}
        </div>
      )}

      {loading ? (
        <TableSkeleton columns={columns.length} />
      ) : visibleRows.length === 0 ? (
        (empty ?? (
          <p className="px-6 py-14 text-center text-sm text-slate-500 dark:text-slate-400">
            ไม่มีข้อมูล
          </p>
        ))
      ) : (
        <div className="scrollbar-thin max-h-[32rem] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/90 dark:backdrop-blur">
              <tr>
                {columns.map((column) => {
                  const sortable = Boolean(column.sortValue);
                  const active = sort?.key === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={
                        active
                          ? sort!.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : sortable
                            ? "none"
                            : undefined
                      }
                      className={cn(
                        "whitespace-nowrap border-b border-slate-200 px-4 py-3 text-xs font-semibold text-slate-500",
                        "dark:border-slate-700 dark:text-slate-400",
                        column.align === "right" && "text-right",
                        column.align === "center" && "text-center",
                        !column.align && "text-left",
                        column.hideOnMobile && "hidden sm:table-cell",
                        column.className,
                      )}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column.key)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded transition-colors hover:text-slate-800 dark:hover:text-slate-200",
                            active && "text-brand-600 dark:text-brand-400",
                          )}
                        >
                          {column.header}
                          {active ? (
                            sort!.direction === "asc" ? (
                              <ArrowUp className="size-3" aria-hidden="true" />
                            ) : (
                              <ArrowDown className="size-3" aria-hidden="true" />
                            )
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        column.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={cn(
                    "border-b border-slate-100 transition-colors last:border-0",
                    "odd:bg-white even:bg-slate-50/60",
                    "hover:bg-brand-50/60",
                    "dark:border-slate-800 dark:odd:bg-slate-900 dark:even:bg-slate-800/30 dark:hover:bg-slate-800/60",
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-4 py-3 text-slate-700 dark:text-slate-300",
                        column.align === "right" && "text-right tabular-nums",
                        column.align === "center" && "text-center",
                        column.hideOnMobile && "hidden sm:table-cell",
                      )}
                    >
                      {column.render
                        ? column.render(row)
                        : String((row as Record<string, unknown>)[column.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {footer}
    </div>
  );
}
