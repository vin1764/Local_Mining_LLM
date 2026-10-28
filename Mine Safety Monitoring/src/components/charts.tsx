import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity } from "lucide-react";

import {
  buildChartRows,
  chartOrderedRows,
  computeAnomalies,
  formatValue,
  prettyName,
  shortLabel,
  type Anomaly,
  type Dataset,
} from "@/lib/dataset";
import {
  MOVING_AVERAGE_SHORT_LABEL,
  MOVING_AVERAGE_WINDOW_MS,
  medianSamplingIntervalMs,
  movingAverage,
  parseTimestamp,
} from "@/lib/moving-average";

export function chartColor(i: number): string {
  return `var(--chart-${(i % 6) + 1})`;
}

/* ---------------- Trend console: combined multi-parameter chart ---------------- */

interface TrendConsoleProps {
  dataset: Dataset;
  selected: string[];
  normalized: boolean;
  onToggle: (name: string) => void;
  onNormalized: (v: boolean) => void;
}

function ConsoleTooltip({ active, payload, label, dataset, unitOf }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[11px] shadow-lg">
      <p className="mb-1 font-semibold text-foreground">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted-foreground">{prettyName(p.dataKey)}</span>
          <span className="text-foreground">
            {typeof p.value === "number" ? formatValue(p.value, unitOf(p.dataKey)) : p.value}
          </span>
        </p>
      ))}
      {dataset == null && null}
    </div>
  );
}

export function TrendConsole({ dataset, selected, normalized, onToggle, onNormalized }: TrendConsoleProps) {
  const rows = useMemo(() => {
    const base = buildChartRows(dataset, selected);
    if (!normalized) return base;
    return base.map((r) => {
      const out = { ...r };
      for (const col of selected) {
        const first = typeof base[0]?.[col] === "number" ? (base[0][col] as number) : 0;
        const v = r[col];
        out[col] = first !== 0 && typeof v === "number" ? Number(((v / first) * 100).toFixed(2)) : 0;
      }
      return out;
    });
  }, [dataset, selected, normalized]);

  const anomalies: Anomaly[] = useMemo(() => {
    if (normalized) return [];
    const allowed = new Set(selected);
    return computeAnomalies(dataset, 40).filter((a) => allowed.has(a.column));
  }, [dataset, selected, normalized]);

  const unitOf = (col: string) =>
    dataset.columns.find((c) => c.name === col)?.unit ?? "";

  return (
    <div>
      {/* Parameter chips + normalize switch */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 font-mono text-[11px] tracking-wider text-muted-foreground">
          PARAMETERS:
        </span>
        {dataset.numericNames.map((name, i) => {
          const active = selected.includes(name);
          return (
            <button
              key={name}
              onClick={() => onToggle(name)}
              className={`flex items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[11px] tracking-wide transition-colors ${
                active
                  ? "border-primary/60 bg-primary/15 text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              }`}
            >
              <span
                className="inline-block size-2 rounded-sm"
                style={{ background: active ? chartColor(i) : "var(--color-border)" }}
              />
              {prettyName(name)}
            </button>
          );
        })}

        <label className="ml-auto flex cursor-pointer items-center gap-2 font-mono text-[11px] tracking-wider text-muted-foreground">
          <input
            type="checkbox"
            checked={normalized}
            onChange={(e) => onNormalized(e.target.checked)}
            className="size-3.5 accent-[var(--color-primary)]"
          />
          NORMALIZE (FIRST = 100)
        </label>
      </div>

      <div className="rounded-md border border-border bg-surface p-2">
        {selected.length === 0 ? (
          <div className="flex h-[340px] items-center justify-center font-mono text-xs text-muted-foreground">
            SELECT AT LEAST ONE PARAMETER
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={rows} margin={{ top: 12, right: 18, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.4} strokeDasharray="3 6" />
              <XAxis
                dataKey="idx"
                tickFormatter={(i: number) => (rows[i] ? shortLabel(rows[i].label) : "")}
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 10, fontFamily: "IBM Plex Mono" }}
                stroke="var(--color-border)"
                minTickGap={40}
              />
              <YAxis
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 10, fontFamily: "IBM Plex Mono" }}
                tickFormatter={(v: number) => formatValue(v)}
                stroke="var(--color-border)"
                width={56}
                label={{
                  value: normalized ? "INDEX (FIRST = 100)" : "VALUE",
                  angle: -90,
                  position: "insideLeft",
                  style: {
                    fill: "var(--color-muted-foreground)",
                    fontSize: 10,
                    fontFamily: "IBM Plex Mono",
                  },
                }}
              />
              <Tooltip
                content={<ConsoleTooltip dataset={dataset} unitOf={unitOf} />}
                cursor={{ stroke: "var(--color-primary)", strokeOpacity: 0.4 }}
              />
              {selected.map((name, i) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={chartColor(i)}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3.5 }}
                  isAnimationActive={false}
                />
              ))}
              {anomalies.map((a, i) => (
                <ReferenceDot
                  key={`${a.column}-${a.rowIndex}-${i}`}
                  x={a.rowIndex}
                  y={a.value}
                  r={4}
                  fill="var(--color-negative)"
                  stroke="var(--color-background)"
                  ifOverflow="extendDomain"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground">
        <span className="inline-block size-2 rounded-sm bg-[var(--color-negative)]" />
        OUTLIER MARKERS (|z| ≥ 3) — SHOWN IN RAW MODE
      </p>
    </div>
  );
}

/* ---------------- Deep dive: small multiples with a 1-hour moving average ---------------- */

interface MiniChartProps {
  dataset: Dataset;
  column: string;
  colorIndex: number;
}

function AnomalyDot(props: any) {
  const { cx, cy, payload } = props;
  if (!payload?._anom || cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={3.5} fill="var(--color-negative)" />;
}

export function MiniChart({ dataset, column, colorIndex }: MiniChartProps) {
  const meta = dataset.columns.find((c) => c.name === column);
  const stats = meta?.stats;

  const { rows, sparse } = useMemo(() => {
    const base = buildChartRows(dataset, [column]);
    // Trailing 1-hour window by timestamp (see lib/moving-average.ts). Missing
    // values are excluded; without a time column there is no 1-hour window.
    const tc = dataset.timeColumn;
    const points = chartOrderedRows(dataset).map((r) => {
      const v = r[column];
      return { t: tc ? parseTimestamp(r[tc]) : null, value: typeof v === "number" ? v : null };
    });
    const ma = tc ? movingAverage(points) : null;
    const interval = tc ? medianSamplingIntervalMs(points.map((p) => p.t)) : null;
    const out = base.map((r, i) => {
      const avg = ma?.[i]?.avg ?? null;
      const z =
        stats && stats.std > 0 && typeof r[column] === "number"
          ? Math.abs(((r[column] as number) - stats.mean) / stats.std)
          : 0;
      return { ...r, _ma: avg === null ? null : Number(avg.toFixed(3)), _anom: z >= 3 };
    });
    return { rows: out, sparse: interval !== null && interval >= MOVING_AVERAGE_WINDOW_MS };
  }, [dataset, column, stats]);

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="font-mono text-[11px] font-semibold tracking-wider text-foreground">
          {prettyName(column)}
        </p>
        <p className="font-mono text-[10px] text-muted-foreground">
          {stats && `μ ${formatValue(stats.mean, meta?.unit)} · σ ${formatValue(stats.std)}`}
        </p>
      </div>
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <XAxis dataKey="idx" hide />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 4,
              fontSize: 11,
              fontFamily: "IBM Plex Mono",
            }}
            labelFormatter={() => ""}
            formatter={(v: any, _name: any, item: any) => [
              formatValue(Number(v), meta?.unit),
              item?.dataKey === "_ma" ? MOVING_AVERAGE_SHORT_LABEL : prettyName(column),
            ]}
            cursor={{ stroke: "var(--color-primary)", strokeOpacity: 0.4 }}
          />
          <Line
            type="monotone"
            dataKey={column}
            stroke={chartColor(colorIndex)}
            strokeWidth={1.6}
            dot={<AnomalyDot />}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="_ma"
            stroke="var(--color-foreground)"
            strokeOpacity={0.45}
            strokeWidth={1}
            strokeDasharray="4 4"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 border-t border-dashed border-foreground/50" />
          {!dataset.timeColumn
            ? `${MOVING_AVERAGE_SHORT_LABEL} N/A (NO TIME COLUMN)`
            : sparse
              ? `${MOVING_AVERAGE_SHORT_LABEL} · ≤1 READING/HOUR`
              : MOVING_AVERAGE_SHORT_LABEL}
        </span>
        {stats && stats.anomalyCount > 0 ? (
          <span className="text-negative">{stats.anomalyCount} OUTLIERS</span>
        ) : (
          <span className="text-positive">STABLE</span>
        )}
      </div>
    </div>
  );
}

/* ---------------- Section scaffold ---------------- */

export function SectionHeader({ index, title, right }: { index: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 border-b border-border pb-2">
      <h2 className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] text-primary">{index}</span>
        <span className="font-display text-2xl leading-none tracking-wide text-foreground">
          {title}
        </span>
      </h2>
      {right && <div className="hidden sm:block">{right}</div>}
    </div>
  );
}

export function EmptyChartNote() {
  return (
    <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
      <Activity className="size-3.5" />
      Load a dataset to render trend plots.
    </p>
  );
}
