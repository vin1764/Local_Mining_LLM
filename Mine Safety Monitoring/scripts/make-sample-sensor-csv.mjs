#!/usr/bin/env node
/**
 * Writes a SYNTHETIC sensor CSV for trying the safety panel.
 *
 *   node scripts/make-sample-sensor-csv.mjs [scenario] [out.csv]
 *
 * Scenarios: normal (default), methane, low-oxygen, smoke, stale, heating.
 * Timestamps end one minute before "now", so the data counts as current
 * (except "stale", which ends two hours ago).
 *
 * The readings are invented. They are not measurements from any mine and
 * must never be used as evidence about real conditions.
 */
import { writeFileSync } from "node:fs";

const scenario = process.argv[2] ?? "normal";
const out = process.argv[3] ?? `synthetic-${scenario}.csv`;
const SCENARIOS = [
  "normal",
  "methane",
  "low-oxygen",
  "smoke",
  "stale",
  "heating",
];
if (!SCENARIOS.includes(scenario)) {
  console.error(
    `Unknown scenario "${scenario}". Use one of: ${SCENARIOS.join(", ")}`,
  );
  process.exit(2);
}

const ROWS = 120; // two hours, one reading per minute
const end = Date.now() - (scenario === "stale" ? 120 : 1) * 60_000;

// Small deterministic wobble so charts are not flat lines.
const wobble = (i, amp, period = 17) =>
  amp * Math.sin((i / period) * 2 * Math.PI);
const r = (v, d = 3) => Number(v.toFixed(d));

const header = [
  "Timestamp",
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
  "Grahams_Ratio",
  "Trickett_Ratio",
  "Explosion_Risk_Index",
  "YOLO_Flame_Detected",
  "YOLO_Smoke_Detected",
];

const lines = [header.join(",")];
for (let i = 0; i < ROWS; i++) {
  const late = i >= ROWS - 15; // the last 15 minutes carry the scenario
  const ramp = late ? (i - (ROWS - 15) + 1) / 15 : 0;
  let co = 6 + wobble(i, 1.5);
  let ch4 = 0.25 + wobble(i, 0.05, 23);
  let o2 = 20.8 + wobble(i, 0.05, 29);
  let co2 = 0.08 + wobble(i, 0.01, 31);
  let h2 = 0;
  let seam = 31 + wobble(i, 0.4, 41);
  let ir = 34 + wobble(i, 0.8, 13);
  let smoke = 0;
  let flame = 0;
  let smokeDet = 0;

  if (scenario === "methane") ch4 += ramp * 1.2; // ends near 1.45 %vol
  if (scenario === "low-oxygen") o2 -= ramp * 2.3; // ends near 18.5 %vol
  if (scenario === "smoke" && i >= ROWS - 3) {
    smokeDet = 1;
    smoke = 12;
  }
  if (scenario === "heating") {
    o2 -= ramp * 1.3;
    co2 += ramp * 0.3;
    co += ramp * 40;
    h2 += ramp * 15;
    seam += ramp * 8;
    ir += ramp * 12;
  }

  // Derived ratios from the same readings (CIMFR formulas, see docs/safety-sources.md).
  const coPct = co / 10_000;
  const h2Pct = h2 / 10_000;
  const n2 = 100 - (o2 + co2 + ch4 + coPct + h2Pct);
  const dO2 = 0.265 * n2 - o2;
  const graham = dO2 >= 0.3 ? r((100 * coPct) / dO2, 4) : "";
  const trickett =
    dO2 >= 0.3 ? r((co2 + 0.75 * coPct - 0.25 * h2Pct) / dO2, 4) : "";

  const t = new Date(end - (ROWS - 1 - i) * 60_000).toISOString();
  lines.push(
    [
      t,
      r(co, 1),
      r(ch4),
      r(o2, 2),
      r(co2),
      r(h2, 1),
      0,
      0,
      r(seam, 1),
      r(29 + wobble(i, 0.3, 37), 1),
      r(ir, 1),
      r(1.2 + wobble(i, 0.1, 19), 2),
      r(101.2 + wobble(i, 0.05, 53), 2),
      smoke,
      graham,
      trickett,
      r(0.1 + ramp * (scenario === "methane" ? 0.5 : 0), 2),
      flame,
      smokeDet,
    ].join(","),
  );
}

writeFileSync(out, lines.join("\n") + "\n");
console.log(
  `Wrote ${ROWS} SYNTHETIC rows (${scenario}) to ${out}. These are not real measurements.`,
);
