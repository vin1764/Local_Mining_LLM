import Papa from "papaparse";

/* ============================ Types ============================ */

export type ColumnType = "number" | "time" | "category";

export interface NumberStats {
  min: number;
  max: number;
  mean: number;
  std: number;
  first: number;
  last: number;
  trendPct: number;
  missingPct: number;
  anomalyCount: number;
}

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  unit: string;
  stats?: NumberStats;
}

export interface Dataset {
  name: string;
  rowCount: number;
  timeColumn: string | null;
  columns: ColumnMeta[];
  rows: Record<string, number | string | null>[];
  numericNames: string[];
  categoryNames: string[];
}

export interface ChartRow {
  idx: number;
  label: string;
  ts: number;
  [column: string]: number | string;
}

export interface Correlation {
  a: string;
  b: string;
  r: number;
}

export interface Anomaly {
  column: string;
  rowIndex: number;
  label: string;
  value: number;
  z: number;
}

export interface ProfileColumn {
  name: string;
  type: ColumnType;
  unit: string;
  min?: number;
  max?: number;
  mean?: number;
  std?: number;
  first?: number;
  last?: number;
  trendPct?: number;
  missingPct?: number;
  anomalyCount?: number;
  distinct?: number;
}

export interface DatasetProfile {
  name: string;
  rowCount: number;
  timeColumn: string | null;
  columns: ProfileColumn[];
  correlations: { a: string; b: string; r: number }[];
  anomalies: { column: string; label: string; value: number; z: number }[];
  samples: { first: string[]; last: string[] };
}

export interface DatasetInsights {
  headline: string;
  summary: string;
  findings: {
    parameter: string;
    observation: string;
    severity: "normal" | "watch" | "critical";
  }[];
  recommendations: string[];
}

/* ============================ Parsing ============================ */

const MISSING = new Set(["", "na", "n/a", "null", "none", "-", "--", "nan"]);

function isMissing(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return MISSING.has(String(v).trim().toLowerCase());
}

function parseNumber(v: unknown): number | null {
  if (isMissing(v)) return null;
  const n = Number(String(v).trim().replace(/[,\s%$]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isTimeLike(v: unknown): boolean {
  if (isMissing(v)) return false;
  const s = String(v).trim();
  if (!/\d/.test(s) || !/[-/:]/.test(s)) return false;
  return !Number.isNaN(Date.parse(s));
}

export function inferUnit(name: string): string {
  const n = name.toLowerCase();
  if (/pct|percent|%/.test(n)) return "%";
  if (/(^|_)(kwh|energy)/.test(n)) return "kWh";
  if (/tph|tonn/.test(n)) return "t/h";
  if (/(^|_)kl|water/.test(n)) return "kL";
  if (/hrs?$|downtime/.test(n)) return "h";
  if (/temp|(^|_)c(_|$)/.test(n)) return "°C";
  if (/(^|_)m(_|$)|depth/.test(n)) return "m";
  return "";
}

export function prettyName(name: string): string {
  return name.replace(/[_-]+/g, " ").trim().toUpperCase();
}

function classifyColumn(values: string[]): ColumnType {
  const n = values.length;
  if (n === 0) return "category";
  const timeHits = values.filter(isTimeLike).length;
  if (timeHits / n >= 0.7) return "time";
  const numHits = values.filter((v) => parseNumber(v) !== null).length;
  if (numHits / n >= 0.7) return "number";
  return "category";
}

/** Parse raw CSV text into a normalized, typed dataset. Throws with a plain message. */
export function buildDataset(text: string, name: string): Dataset {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  if (!parsed.data.length) {
    throw new Error("No data rows found in that file.");
  }

  const headers = (parsed.meta.fields ?? []).filter((h) => h && h.length > 0);
  if (headers.length === 0) {
    throw new Error("Could not find a header row with column names.");
  }

  const types = new Map<string, ColumnType>();
  for (const col of headers) {
    const sample: string[] = [];
    for (const row of parsed.data) {
      const v = row[col];
      if (!isMissing(v)) {
        sample.push(String(v));
        if (sample.length >= 60) break;
      }
    }
    types.set(col, classifyColumn(sample));
  }

  // A time column wins only if it sorts first alphabetically among time columns? No —
  // prefer the earliest column in header order marked as time.
  const timeColumn = headers.find((h) => types.get(h) === "time") ?? null;

  const rows: Record<string, number | string | null>[] = [];
  for (const raw of parsed.data) {
    const row: Record<string, number | string | null> = {};
    for (const col of headers) {
      const v = raw[col];
      if (isMissing(v)) {
        row[col] = null;
      } else if (types.get(col) === "number") {
        row[col] = parseNumber(v);
      } else {
        row[col] = String(v).trim();
      }
    }
    rows.push(row);
  }

  const numericNames: string[] = [];
  const categoryNames: string[] = [];
  const columns: ColumnMeta[] = [];

  for (const col of headers) {
    const type = types.get(col)!;
    if (type === "number") numericNames.push(col);
    if (type === "category") categoryNames.push(col);

    const meta: ColumnMeta = { name: col, type, unit: type === "number" ? inferUnit(col) : "" };

    if (type === "number") {
      meta.stats = computeStats(rows, col);
    }
    columns.push(meta);
  }

  return {
    name,
    rowCount: rows.length,
    timeColumn,
    columns,
    rows,
    numericNames,
    categoryNames,
  };
}

/* ============================ Statistics ============================ */

export function computeStats(rows: Record<string, number | string | null>[], col: string): NumberStats {
  const values: number[] = [];
  let missing = 0;
  for (const row of rows) {
    const v = row[col];
    if (typeof v === "number") values.push(v);
    else missing++;
  }

  const n = values.length || 1;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;

  // Robust trend: mean of first quarter vs last quarter.
  const q = Math.max(1, Math.floor(values.length / 4));
  const head = values.slice(0, q);
  const tail = values.slice(-q);
  const headMean = head.reduce((a, b) => a + b, 0) / (head.length || 1);
  const tailMean = tail.reduce((a, b) => a + b, 0) / (tail.length || 1);
  const trendPct = headMean !== 0 ? ((tailMean - headMean) / Math.abs(headMean)) * 100 : 0;

  const anomalyCount = std > 0 ? values.filter((v) => Math.abs((v - mean) / std) >= 3).length : 0;

  return {
    min,
    max,
    mean,
    std,
    first,
    last,
    trendPct,
    missingPct: (missing / (values.length + missing || 1)) * 100,
    anomalyCount,
  };
}

export function computeAnomalies(dataset: Dataset, limit = 14): Anomaly[] {
  const out: Anomaly[] = [];
  for (const col of dataset.numericNames) {
    const stats = dataset.columns.find((c) => c.name === col)?.stats;
    if (!stats || stats.std <= 0) continue;
    dataset.rows.forEach((row, i) => {
      const v = row[col];
      if (typeof v !== "number") return;
      const z = (v - stats.mean) / stats.std;
      if (Math.abs(z) >= 3) {
        out.push({
          column: col,
          rowIndex: i,
          label: dataset.timeColumn ? String(row[dataset.timeColumn] ?? `#${i}`) : `#${i}`,
          value: v,
          z: Number(z.toFixed(2)),
        });
      }
    });
  }
  out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return out.slice(0, limit);
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 10) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - mx;
    const dy = (ys[i] ?? 0) - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return 0;
  return cov / Math.sqrt(vx * vy);
}

export function computeCorrelations(dataset: Dataset, maxPairs = 8): Correlation[] {
  const pairs: Correlation[] = [];
  for (let i = 0; i < dataset.numericNames.length; i++) {
    for (let j = i + 1; j < dataset.numericNames.length; j++) {
      const a = dataset.numericNames[i];
      const b = dataset.numericNames[j];
      if (!a || !b) continue;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const row of dataset.rows) {
        const x = row[a];
        const y = row[b];
        if (typeof x === "number" && typeof y === "number") {
          xs.push(x);
          ys.push(y);
        }
      }
      const r = pearson(xs, ys);
      if (Math.abs(r) >= 0.35) pairs.push({ a, b, r: Number(r.toFixed(3)) });
    }
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  return pairs.slice(0, maxPairs);
}

/* ============================ Charting ============================ */

export function buildChartRows(dataset: Dataset, selected: string[]): ChartRow[] {
  let ordered = dataset.rows;
  const tc = dataset.timeColumn;
  if (tc) {
    ordered = [...dataset.rows].sort((a, b) => {
      const ta = Date.parse(String(a[tc] ?? ""));
      const tb = Date.parse(String(b[tc] ?? ""));
      return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
    });
  }

  return ordered.map((row, idx) => {
    const out: ChartRow = {
      idx,
      label: tc ? String(row[tc] ?? `#${idx}`) : `#${idx}`,
      ts: tc ? Date.parse(String(row[tc] ?? "")) || idx : idx,
    };
    for (const col of selected) {
      const v = row[col];
      out[col] = typeof v === "number" ? v : 0;
    }
    return out;
  });
}

export function formatValue(v: number, unit = ""): string {
  const abs = Math.abs(v);
  let s: string;
  if (abs >= 1_000_000) s = `${(v / 1_000_000).toFixed(1)}M`;
  else if (abs >= 10_000) s = `${(v / 1000).toFixed(1)}k`;
  else if (abs >= 100) s = v.toFixed(0);
  else if (abs >= 10) s = v.toFixed(1);
  else s = v.toFixed(2);
  return unit ? `${s} ${unit}` : s;
}

export function shortLabel(label: string): string {
  const t = Date.parse(label);
  if (!Number.isNaN(t) && /[-/:]/.test(label)) {
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return label;
}

/* ============================ AI profile ============================ */

export function buildProfile(dataset: Dataset): DatasetProfile {
  const columns: ProfileColumn[] = dataset.columns.map((c) => {
    const base: ProfileColumn = { name: c.name, type: c.type, unit: c.unit };
    if (c.type === "category") {
      base.distinct = new Set(
        dataset.rows.slice(0, 500).map((r) => String(r[c.name] ?? "")).filter(Boolean),
      ).size;
    }
    if (c.stats) {
      base.min = Number(c.stats.min.toFixed(3));
      base.max = Number(c.stats.max.toFixed(3));
      base.mean = Number(c.stats.mean.toFixed(3));
      base.std = Number(c.stats.std.toFixed(3));
      base.first = Number(c.stats.first.toFixed(3));
      base.last = Number(c.stats.last.toFixed(3));
      base.trendPct = Number(c.stats.trendPct.toFixed(1));
      base.missingPct = Number(c.stats.missingPct.toFixed(1));
      base.anomalyCount = c.stats.anomalyCount;
    }
    return base;
  });

  const toLine = (row: Record<string, number | string | null>) =>
    dataset.columns.map((c) => {
      const v = row[c.name];
      return `${c.name}=${v === null ? "∅" : v}`;
    }).join(" | ");

  return {
    name: dataset.name,
    rowCount: dataset.rowCount,
    timeColumn: dataset.timeColumn,
    columns,
    correlations: computeCorrelations(dataset),
    anomalies: computeAnomalies(dataset).map((a) => ({
      column: a.column,
      label: a.label,
      value: a.value,
      z: a.z,
    })),
    samples: {
      first: dataset.rows.slice(0, 3).map(toLine),
      last: dataset.rows.slice(-3).map(toLine),
    },
  };
}

/* ============================ Demo data ============================ */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic underground-mine operations log, 180 days, CSV-shaped. */
export function buildDemoDataset(): Dataset {
  const rand = mulberry32(20261023);
  const lines = [
    "date,depth_m,ore_grade_pct,throughput_tph,energy_kwh_t,water_kl,downtime_h",
  ];

  for (let i = 0; i < 180; i++) {
    const d = new Date(Date.UTC(2026, 3, 27) + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);

    const depth = 240 + i * 0.32 + Math.sin(i / 9) * 3.5 + (rand() - 0.5) * 1.6;

    let downtime = rand() < 0.06 ? 4 + rand() * 6 : rand() * 1.6;

    let grade = 2.4 - i * 0.0042 + Math.sin(i / 14) * 0.09 + (rand() - 0.5) * 0.14;

    let throughput =
      1850 - downtime * 130 - (2.4 - grade) * 45 + Math.sin(i / 11) * 28 + (rand() - 0.5) * 42;

    let energy =
      18.6 + i * 0.011 + (2.4 - grade) * 1.9 + downtime * 0.9 + (rand() - 0.5) * 0.5;

    const water = 940 + throughput * 0.052 + Math.sin(i / 7) * 12 + (rand() - 0.5) * 16;

    // Seeded incidents so the anomaly layer has something real to flag.
    if (i === 43) energy *= 1.36;
    if (i === 88) throughput *= 0.68;
    if (i === 120) downtime = 11.5;
    if (i === 141) grade *= 1.22;
    if (i === 159) energy *= 1.29;

    const r = (v: number, dp = 2) => v.toFixed(dp);
    lines.push(
      `${iso},${r(depth, 1)},${r(grade)},${r(throughput, 1)},${r(energy)},${r(water, 1)},${r(downtime)}`,
    );
  }

  return buildDataset(lines.join("\n"), "demo-underground-ops-180d.csv");
}
