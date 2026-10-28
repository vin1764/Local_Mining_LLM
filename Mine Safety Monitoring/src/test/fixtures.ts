/**
 * Test fixtures. Every measurement and every site threshold here is
 * SYNTHETIC test data. None of it is evidence about real-world safety.
 */
import { buildDataset, type Dataset } from "@/lib/dataset";
import {
  builtinConfig,
  previewSiteFile,
  type RulesConfig,
} from "@/lib/safety/config";

export const FIELDS = [
  "CO_ppm",
  "CH4_vol_pct",
  "O2_vol_pct",
  "CO2_vol_pct",
  "H2_ppm",
  "C2H4_ppm",
  "C2H2_ppm",
  "Coal_Seam_Temp_C",
  "Airway_Temp_C",
  "Thermal_IR_Max_C",
  "Air_Velocity_m_s",
  "Barometric_Pressure_kPa",
  "Smoke_Obscuration_pct",
  "Explosion_Risk_Index",
  "YOLO_Flame_Detected",
  "YOLO_Smoke_Detected",
] as const;
export type Field = (typeof FIELDS)[number];
type Row = Partial<
  Record<Field | "Grahams_Ratio" | "Trickett_Ratio", string | number>
>;

/** Assessment clock used by tests: 2026-10-28 09:00 UTC. */
export const NOW = Date.parse("2026-10-28T09:00:00Z");

/** Ordinary fresh-air readings (synthetic). */
export const NORMAL: Required<Pick<Row, Field>> = {
  CO_ppm: 5,
  CH4_vol_pct: 0.2,
  O2_vol_pct: 20.8,
  CO2_vol_pct: 0.08,
  H2_ppm: 0,
  C2H4_ppm: 0,
  C2H2_ppm: 0,
  Coal_Seam_Temp_C: 31,
  Airway_Temp_C: 29,
  Thermal_IR_Max_C: 34,
  Air_Velocity_m_s: 1.2,
  Barometric_Pressure_kPa: 101.2,
  Smoke_Obscuration_pct: 0,
  Explosion_Risk_Index: 0.1,
  YOLO_Flame_Detected: 0,
  YOLO_Smoke_Detected: 0,
};

/**
 * Build a dataset of `n` rows, one per minute, ending `endMinutesBeforeNow`
 * before NOW. `edit(i)` overrides fields of row i (0 = oldest).
 */
export function sensorData(
  opts: {
    n?: number;
    endMinutesBeforeNow?: number;
    edit?: (i: number) => Row;
    extraColumns?: string[];
  } = {},
): Dataset {
  const n = opts.n ?? 10;
  const end = NOW - (opts.endMinutesBeforeNow ?? 1) * 60_000;
  const extras = (opts.extraColumns ?? []) as (keyof Row)[];
  const cols: (keyof Row)[] = [...FIELDS, ...extras];
  const lines = [["Timestamp", ...cols].join(",")];
  for (let i = 0; i < n; i++) {
    const t = new Date(end - (n - 1 - i) * 60_000).toISOString();
    const row: Row = { ...NORMAL, ...(opts.edit?.(i) ?? {}) };
    lines.push([t, ...cols.map((c) => row[c] ?? "")].join(","));
  }
  return buildDataset(lines.join("\n"), "synthetic.csv");
}

/** Verification metadata used by test site files. */
export const TEST_VERIFICATION = {
  method: "TEST FIXTURE — not a real verification",
  checkedOn: "2026-10-28",
  officialCopyChecked: true,
  amendmentsChecked: true,
  approvedBy: "test",
};

/** A site file adding a verified CO rule. The numbers are TEST FIXTURES, not real limits. */
export function siteFile(
  extra: Record<string, unknown> = {},
  rules: unknown[] = [],
): string {
  return JSON.stringify({
    schemaVersion: 1,
    name: "TEST site file (fixture values, not real limits)",
    rules: [
      {
        id: "co-site-limit",
        parameter: "CO_ppm",
        unit: "ppm",
        operator: "greater_than",
        warningThreshold: 25,
        criticalThreshold: 50,
        severity: "critical",
        verificationStatus: "verified_site",
        enabled: true,
        requiredForSafe: true,
        source: {
          document: "TEST site standard",
          clause: "TEST clause 1",
          localReference: "test",
          verification: TEST_VERIFICATION,
        },
        explanation: "Test fixture CO rule.",
      },
      ...rules,
    ],
    ...extra,
  });
}

/** Built-in config combined with a site file (throws if the file is invalid). */
export function withSite(text: string): RulesConfig {
  const res = previewSiteFile(text, builtinConfig());
  if (!res.ok) throw new Error(res.errors.join("; "));
  return res.preview.result;
}
