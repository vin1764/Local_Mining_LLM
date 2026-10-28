/**
 * Deterministic safety classification. The language model never decides the
 * status; it only explains the result of this function.
 *
 * Only three statuses exist. Decision order (first match wins):
 *   1. UNSAFE   a VERIFIED (regulatory or site) critical rule is triggered by a
 *               valid reading in the evaluation window.
 *   2. CAUTION  data quality is inadequate (stale, missing, invalid,
 *               conflicting), a required rule is not configured/verified, a
 *               verified warning rule or any provisional rule is triggered,
 *               or nothing verified could be checked.
 *   3. SAFE     the required measurements are current and valid, every required
 *               rule is configured, verified and checked, and every check passed.
 *               Even then this is not a certification that the mine is safe.
 *
 * The evaluation window is (newest timestamp − evaluationWindowMinutes, newest].
 */
import type { Dataset } from "@/lib/dataset";
import {
  medianSamplingIntervalMs,
  movingAverage,
  parseTimestamp,
} from "@/lib/moving-average";
import {
  VERIFICATION_LABEL,
  type Operator,
  type ParameterDef,
  type RulesConfig,
  type SafetyRule,
  type VerificationStatus,
} from "./config";
import { MIN_OXYGEN_DEFICIENCY, deriveRatios } from "./derived";
import { convert } from "./units";

export type SafetyStatus = "SAFE" | "CAUTION" | "UNSAFE";
export const SAFETY_STATUSES: readonly SafetyStatus[] = [
  "SAFE",
  "CAUTION",
  "UNSAFE",
];
export const SAFETY_STATUS_LABEL: Record<SafetyStatus, string> = {
  SAFE: "SAFE",
  CAUTION: "CAUTION",
  UNSAFE: "UNSAFE",
};

export type RuleResult = "ok" | "warning" | "critical" | "not_evaluated";

export interface RuleEvaluation {
  ruleId: string;
  parameter: string;
  /** The data field's unit; thresholds below are converted into it. */
  unit: string;
  ruleUnit: string;
  operator: Operator;
  warning: number | null;
  critical: number | null;
  severity: "critical" | "warning" | "monitoring";
  verificationStatus: VerificationStatus;
  enabled: boolean;
  requiredForSafe: boolean;
  sourceDocument: string;
  sourceClause: string;
  sourceUrl: string | null;
  officialCopyChecked: boolean | null;
  contextNote: string | null;
  result: RuleResult;
  notEvaluatedReason: string | null;
  /** What this rule contributes to the status. */
  effect: "UNSAFE" | "CAUTION" | "none";
  latestValue: number | boolean | null;
  latestAt: string | null;
  worstValue: number | boolean | null;
  worstAt: string | null;
  movingAvg1h: number | null;
  explanation: string;
}

export type DataQualityCode =
  | "empty"
  | "no_time_column"
  | "bad_timestamps"
  | "stale_data"
  | "future_timestamps"
  | "sampling_interval"
  | "missing_parameter"
  | "missing_latest"
  | "stale_parameter"
  | "invalid_values"
  | "conflict"
  | "derived_mismatch"
  | "missing_values"
  | "column_name_case";

export interface DataQualityWarning {
  code: DataQualityCode;
  message: string;
  parameter?: string;
  /** True when this warning prevents a SAFE classification. */
  blocksSafe: boolean;
}

export interface SafetyAssessment {
  status: SafetyStatus;
  /** Why the status was chosen, most important first. */
  reasons: string[];
  evaluations: RuleEvaluation[];
  dataQuality: DataQualityWarning[];
  /** Rule-based next steps (available without any AI model). */
  nextActions: string[];
  triggeredRuleIds: string[];
  /** Newest valid timestamp, as written in the file, and as ISO. */
  latestTimestamp: string | null;
  latestTimestampIso: string | null;
  dataAgeMinutes: number | null;
  isStale: boolean;
  samplingIntervalSeconds: number | null;
  rulesSummary: {
    total: number;
    enabled: number;
    evaluated: number;
    verifiedRegulatory: number;
    verifiedSite: number;
    provisional: number;
    requiresVerification: number;
  };
  /** Required rules that are not configured, verified or checkable. */
  unverifiedRequired: string[];
  /** Data fields that no rule checked. */
  unassessedParameters: string[];
  configName: string;
  /** Some verified rules were checked against an unofficial copy of the source. */
  officialCopyCaveat: boolean;
}

const isVerified = (s: VerificationStatus) =>
  s === "verified_regulatory" || s === "verified_site";
const isAbove = (op: Operator) =>
  op === "greater_than" || op === "greater_than_or_equal";

export function breaches(v: number, limit: number, op: Operator): boolean {
  switch (op) {
    case "greater_than":
      return v > limit;
    case "greater_than_or_equal":
      return v >= limit;
    case "less_than":
      return v < limit;
    case "less_than_or_equal":
      return v <= limit;
    default:
      return false;
  }
}

const OP_TEXT: Record<Operator, string> = {
  greater_than: ">",
  greater_than_or_equal: "≥",
  less_than: "<",
  less_than_or_equal: "≤",
  is_true: "= detected",
  steady_increase: "steady increase",
};
export const operatorText = (op: Operator) => OP_TEXT[op];

/** Parse a yes/no detection. Returns null for anything that is not clearly yes or no. */
export function parseDetection(v: unknown): boolean | null {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y", "detected", "positive"].includes(s))
    return true;
  if (["0", "false", "no", "n", "not detected", "negative", "none"].includes(s))
    return false;
  return null;
}

const fmt = (v: number | boolean | null, unit: string) => {
  if (v === null) return "n/a";
  if (typeof v === "boolean") return v ? "DETECTED" : "not detected";
  return `${Number(v.toPrecision(6))}${unit && unit !== "ratio" && unit !== "index" ? ` ${unit}` : ""}`;
};
const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 120) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
};

export function assessSafety(
  dataset: Dataset,
  config: RulesConfig,
  options: { now?: number } = {},
): SafetyAssessment {
  const now = options.now ?? Date.now();
  const dq = config.dataQuality;
  const quality: DataQualityWarning[] = [];
  const addDq = (w: DataQualityWarning) => {
    if (!quality.some((q) => q.message === w.message)) quality.push(w);
  };
  const tc = dataset.timeColumn;
  const rows = dataset.rows;

  // ---- Timestamps -------------------------------------------------------
  const times = rows.map((r) => (tc ? parseTimestamp(r[tc]) : null));
  const valid = times
    .map((t, i) => ({ t, i }))
    .filter((x): x is { t: number; i: number } => x.t !== null);
  valid.sort((a, b) => a.t - b.t || a.i - b.i);
  const latestT = valid.length ? valid[valid.length - 1]!.t : null;
  const latestIdx = valid.length ? valid[valid.length - 1]!.i : -1;
  const label = (i: number) =>
    tc ? String(rows[i]?.[tc] ?? `row ${i + 1}`) : `row ${i + 1}`;
  const latestTimestamp = latestIdx >= 0 ? label(latestIdx) : null;

  if (rows.length === 0)
    addDq({
      code: "empty",
      message: "The file has no data rows.",
      blocksSafe: true,
    });
  else if (!tc)
    addDq({
      code: "no_time_column",
      message:
        "No timestamp column was found, so it cannot be confirmed that readings are current.",
      blocksSafe: true,
    });
  else if (latestT === null)
    addDq({
      code: "bad_timestamps",
      message: `No valid timestamps in "${tc}".`,
      blocksSafe: true,
    });
  else if (valid.length < rows.length)
    addDq({
      code: "bad_timestamps",
      message: `${rows.length - valid.length} row(s) have an unreadable timestamp and were ignored.`,
      blocksSafe: false,
    });

  const dataAgeMs = latestT === null ? null : now - latestT;
  let isStale = latestT === null;
  if (dataAgeMs !== null) {
    if (dataAgeMs > dq.staleAfterMinutes * 60_000) {
      isStale = true;
      addDq({
        code: "stale_data",
        message: `Newest reading (${latestTimestamp}) is ${ago(dataAgeMs)} old; data older than ${dq.staleAfterMinutes} min is stale, so it does not describe current conditions.`,
        blocksSafe: true,
      });
    } else if (dataAgeMs < -5 * 60_000) {
      addDq({
        code: "future_timestamps",
        message: `Newest timestamp (${latestTimestamp}) is in the future; check the logger clock or time zone.`,
        blocksSafe: true,
      });
    }
  }

  const inferredMs = medianSamplingIntervalMs(valid.map((v) => v.t));
  const expectedMs = dq.expectedSamplingIntervalSeconds
    ? dq.expectedSamplingIntervalSeconds * 1000
    : null;
  if (expectedMs && inferredMs && inferredMs > 2 * expectedMs) {
    addDq({
      code: "sampling_interval",
      message: `Readings arrive every ${Math.round(inferredMs / 1000)} s, slower than the expected ${dq.expectedSamplingIntervalSeconds} s.`,
      blocksSafe: true,
    });
  }
  const intervalMs = expectedMs ?? inferredMs;
  const paramStaleMs = intervalMs
    ? Math.max(dq.parameterStaleFactor * intervalMs, 60_000)
    : dq.staleAfterMinutes * 60_000;

  const windowMs = dq.evaluationWindowMinutes * 60_000;
  const inWindow = (i: number) => {
    if (latestT === null) return i === rows.length - 1; // no time: newest row only
    const t = times[i];
    return (
      t !== null && t !== undefined && t > latestT - windowMs && t <= latestT
    );
  };

  // ---- Columns ----------------------------------------------------------
  const columnByName = new Map(dataset.columns.map((c) => [c.name, c.name]));
  const columnByLower = new Map(
    dataset.columns.map((c) => [c.name.toLowerCase(), c.name]),
  );
  const findColumn = (name: string) =>
    columnByName.get(name) ?? columnByLower.get(name.toLowerCase()) ?? null;
  const paramDef = new Map<string, ParameterDef>(
    config.parameters.map((p) => [p.name, p]),
  );

  /** Valid value of a parameter in a row, or null (missing/invalid). */
  const readValue = (
    def: ParameterDef,
    raw: unknown,
  ): { value: number | boolean | null; invalid: boolean } => {
    if (raw === null || raw === undefined || raw === "")
      return { value: null, invalid: false };
    if (def.type === "boolean") {
      const b = parseDetection(raw);
      return b === null
        ? { value: null, invalid: true }
        : { value: b, invalid: false };
    }
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) return { value: null, invalid: true };
    if (
      (def.min !== undefined && n < def.min) ||
      (def.max !== undefined && n > def.max)
    )
      return { value: null, invalid: true };
    return { value: n, invalid: false };
  };

  // Per-parameter scans are shared by all rules on that parameter.
  interface Scan {
    column: string;
    def: ParameterDef;
    series: { i: number; t: number | null; value: number | boolean }[]; // valid values, time order
    invalidInWindow: number;
    missingLatest: boolean;
    conflict: boolean;
    ma: number | null;
  }
  const scans = new Map<string, Scan | null>();
  const order =
    latestT === null ? rows.map((_, i) => i) : valid.map((v) => v.i);
  const scanParameter = (name: string): Scan | null => {
    if (scans.has(name)) return scans.get(name)!;
    const def = paramDef.get(name);
    const column = findColumn(name);
    if (!def || !column) {
      scans.set(name, null);
      return null;
    }
    const series: Scan["series"] = [];
    let invalidInWindow = 0;
    const seen = new Map<number, number | boolean>();
    let conflict = false;
    for (const i of order) {
      const { value, invalid } = readValue(def, rows[i]?.[column]);
      if (invalid && inWindow(i)) invalidInWindow++;
      if (value === null) continue;
      const t = times[i] ?? null;
      if (t !== null && inWindow(i)) {
        const prev = seen.get(t);
        if (prev !== undefined && prev !== value) conflict = true;
        seen.set(t, value);
      }
      series.push({ i, t, value });
    }
    const latestRow = latestIdx >= 0 ? latestIdx : rows.length - 1;
    const missingLatest =
      latestRow >= 0 &&
      readValue(def, rows[latestRow]?.[column]).value === null;
    let ma: number | null = null;
    if (def.type === "number" && tc && series.length) {
      const pts = series.map((s) => ({ t: s.t, value: s.value as number }));
      ma = movingAverage(pts)[pts.length - 1]?.avg ?? null;
    }
    const scan: Scan = {
      column,
      def,
      series,
      invalidInWindow,
      missingLatest,
      conflict,
      ma,
    };
    scans.set(name, scan);
    if (column !== name)
      addDq({
        code: "column_name_case",
        message: `Column "${column}" was matched to parameter ${name} ignoring letter case.`,
        parameter: name,
        blocksSafe: false,
      });
    return scan;
  };

  // ---- Rules ------------------------------------------------------------
  const evaluations: RuleEvaluation[] = [];
  const unsafe: string[] = [];
  const caution: string[] = [];
  const unverifiedRequired: string[] = [];
  const checked = new Set<string>();
  const degree = config.mineContext.degreeOfGassiness;

  // Fire-gas ratios from the newest row, for Graham's applicability and cross-checks.
  const latestRow = latestIdx >= 0 ? rows[latestIdx] : rows[rows.length - 1];
  const gas = (name: string) => {
    const s = scanParameter(name);
    if (!s || !latestRow) return null;
    const v = readValue(s.def, latestRow[s.column]).value;
    return typeof v === "number" ? v : null;
  };
  const derived =
    latestRow &&
    deriveRatios({
      O2_vol_pct: gas("O2_vol_pct"),
      CO2_vol_pct: gas("CO2_vol_pct"),
      CH4_vol_pct: gas("CH4_vol_pct"),
      CO_ppm: gas("CO_ppm"),
      H2_ppm: gas("H2_ppm"),
      C2H4_ppm: gas("C2H4_ppm"),
      C2H2_ppm: gas("C2H2_ppm"),
    });

  for (const rule of config.rules) {
    const def = paramDef.get(rule.parameter);
    const fieldUnit = def?.unit ?? rule.unit;
    const conv = (v: number | null) =>
      v === null || rule.unit === "boolean"
        ? v
        : convert(v, rule.unit, fieldUnit);
    const ev: RuleEvaluation = {
      ruleId: rule.id,
      parameter: rule.parameter,
      unit: fieldUnit,
      ruleUnit: rule.unit,
      operator: rule.operator,
      warning: conv(rule.warningThreshold),
      critical: conv(rule.criticalThreshold),
      severity: rule.severity,
      verificationStatus: rule.verificationStatus,
      enabled: rule.enabled,
      requiredForSafe: rule.requiredForSafe,
      sourceDocument: rule.source.document,
      sourceClause: rule.source.clause,
      sourceUrl: rule.source.url ?? null,
      officialCopyChecked:
        rule.source.verification?.officialCopyChecked ?? null,
      contextNote: rule.context.note ?? null,
      result: "not_evaluated",
      notEvaluatedReason: null,
      effect: "none",
      latestValue: null,
      latestAt: null,
      worstValue: null,
      worstAt: null,
      movingAvg1h: null,
      explanation: "",
    };
    const skip = (reason: string) => {
      ev.notEvaluatedReason = reason;
      ev.explanation = reason;
      if (rule.requiredForSafe) {
        unverifiedRequired.push(rule.id);
        caution.push(
          `Required check "${rule.id}" (${rule.parameter}) was not performed: ${reason}`,
        );
      }
      evaluations.push(ev);
    };

    const scan = scanParameter(rule.parameter);
    if (scan) {
      const last = scan.series[scan.series.length - 1];
      if (last) {
        ev.latestValue = last.value;
        ev.latestAt = label(last.i);
      }
      ev.movingAvg1h = scan.ma;
    }

    if (rule.verificationStatus === "requires_verification") {
      skip("threshold not verified (requires verification)");
      continue;
    }
    if (!rule.enabled) {
      skip(
        rule.verificationStatus === "provisional"
          ? "provisional rule, disabled by default"
          : `disabled: ${rule.context.note ?? "not applicable to this site"}`,
      );
      continue;
    }
    if (
      rule.context.gassinessDegree &&
      rule.context.gassinessDegree !== degree
    ) {
      ev.notEvaluatedReason =
        degree === null
          ? `applies only to degree ${rule.context.gassinessDegree} gassy mines; degree of gassiness is not set`
          : `applies only to degree ${rule.context.gassinessDegree} gassy mines (this mine: degree ${degree})`;
      ev.explanation = ev.notEvaluatedReason;
      evaluations.push(ev);
      continue;
    }
    if (!scan) {
      addDq({
        code: "missing_parameter",
        message: `${rule.parameter} is not in this data, so rule "${rule.id}" was not checked.`,
        parameter: rule.parameter,
        blocksSafe: rule.requiredForSafe || isVerified(rule.verificationStatus),
      });
      skip(`${rule.parameter} is not in this data`);
      continue;
    }
    checked.add(scan.column);

    // Data quality for this parameter.
    const blocks = rule.requiredForSafe || isVerified(rule.verificationStatus);
    if (scan.invalidInWindow > 0)
      addDq({
        code: "invalid_values",
        message: `${rule.parameter}: ${scan.invalidInWindow} invalid reading(s) in the evaluation window were ignored.`,
        parameter: rule.parameter,
        blocksSafe: blocks,
      });
    if (scan.conflict)
      addDq({
        code: "conflict",
        message: `${rule.parameter}: different values were logged for the same timestamp.`,
        parameter: rule.parameter,
        blocksSafe: blocks,
      });
    if (scan.missingLatest)
      addDq({
        code: "missing_latest",
        message: `${rule.parameter} is missing or invalid in the newest reading (${latestTimestamp ?? "last row"}); a missing reading is not treated as normal.`,
        parameter: rule.parameter,
        blocksSafe: blocks,
      });
    const lastValid = scan.series[scan.series.length - 1];
    if (
      lastValid &&
      latestT !== null &&
      lastValid.t !== null &&
      latestT - lastValid.t > paramStaleMs
    ) {
      addDq({
        code: "stale_parameter",
        message: `${rule.parameter}: last valid reading (${label(lastValid.i)}) is ${ago(latestT - lastValid.t)} older than the newest data.`,
        parameter: rule.parameter,
        blocksSafe: blocks,
      });
    }

    // Graham's ratio is not meaningful at small oxygen deficiency (CIMFR).
    if (rule.parameter === "Grahams_Ratio" && derived && !derived.reliable) {
      skip(
        `oxygen deficiency is ${derived.oxygenDeficiency.toFixed(2)}%, below ${MIN_OXYGEN_DEFICIENCY}%, so Graham's ratio is not meaningful (CIMFR)`,
      );
      continue;
    }

    const windowSeries = scan.series.filter((s) => inWindow(s.i));
    if (windowSeries.length === 0) {
      addDq({
        code: "missing_values",
        message: `${rule.parameter}: no valid reading in the evaluation window.`,
        parameter: rule.parameter,
        blocksSafe: blocks,
      });
      skip(
        `no valid ${rule.parameter} reading in the last ${dq.evaluationWindowMinutes} min`,
      );
      continue;
    }

    // Evaluate.
    let critical = false;
    let warning = false;
    let detail = "";
    if (rule.operator === "is_true") {
      const hit = [...windowSeries].reverse().find((s) => s.value === true);
      ev.worstValue = hit ? true : false;
      ev.worstAt = hit ? label(hit.i) : null;
      if (hit) {
        if (rule.severity === "critical") critical = true;
        else warning = true;
        detail = `positive detection at ${label(hit.i)}`;
      }
    } else if (rule.operator === "steady_increase") {
      const n = rule.consecutiveIncreases ?? 3;
      const tail = scan.series.slice(-(n + 1)).map((s) => s.value as number);
      const rising =
        tail.length === n + 1 &&
        tail.every((v, k) => k === 0 || v > tail[k - 1]!);
      ev.worstValue =
        (scan.series[scan.series.length - 1]?.value as number) ?? null;
      ev.worstAt = ev.latestAt;
      if (rising) {
        warning = true;
        detail = `${n} successive increases (${tail.map((v) => Number(v.toPrecision(4))).join(" → ")})`;
      }
    } else {
      const nums = windowSeries as { i: number; value: number }[];
      const worst = nums.reduce((a, b) =>
        isAbove(rule.operator)
          ? b.value > a.value
            ? b
            : a
          : b.value < a.value
            ? b
            : a,
      );
      ev.worstValue = worst.value;
      ev.worstAt = label(worst.i);
      if (
        ev.critical !== null &&
        breaches(worst.value, ev.critical, rule.operator)
      ) {
        critical = true;
        detail = `${fmt(worst.value, fieldUnit)} at ${label(worst.i)} ${OP_TEXT[rule.operator]} critical ${fmt(ev.critical, fieldUnit)}`;
      } else if (
        ev.warning !== null &&
        breaches(worst.value, ev.warning, rule.operator)
      ) {
        warning = true;
        detail = `${fmt(worst.value, fieldUnit)} at ${label(worst.i)} ${OP_TEXT[rule.operator]} warning ${fmt(ev.warning, fieldUnit)}`;
      }
      // A critical breach earlier in the file (outside the window).
      if (!critical && ev.critical !== null) {
        const earlier = scan.series
          .filter(
            (s) =>
              !inWindow(s.i) &&
              breaches(s.value as number, ev.critical!, rule.operator),
          )
          .pop();
        if (earlier && isVerified(rule.verificationStatus)) {
          caution.push(
            `${rule.parameter}: ${fmt(earlier.value as number, fieldUnit)} at ${label(earlier.i)} breached the critical limit earlier in the file (${rule.source.clause}).`,
          );
        }
      }
    }

    const tag = `${rule.parameter} [${rule.id}, ${VERIFICATION_LABEL[rule.verificationStatus]}]`;
    if (critical) {
      ev.result = "critical";
      if (isVerified(rule.verificationStatus)) {
        ev.effect = "UNSAFE";
        unsafe.push(`${tag}: ${detail} — ${rule.source.clause}.`);
      } else {
        ev.effect = "CAUTION";
        caution.push(
          `${tag}: ${detail} (provisional rule: needs verification, cannot set UNSAFE).`,
        );
      }
    } else if (warning) {
      ev.result = "warning";
      ev.effect = "CAUTION";
      caution.push(`${tag}: ${detail}.`);
    } else {
      ev.result = "ok";
    }
    ev.explanation =
      ev.result === "ok"
        ? `Within limits in the last ${dq.evaluationWindowMinutes} min (worst ${fmt(ev.worstValue, fieldUnit)}).`
        : `${detail}. ${rule.explanation}`;
    if (rule.requiredForSafe && !isVerified(rule.verificationStatus)) {
      unverifiedRequired.push(rule.id);
      caution.push(
        `Required check "${rule.id}" is ${VERIFICATION_LABEL[rule.verificationStatus].toLowerCase()}, not verified.`,
      );
    }
    evaluations.push(ev);
  }

  // ---- Derived indicators: supplied vs computed -----------------------------
  if (derived && derived.reliable && latestRow) {
    const tol = dq.derivedIndicatorTolerancePct / 100;
    const check = (name: string, computed: number | null) => {
      const supplied = gas(name);
      if (supplied === null || computed === null) return;
      const close = (a: number, b: number) =>
        Math.abs(a - b) <= Math.max(tol * Math.abs(b), 0.01);
      if (close(supplied, computed)) return;
      const asFraction =
        name === "Grahams_Ratio" && close(supplied, computed / 100);
      addDq({
        code: "derived_mismatch",
        message: asFraction
          ? `Grahams_Ratio (${supplied}) looks like a fraction, but the configured unit is % (computed ${computed.toFixed(3)}%). Check how the ratio is produced.`
          : `${name} in the data (${supplied}) disagrees with the value computed from the gas readings (${computed.toFixed(3)}) by more than ${dq.derivedIndicatorTolerancePct}%.`,
        parameter: name,
        blocksSafe: true,
      });
    };
    check("Grahams_Ratio", derived.grahamsRatio);
    check("Trickett_Ratio", derived.trickettRatio);
  }

  // ---- Status -----------------------------------------------------------
  const verifiedChecked = evaluations.filter(
    (e) => e.result !== "not_evaluated" && isVerified(e.verificationStatus),
  );
  const blocking = quality.filter((q) => q.blocksSafe);
  let status: SafetyStatus;
  let reasons: string[];
  const dqReasons = blocking.map((q) => `Data quality: ${q.message}`);
  if (unsafe.length) {
    status = "UNSAFE";
    reasons = [...unsafe, ...caution, ...dqReasons];
  } else if (
    caution.length ||
    blocking.length ||
    verifiedChecked.length === 0
  ) {
    status = "CAUTION";
    reasons = [...caution, ...dqReasons];
    if (verifiedChecked.length === 0)
      reasons.push("No verified rule could be checked against this data.");
  } else {
    status = "SAFE";
    reasons = [
      `All ${verifiedChecked.length} verified check(s) passed on current data (newest reading ${latestTimestamp}).`,
      "This is a rule-based check of the supplied readings, not a certification that the mine is safe.",
    ];
  }
  const officialCopyCaveat = evaluations.some(
    (e) =>
      e.enabled &&
      isVerified(e.verificationStatus) &&
      e.officialCopyChecked === false,
  );
  if (officialCopyCaveat) {
    reasons.push(
      "Verified regulatory rules were checked against a reproduction of the Gazette, not the official DGMS copy; amendments were not checked (see docs/safety-sources.md).",
    );
  }

  // ---- Next actions -----------------------------------------------------
  const actions: string[] = [];
  for (const e of evaluations) {
    if (e.result === "critical" && e.operator === "is_true") {
      actions.push(
        `Treat ${e.parameter} as a possible fire (${e.sourceClause.split(":")[0]}): follow the site fire procedure, withdraw persons as required, and have a competent person confirm.`,
      );
    } else if (e.result === "critical") {
      actions.push(
        `Verify ${e.parameter} with an independent instrument and act on ${e.sourceClause.split(":")[0]} without delay.`,
      );
    } else if (e.result === "warning") {
      actions.push(
        `Increase monitoring of ${e.parameter} and confirm the trend (${e.sourceClause.split(":")[0]}).`,
      );
    }
  }
  for (const q of blocking) {
    if (q.code === "stale_data")
      actions.push(
        "Check the sensor data feed: the newest reading is not current.",
      );
    else if (
      q.parameter &&
      [
        "missing_latest",
        "stale_parameter",
        "invalid_values",
        "missing_values",
        "missing_parameter",
      ].includes(q.code)
    )
      actions.push(`Check the ${q.parameter} sensor and logger.`);
    else if (q.code === "derived_mismatch")
      actions.push(
        `Check how ${q.parameter} is calculated and that its unit matches the configuration.`,
      );
  }
  for (const id of new Set(unverifiedRequired)) {
    const r = config.rules.find((x) => x.id === id);
    if (r)
      actions.push(
        `Configure a verified ${r.parameter} threshold (site thresholds file) so rule "${id}" can be checked.`,
      );
  }

  // ---- Summary ----------------------------------------------------------
  const presentFields = dataset.columns
    .filter((c) => c.type !== "time")
    .map((c) => c.name);
  const summary = {
    total: config.rules.length,
    enabled: config.rules.filter((r) => r.enabled).length,
    evaluated: evaluations.filter((e) => e.result !== "not_evaluated").length,
    verifiedRegulatory: config.rules.filter(
      (r) => r.enabled && r.verificationStatus === "verified_regulatory",
    ).length,
    verifiedSite: config.rules.filter(
      (r) => r.enabled && r.verificationStatus === "verified_site",
    ).length,
    provisional: config.rules.filter(
      (r) => r.enabled && r.verificationStatus === "provisional",
    ).length,
    requiresVerification: config.rules.filter(
      (r) => r.verificationStatus === "requires_verification",
    ).length,
  };

  return {
    status,
    reasons,
    evaluations,
    dataQuality: quality,
    nextActions: [...new Set(actions)].slice(0, 10),
    triggeredRuleIds: evaluations
      .filter((e) => e.result === "critical" || e.result === "warning")
      .map((e) => e.ruleId),
    latestTimestamp,
    latestTimestampIso:
      latestT === null ? null : new Date(latestT).toISOString(),
    dataAgeMinutes: dataAgeMs === null ? null : Math.round(dataAgeMs / 60_000),
    isStale,
    samplingIntervalSeconds: intervalMs ? Math.round(intervalMs / 1000) : null,
    rulesSummary: summary,
    unverifiedRequired: [...new Set(unverifiedRequired)],
    unassessedParameters: presentFields.filter((f) => !checked.has(f)),
    configName: config.name,
    officialCopyCaveat,
  };
}

const clipText = (t: string, n = 300) =>
  t.length > n ? `${t.slice(0, n - 1)}…` : t;

/** Size-limited copy for sending to the analyst (keeps the prompt small). */
export function compactAssessment(a: SafetyAssessment): SafetyAssessment {
  // Keep evaluated and required rules first; drop disabled monitoring rows beyond the limit.
  const rank = (e: RuleEvaluation) =>
    e.result === "critical"
      ? 0
      : e.result === "warning"
        ? 1
        : e.result === "ok"
          ? 2
          : e.requiredForSafe
            ? 3
            : 4;
  return {
    ...a,
    reasons: a.reasons.slice(0, 10).map((r) => clipText(r)),
    evaluations: [...a.evaluations]
      .sort((x, y) => rank(x) - rank(y))
      .slice(0, 16)
      .map((e) => ({
        ...e,
        explanation: clipText(e.explanation),
        sourceDocument: clipText(e.sourceDocument, 200),
        sourceClause: clipText(e.sourceClause, 300),
        contextNote: e.contextNote ? clipText(e.contextNote, 200) : null,
        notEvaluatedReason: e.notEvaluatedReason
          ? clipText(e.notEvaluatedReason, 200)
          : null,
      })),
    dataQuality: a.dataQuality
      .slice(0, 10)
      .map((q) => ({ ...q, message: clipText(q.message) })),
    nextActions: a.nextActions.slice(0, 8).map((n) => clipText(n)),
    unassessedParameters: a.unassessedParameters.slice(0, 30),
  };
}
