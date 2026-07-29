"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "@/hooks/useTheme";
import { riskHex } from "@/lib/format";
import type { HistoryItem, RiskLevel } from "@/lib/types";
import { RISK_LABELS } from "@/lib/constants";

/** Shared axis/grid colours so all three charts read as one system. */
function usePalette() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    grid: dark ? "#1e293b" : "#e2e8f0",
    axis: dark ? "#64748b" : "#94a3b8",
    tooltip: {
      backgroundColor: dark ? "#0f172a" : "#ffffff",
      border: `1px solid ${dark ? "#1e293b" : "#e2e8f0"}`,
      borderRadius: "0.75rem",
      fontSize: "12px",
      color: dark ? "#e2e8f0" : "#334155",
    } as React.CSSProperties,
  };
}

/**
 * Clipping frame shared by every chart.
 *
 * Recharts renders its tooltip as an absolutely positioned sibling of the SVG.
 * After hovering a chart and then shrinking the viewport, that leftover tooltip
 * keeps its old offset and widens the document, which shows up as horizontal
 * scroll on a phone. Clipping at the chart boundary contains it, and also stops
 * a tooltip near the edge from spilling outside its card.
 */
function ChartFrame({ children }: { children: React.ReactNode }) {
  return <div className="relative w-full overflow-hidden">{children}</div>;
}

/**
 * Distribution of risk bands as a donut.
 *
 * Each slice keeps the same colour the band uses everywhere else in the app,
 * so the legend never has to be re-learned.
 */
export function RiskDistributionChart({ items }: { items: HistoryItem[] }) {
  const palette = usePalette();
  const counts: Record<RiskLevel, number> = { Low: 0, Moderate: 0, High: 0 };
  items.forEach((item) => {
    if (counts[item.risk_level] !== undefined) counts[item.risk_level] += 1;
  });

  const data = (Object.keys(counts) as RiskLevel[])
    .map((level) => ({ name: RISK_LABELS[level], level, value: counts[level] }))
    .filter((entry) => entry.value > 0);

  if (data.length === 0) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        ยังไม่มีข้อมูลให้แสดง
      </p>
    );
  }

  return (
    <ChartFrame>
      <ResponsiveContainer width="100%" height={224}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={52}
          outerRadius={80}
          paddingAngle={2}
          strokeWidth={0}
        >
          {data.map((entry) => (
            <Cell key={entry.level} fill={riskHex(entry.level)} />
          ))}
        </Pie>
        <Tooltip contentStyle={palette.tooltip} />
        <Legend
          verticalAlign="bottom"
          height={28}
          formatter={(value) => (
            <span style={{ color: palette.axis, fontSize: 12 }}>{value}</span>
          )}
        />
      </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * Risk score over time.
 *
 * Points are ordered oldest-first, which is the opposite of the table's
 * newest-first ordering, because a trend only reads correctly left-to-right.
 */
export function RiskTrendChart({ items }: { items: HistoryItem[] }) {
  const palette = usePalette();
  const data = [...items]
    .reverse()
    .map((item, index) => ({
      index: index + 1,
      score: Number(item.risk_score.toFixed(3)),
      subject: item.subject_id || "—",
    }));

  if (data.length < 2) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        ต้องมีอย่างน้อย 2 รายการจึงจะแสดงแนวโน้มได้
      </p>
    );
  }

  return (
    <ChartFrame>
      <ResponsiveContainer width="100%" height={224}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} vertical={false} />
        <XAxis
          dataKey="index"
          tick={{ fontSize: 11, fill: palette.axis }}
          axisLine={{ stroke: palette.grid }}
          tickLine={false}
        />
        <YAxis
          domain={[0, 1]}
          tick={{ fontSize: 11, fill: palette.axis }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={palette.tooltip}
          formatter={(value: number) => [value.toFixed(3), "คะแนน"]}
          labelFormatter={(label) => `รายการที่ ${label}`}
        />
        <Line
          type="monotone"
          dataKey="score"
          stroke="#2563eb"
          strokeWidth={2}
          dot={{ r: 3, strokeWidth: 0, fill: "#2563eb" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * Feature importance from the trained model, most influential first.
 *
 * Reported straight from the estimator so the chart cannot drift from what the
 * model actually learned.
 */
export function FeatureImportanceChart({
  importance,
  labels,
}: {
  importance: Record<string, number>;
  labels: Record<string, { label: string }>;
}) {
  const palette = usePalette();
  const data = Object.entries(importance)
    .map(([key, value]) => ({
      name: labels[key]?.label ?? key,
      value: Number((value * 100).toFixed(2)),
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 8);

  if (data.length === 0) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        ยังไม่มีโมเดลที่เทรนแล้ว
      </p>
    );
  }

  return (
    <ChartFrame>
      <ResponsiveContainer width="100%" height={Math.max(224, data.length * 34)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} horizontal={false} />
        <XAxis
          type="number"
          unit="%"
          tick={{ fontSize: 11, fill: palette.axis }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          /* Thai feature names are long; 140px clipped the leading glyphs. */
          width={190}
          tick={{ fontSize: 11, fill: palette.axis }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={palette.tooltip}
          formatter={(value: number) => [`${value}%`, "ความสำคัญ"]}
        />
        <Bar dataKey="value" fill="#2563eb" radius={[0, 6, 6, 0]} maxBarSize={18} />
      </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
