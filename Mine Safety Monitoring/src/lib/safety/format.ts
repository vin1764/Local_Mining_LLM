import type { RuleEvaluation } from "./assess";

/** A reading for display: numbers with their unit, detections as words. */
export function formatReading(
  v: number | boolean | null | undefined,
  unit: string,
): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "DETECTED" : "not detected";
  const n = Number(v.toPrecision(6));
  return unit && !["ratio", "index", "boolean"].includes(unit)
    ? `${n} ${unit}`
    : String(n);
}

const OP: Record<string, string> = {
  greater_than: ">",
  greater_than_or_equal: "≥",
  less_than: "<",
  less_than_or_equal: "≤",
};

/**
 * The warning or critical threshold of a rule, e.g. "> 1.25 %vol"; "—" when
 * the rule has none at that level. Detections and steady-increase rules have
 * no number, so they are shown only at the rule's own severity level.
 */
export function formatThreshold(
  e: Pick<
    RuleEvaluation,
    "operator" | "unit" | "severity" | "warning" | "critical"
  >,
  level: "warning" | "critical",
): string {
  if (e.operator === "is_true" || e.operator === "steady_increase") {
    const atLevel = (e.severity === "critical") === (level === "critical");
    if (!atLevel) return "—";
    return e.operator === "is_true" ? "detected" : "steady rise";
  }
  const value = e[level];
  if (value === null) return "—";
  return `${OP[e.operator] ?? ""} ${formatReading(value, e.unit)}`;
}

export const RESULT_TEXT: Record<RuleEvaluation["result"], string> = {
  ok: "OK",
  warning: "WARNING",
  critical: "CRITICAL",
  not_evaluated: "NOT CHECKED",
};
