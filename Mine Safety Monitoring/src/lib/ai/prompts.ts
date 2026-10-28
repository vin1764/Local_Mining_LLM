/**
 * The AI Analyst's prompts, in one place. Both the local Ollama app and the
 * in-browser edition use these. Edit here, not in components.
 */
import type { DatasetProfile } from "@/lib/dataset";
import { SAFETY_STATUS_LABEL } from "@/lib/safety/assess";

/** Fixed mining-specific system prompt. */
export const MINING_SYSTEM_PROMPT = [
  "You are an AI Mining Safety and Environmental Analytics Assistant for the STRATA dashboard.",
  "You analyse mine-related sensor measurements, operational indicators and environmental conditions from one uploaded CSV log.",
  "Your job is to explain the supplied data in clear, professional English for mining engineers and operational personnel,",
  "and to point out potential hazards or abnormal operating conditions that the data supports.",
  "",
  "Evidence rules:",
  "- Use only the FACTS sheet: measurements, configured thresholds, sensor names and units, timestamps and calculated analytics.",
  "- Never invent sensor readings, regulatory thresholds, mine conditions, units or causal explanations.",
  "- Name parameters exactly as written (for example methane_pct). Do not guess what abbreviations stand for.",
  "- Keep units and timestamps when you quote a number. Only outliers and threshold checks have dates.",
  "- Copy trend directions exactly: if FACTS says a parameter ROSE, never say it fell, and the reverse.",
  "- State measured facts plainly. Mark possible explanations as hypotheses ('may', 'possibly', 'could').",
  "- Correlation is not causation. If the evidence is too thin for a conclusion, say so.",
  "",
  "What to analyse:",
  "- current operating conditions and important trends;",
  "- readings that exceed configured thresholds (only those listed under SAFETY ASSESSMENT);",
  "- abnormal measurements and outliers;",
  "- differences between latest values and their 1-hour moving averages;",
  "- missing, stale, invalid or conflicting readings;",
  "- practical next steps for inspection or verification.",
  "",
  "Safety classification:",
  "- The SAFETY ASSESSMENT section was computed by fixed rules. Its STATUS is final.",
  "- Repeat that exact status in safety_status and explain the evidence behind it. Never change it.",
  "- Do not call a value unsafe or a breach unless the SAFETY ASSESSMENT says so.",
  "- Never claim the mine is certified safe or safe to enter based on sensor readings or this analysis.",
  "- If the status is INSUFFICIENT_DATA, explain what data or thresholds are missing.",
].join("\n");

const fmt = (v: number | null | undefined, unit: string) =>
  v === null || v === undefined
    ? "n/a"
    : `${Number(v.toFixed(4))}${unit ? ` ${unit}` : ""}`;

/** Sensor names, units and configured thresholds for this file, for the system prompt. */
export function sensorContext(profile: DatasetProfile): string {
  const numeric = profile.columns.filter((c) => c.type === "number");
  const lines = ["", "Sensors in this file (name, unit):"];
  for (const c of numeric.slice(0, 30))
    lines.push(`- ${c.name} (${c.unit || "unit not stated"})`);
  const ev = profile.safety?.evaluations ?? [];
  lines.push("", "Configured safety thresholds for this file:");
  if (ev.length === 0) {
    lines.push(
      "- none. No verified thresholds apply, so no reading can be called a breach.",
    );
  } else {
    for (const e of ev) {
      const op = e.direction === "above" ? "≥" : "≤";
      lines.push(
        `- ${e.column}: warning ${e.warning === null ? "not set" : `${op} ${fmt(e.warning, e.unit)}`}, critical ${op} ${fmt(e.critical, e.unit)} (source: ${e.source})`,
      );
    }
  }
  return lines.join("\n");
}

export function buildSystemPrompt(profile: DatasetProfile): string {
  return `${MINING_SYSTEM_PROMPT}\n${sensorContext(profile)}`;
}

/** The SAFETY ASSESSMENT section of the facts sheet. */
export function safetyFacts(profile: DatasetProfile): string {
  const a = profile.safety;
  if (!a) {
    return "SAFETY ASSESSMENT (rule-based, final):\n- STATUS: INSUFFICIENT_DATA\n- No rule-based assessment was supplied with this file.";
  }
  const lines = [
    "SAFETY ASSESSMENT (rule-based, final):",
    `- STATUS: ${a.status} (${SAFETY_STATUS_LABEL[a.status]})`,
    `- Readings up to: ${a.dataAsOf ?? "unknown"}; thresholds from: ${a.rulesSource}`,
    "- Reasons:",
    ...a.reasons.map((r) => `  - ${r}`),
  ];
  if (a.evaluations.length) {
    lines.push(
      "- Threshold checks (current window = last 60 minutes of the file):",
    );
    for (const e of a.evaluations) {
      lines.push(
        `  - ${e.column}: ${e.level.toUpperCase()}; latest ${fmt(e.latestValue, e.unit)} at ${e.latestAt ?? "n/a"}; ` +
          `1-hour average ${fmt(e.movingAvg1h, e.unit)}; worst ${fmt(e.worstValue, e.unit)} at ${e.worstAt ?? "n/a"}.`,
      );
    }
  }
  if (a.dataQualityNotes.length) {
    lines.push("- Data quality:", ...a.dataQualityNotes.map((n) => `  - ${n}`));
  }
  if (a.unassessedParameters.length && a.evaluations.length) {
    lines.push(
      `- Not assessed (no threshold): ${a.unassessedParameters.join(", ")}`,
    );
  }
  return lines.join("\n");
}
