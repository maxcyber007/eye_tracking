"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ClipboardList, Download, Filter, Trash2, X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageLoading } from "@/components/ui/Loading";
import { ConfirmDialog } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { RiskDistributionChart, RiskTrendChart } from "@/components/dashboard/Charts";
import { history } from "@/lib/api";
import { MAX_AGE, MIN_AGE, PAGE_SIZE, RISK_LABELS } from "@/lib/constants";
import { downloadBlob, formatDateTime, toCsv } from "@/lib/format";
import type { HistoryItem, HistoryListResponse, RiskLevel } from "@/lib/types";

const RISK_TONE: Record<RiskLevel, "success" | "warning" | "danger"> = {
  Low: "success",
  Moderate: "warning",
  High: "danger",
};

/** Filter actually in effect, as opposed to what is currently typed in the toolbar. */
interface AppliedFilter {
  subject: string;
  ageMin?: number;
  ageMax?: number;
}

/** Parse an age box, treating anything out of range or non-numeric as "unset". */
function parseAge(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_AGE || value > MAX_AGE) return undefined;
  return value;
}

/** Human summary of a filter, for the empty state and the clear-confirmation. */
function describeFilter(filter: AppliedFilter): string {
  const parts: string[] = [];
  if (filter.subject) parts.push(`รหัส "${filter.subject}"`);
  if (filter.ageMin !== undefined && filter.ageMax !== undefined) {
    parts.push(`อายุ ${filter.ageMin}–${filter.ageMax} ปี`);
  } else if (filter.ageMin !== undefined) {
    parts.push(`อายุ ${filter.ageMin} ปีขึ้นไป`);
  } else if (filter.ageMax !== undefined) {
    parts.push(`อายุไม่เกิน ${filter.ageMax} ปี`);
  }
  return parts.join(" · ");
}

function HistoryReport() {
  const searchParams = useSearchParams();
  const { notify } = useToast();

  const [subject, setSubject] = useState(searchParams.get("subject") ?? "");
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  // Draft values are edited freely; only "กรอง" promotes them to the query, so
  // typing a bound does not fire a request per keystroke.
  const [applied, setApplied] = useState<AppliedFilter>({
    subject: searchParams.get("subject") ?? "",
  });
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<HistoryListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<HistoryItem | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(
        await history.list({
          limit: PAGE_SIZE,
          offset,
          subjectId: applied.subject || undefined,
          ageMin: applied.ageMin,
          ageMax: applied.ageMax,
        }),
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [offset, applied]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;

  const summary = useMemo(() => {
    const counts: Record<RiskLevel, number> = { Low: 0, Moderate: 0, High: 0 };
    rows.forEach((row) => {
      if (counts[row.risk_level] !== undefined) counts[row.risk_level] += 1;
    });
    const subjects = new Set(rows.map((row) => row.subject_id).filter(Boolean)).size;
    return { counts, subjects };
  }, [rows]);

  const draftMin = parseAge(ageMin);
  const draftMax = parseAge(ageMax);
  const rangeInverted =
    draftMin !== undefined && draftMax !== undefined && draftMin > draftMax;
  const filterActive =
    Boolean(applied.subject) || applied.ageMin !== undefined || applied.ageMax !== undefined;
  const filterLabel = describeFilter(applied);

  const applyFilter = () => {
    if (rangeInverted) return;
    setApplied({ subject: subject.trim(), ageMin: draftMin, ageMax: draftMax });
    setOffset(0);
  };

  const clearFilter = () => {
    setSubject("");
    setAgeMin("");
    setAgeMax("");
    setApplied({ subject: "" });
    setOffset(0);
  };

  const removeRow = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const result = await history.remove(pendingDelete.id);
      notify("success", result.message);
      setPendingDelete(null);
      await load();
    } catch (caught) {
      notify("error", (caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      // Same criteria the table is showing, so "ล้างข้อมูล" removes exactly the
      // rows in front of the user and never more.
      const result = await history.clear({
        subjectId: applied.subject || undefined,
        ageMin: applied.ageMin,
        ageMax: applied.ageMax,
      });
      notify("success", result.message);
      setClearOpen(false);
      setOffset(0);
      await load();
    } catch (caught) {
      notify("error", (caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Pull every matching page so the CSV covers the whole filter, not just
   *  the page on screen. */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: HistoryItem[] = [];
      for (let page = 0; ; page += 1) {
        const chunk = await history.list({
          limit: 500,
          offset: page * 500,
          subjectId: applied.subject || undefined,
          ageMin: applied.ageMin,
          ageMax: applied.ageMax,
        });
        all.push(...chunk.items);
        if (chunk.items.length < 500 || all.length >= chunk.total) break;
      }
      downloadBlob(
        toCsv(all as unknown as Record<string, unknown>[], [
          "id",
          "created_at",
          "subject_id",
          "age",
          "filename",
          "risk_score",
          "risk_level",
          "confidence",
          "model_type",
        ]),
        `myeye_history_${new Date().toISOString().slice(0, 10)}.csv`,
      );
      notify("success", `ดาวน์โหลด ${all.length} รายการแล้ว`);
    } catch (caught) {
      notify("error", (caught as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<HistoryItem>[] = [
    {
      key: "id",
      header: "#",
      sortValue: (row) => row.id,
      className: "w-16",
      render: (row) => (
        <span className="tabular-nums text-slate-400">{row.id}</span>
      ),
    },
    {
      key: "created_at",
      header: "วันที่",
      sortValue: (row) => row.created_at,
      render: (row) => (
        <span className="whitespace-nowrap">{formatDateTime(row.created_at)}</span>
      ),
    },
    {
      key: "subject_id",
      header: "ผู้เข้าร่วม",
      sortValue: (row) => row.subject_id ?? "",
      render: (row) => (
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {row.subject_id || "—"}
        </span>
      ),
    },
    {
      key: "age",
      header: "อายุ",
      align: "right",
      // Unknown ages sort last rather than as 0, so a column sort never claims
      // an assessment from before the field existed was of a newborn.
      sortValue: (row) => row.age ?? Number.POSITIVE_INFINITY,
      render: (row) =>
        row.age === null || row.age === undefined ? (
          <span className="text-slate-400" title="บันทึกไว้ก่อนมีช่องอายุ">
            —
          </span>
        ) : (
          <span className="tabular-nums">{row.age}</span>
        ),
    },
    {
      key: "risk_score",
      header: "คะแนน",
      align: "right",
      sortValue: (row) => row.risk_score,
      render: (row) => row.risk_score.toFixed(3),
    },
    {
      key: "risk_level",
      header: "ระดับ",
      sortValue: (row) => row.risk_score,
      render: (row) => (
        <Badge tone={RISK_TONE[row.risk_level] ?? "neutral"} dot>
          {RISK_LABELS[row.risk_level] ?? row.risk_level}
        </Badge>
      ),
    },
    {
      key: "confidence",
      header: "ความมั่นใจ",
      align: "right",
      hideOnMobile: true,
      sortValue: (row) => row.confidence,
      render: (row) => row.confidence.toFixed(3),
    },
    {
      key: "actions",
      header: "",
      align: "center",
      className: "w-14",
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`ลบรายการที่ ${row.id}`}
          onClick={() => setPendingDelete(row)}
          className="px-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            รายงานประวัติผู้ประเมิน
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            ผลประเมินทั้งหมดที่บันทึกไว้ในระบบ
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            loading={exporting}
            onClick={exportCsv}
            icon={<Download className="size-3.5" aria-hidden="true" />}
          >
            ดาวน์โหลด CSV
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setClearOpen(true)}
            icon={<Trash2 className="size-3.5" aria-hidden="true" />}
          >
            {/* Acts on the filter, so it must not promise "ทั้งหมด" while only
                part of the log is in scope. */}
            {filterActive ? "ล้างตามตัวกรอง" : "ล้างข้อมูลทั้งหมด"}
          </Button>
        </div>
      </div>

      {error && (
        <Alert tone="error" title="โหลดรายงานไม่สำเร็จ">
          {error}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>การกระจายระดับความเสี่ยง</CardTitle>
            <Badge tone="neutral">หน้านี้</Badge>
          </CardHeader>
          <RiskDistributionChart items={rows} />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>แนวโน้มคะแนน</CardTitle>
            <Badge tone="neutral">เรียงจากเก่าไปใหม่</Badge>
          </CardHeader>
          <RiskTrendChart items={rows} />
        </Card>
      </div>

      <section
        aria-label="สรุปหน้านี้"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {[
          ["ทั้งหมด (ทุกหน้า)", total, "text-slate-900 dark:text-slate-100"],
          ["ผู้เข้าร่วมในหน้านี้", summary.subjects, "text-slate-900 dark:text-slate-100"],
          ["ความเสี่ยงต่ำ", summary.counts.Low, "text-emerald-600 dark:text-emerald-400"],
          ["ปานกลาง/สูง", summary.counts.Moderate + summary.counts.High, "text-amber-600 dark:text-amber-400"],
        ].map(([label, value, tone]) => (
          <Card key={label as string} padded={false} className="p-4">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
            <p className={`text-xl font-bold tabular-nums ${tone}`}>{value}</p>
          </Card>
        ))}
      </section>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        searchable
        searchPlaceholder="ค้นหาในหน้านี้…"
        searchFields={(row) =>
          `${row.subject_id ?? ""} ${row.filename} ${row.risk_level}`
        }
        toolbar={
          <div className="w-full space-y-2">
            <div className="flex w-full flex-wrap items-end gap-2">
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && applyFilter()}
                placeholder="กรองทุกหน้าด้วยรหัส…"
                aria-label="กรองตามรหัสผู้เข้าร่วมทุกหน้า"
                className="h-10 min-w-40 flex-1"
              />
              <div className="flex items-end gap-1.5">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={MIN_AGE}
                  max={MAX_AGE}
                  value={ageMin}
                  onChange={(event) => setAgeMin(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && applyFilter()}
                  placeholder="อายุต่ำสุด"
                  aria-label="กรองอายุตั้งแต่ (ปี)"
                  className="h-10 w-28"
                />
                <span
                  className="pb-2.5 text-sm text-slate-400 dark:text-slate-500"
                  aria-hidden="true"
                >
                  –
                </span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={MIN_AGE}
                  max={MAX_AGE}
                  value={ageMax}
                  onChange={(event) => setAgeMax(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && applyFilter()}
                  placeholder="อายุสูงสุด"
                  aria-label="กรองอายุถึง (ปี)"
                  className="h-10 w-28"
                />
              </div>
              <Button
                variant="outline"
                disabled={rangeInverted}
                onClick={applyFilter}
                icon={<Filter className="size-3.5" aria-hidden="true" />}
              >
                กรอง
              </Button>
              {filterActive && (
                <Button variant="ghost" onClick={clearFilter} aria-label="ล้างตัวกรอง">
                  <X className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>

            {rangeInverted && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                อายุต่ำสุดต้องไม่มากกว่าอายุสูงสุด
              </p>
            )}
            {filterActive && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                กำลังกรอง: <span className="font-medium">{filterLabel}</span>
                {(applied.ageMin !== undefined || applied.ageMax !== undefined) &&
                  " · ไม่รวมรายการที่ไม่ได้บันทึกอายุไว้"}
                {data?.age_min_available !== null &&
                  data?.age_min_available !== undefined &&
                  ` · ข้อมูลที่มีอยู่ ${data.age_min_available}–${data.age_max_available} ปี`}
              </p>
            )}
          </div>
        }
        empty={
          <EmptyState
            icon={<ClipboardList className="size-6" />}
            title={filterActive ? "ไม่พบข้อมูลตามตัวกรอง" : "ยังไม่มีผลประเมิน"}
            description={
              filterActive
                ? `ไม่มีรายการที่ตรงกับ ${filterLabel} ลองล้างตัวกรองเพื่อดูทั้งหมด`
                : "เมื่อมีผู้เข้าร่วมทำแบบทดสอบ ผลจะปรากฏที่นี่โดยอัตโนมัติ"
            }
            action={
              filterActive ? (
                <Button variant="outline" onClick={clearFilter}>
                  ล้างตัวกรอง
                </Button>
              ) : undefined
            }
          />
        }
        footer={
          rows.length > 0 ? (
            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={total}
              onChange={setOffset}
            />
          ) : undefined
        }
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`ลบผลประเมิน #${pendingDelete?.id ?? ""}?`}
        description={
          `ผู้เข้าร่วม: ${pendingDelete?.subject_id || "ไม่ระบุ"}\n` +
          `อายุ: ${pendingDelete?.age ?? "ไม่ระบุ"}\n` +
          "การกระทำนี้ย้อนกลับไม่ได้"
        }
        confirmLabel="ลบรายการ"
        loading={busy}
        onConfirm={removeRow}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={clearOpen}
        title={filterActive ? "ล้างผลย้อนหลังตามตัวกรอง?" : "ล้างผลย้อนหลังทั้งหมด?"}
        description={
          (filterActive
            ? `ลบเฉพาะรายการที่ตรงกับ ${filterLabel} — ขณะนี้ ${total} รายการ\n`
            : `ลบผลย้อนหลังทั้งหมด ${total} รายการ\n`) +
          "ลบเฉพาะบันทึกการทำนาย\n" +
          "ชุดข้อมูลเทรน dataset.csv และโมเดลจะไม่ถูกลบ\n\n" +
          "การกระทำนี้ย้อนกลับไม่ได้"
        }
        confirmLabel="ล้างข้อมูล"
        loading={busy}
        onConfirm={clearAll}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <HistoryReport />
    </Suspense>
  );
}
