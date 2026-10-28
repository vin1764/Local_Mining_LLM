/**
 * Deterministic safety classification. The language model never decides the
 * status; it only explains the result of this function.
 *
 * Priority order (first match wins):
 *   1. UNSAFE             a configured critical threshold is breached by a
 *                         valid reading in the current window.
 *   2. INSUFFICIENT_DATA  no applicable verified thresholds, a required
 *                         parameter is missing, readings are stale, invalid,
 *                         conflicting, or the data is not current.
 *   3. CAUTION            a warning threshold is breached, a critical breach
 *                         happened earlier in the file, an abnormal reading
 *                         (|z| ≥ 3) needs verification, or sensors disagree.
 *   4. SAFE               every applicable configured check passed on
 *                         adequate, current data. Even then this is not a
 *                         certification that the mine is safe.
 *
 * "Current window" = readings in (last timestamp − 60 min, last timestamp].
 */
import {
  ASSESSMENT_SETTINGS,
  type AssessmentSettings,
} from "@/config/safety-rules";
import type { Dataset } from "@/lib/dataset";
import { movingAverage, parseTimestamp } from "@/lib/moving-average";
import type { SafetyRule } from "./rules";

export type SafetyStatus = "SAFE" | "CAUTION" | "UNSAFE" | "INSUFFICIENT_DATA";
export type RuleLevel =
  "ok" | "warning" | "critical" | "no_data" | "stale" | "invalid";

export const SAFETY_STATUS_LABEL: Record<SafetyStatus, string> = {
  SAFE: "SAFE",
  CAUTION: "CAUTION",
  UNSAFE: "UNSAFE",
  INSUFFICIENT_DATA: "INSUFFICIENT DATA",
};

export interface RuleEvaluation {
  ruleId: string;
  label: string;
  column: string;
  unit: string;
  direction: "above" | "below";
  warning: number | null;
  critical: number;
  source: string;
  level: RuleLevel;
  /** Latest valid reading of this column and its timestamp label. */
  latestValue: number | null;
  latestAt: string | null;
  /** Most extreme valid reading in the current window (highest for "above"). */
  worstValue: number | null;
  worstAt: string | null;
  /** 1-hour moving average at the latest valid reading. */
  movingAvg1h: number | null;
  explanation: string;
}

export interface SafetyAssessment {
  status: SafetyStatus;
  /** Why the status was chosen, most important first. */
  reasons: string[];
  evaluations: RuleEvaluation[];
  dataQualityNotes: string[];
  /** Rule-based next steps (available without any AI model). */
  nextActions: string[];
  /** Numeric columns no configured rule covers (not assessed). */
  unassessedParameters: string[];
  /** Timestamp label of the newest reading the assessment describes. */
  dataAsOf: string | null;
  rulesSource: string;
  ruleCount: number;
}

const breach = (v: number, limit: number, dir: "above" | "below") =>
  dir === "above" ? v >= limit : v <= limit;
const worse = (a: number, b: number, dir: "above" | "below") =>
  dir === "above" ? a > b : a < b;
const fmt = (v: number | null, unit: string) =>
  v === null ? "n/a" : `${Number(v.toFixed(4))}${unit ? ` ${unit}` : ""}`;
const minutes = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 120) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
};

export function assessSafety(
  dataset: Dataset,
  rules: readonly SafetyRule[],
  options: {
    settings?: AssessmentSettings;
    now?: number;
    rulesSource?: string;
  } = {},
): SafetyAssessment {
  const settings = options.settings ?? ASSESSMENT_SETTINGS;
  const now = options.now ?? Date.now();
  const tc = dataset.timeColumn;
  const critical: string[] = [];
  const insufficient: string[] = [];
  const caution: string[] = [];
  const notes: string[] = [];
  const evaluations: RuleEvaluation[] = [];

  // Timestamps, in row order (rows are already sorted by time).
  const times = dataset.rows.map((r) => (tc ? parseTimestamp(r[tc]) : null));
  const validTimes = times.filter((t): t is number => t !== null);
  const lastT = validTimes.length ? Math.max(...validTimes) : null;
  const lastIdx =
    lastT === null ? dataset.rows.length - 1 : times.lastIndexOf(lastT);
  const label = (i: number) =>
    tc ? String(dataset.rows[i]?.[tc] ?? `row ${i + 1}`) : `row ${i + 1}`;
  const dataAsOf = dataset.rows.length ? label(Math.max(0, lastIdx)) : null;

  if (dataset.rows.length === 0)
    insufficient.push("The file has no data rows.");
  if (!tc) {
    insufficient.push(
      "The file has no time column, so it cannot be confirmed that readings are current.",
    );
  } else if (lastT === null) {
    insufficient.push(`No valid timestamps were found in "${tc}".`);
  } else {
    const unparsed = times.length - validTimes.length;
    if (unparsed > 0)
      notes.push(
        `${unparsed} row(s) have an unreadable timestamp and were ignored.`,
      );
    const age = now - lastT;
    if (age > settings.maxDataAgeMinutes * 60_000) {
      insufficient.push(
        `The newest reading (${dataAsOf}) is ${minutes(age)} old, so it does not describe current conditions.`,
      );
    } else if (age < -5 * 60_000) {
      notes.push(
        `The newest timestamp (${dataAsOf}) is in the future; check the logger clock.`,
      );
    }
  }

  const windowStart =
    lastT === null ? null : lastT - settings.currentWindowMinutes * 60_000;
  const inWindow = (i: number) => {
    if (windowStart === null || lastT === null) return i === lastIdx; // no time: latest row only
    const t = times[i];
    return t !== null && t !== undefined && t > windowStart && t <= lastT;
  };

  if (rules.length === 0) {
    insufficient.unshift(
      "No verified safety thresholds are configured, so no reading can be checked against a limit.",
    );
  }

  const numericByKey = new Map(
    dataset.numericNames.map((n) => [n.toLowerCase(), n]),
  );
  const covered = new Set<string>();

  for (const rule of rules) {
    const cols = rule.columns
      .map((c) => numericByKey.get(c.toLowerCase()))
      .filter((c): c is string => !!c);
    if (cols.length === 0) {
      if (rule.required)
        insufficient.push(
          `Required parameter "${rule.label}" (${rule.columns.join(", ")}) is not in this file.`,
        );
      continue;
    }
    const levels: RuleLevel[] = [];
    for (const col of cols) {
      covered.add(col);
      const stats = dataset.columns.find((c) => c.name === col)?.stats;
      const ev: RuleEvaluation = {
        ruleId: rule.id,
        label: rule.label,
        column: col,
        unit: rule.unit,
        direction: rule.direction,
        warning: rule.warning ?? null,
        critical: rule.critical,
        source: rule.source,
        level: "ok",
        latestValue: null,
        latestAt: null,
        worstValue: null,
        worstAt: null,
        movingAvg1h: null,
        explanation: "",
      };

      let invalidInWindow = 0;
      let validInWindow = 0;
      let latestIdx = -1;
      let worstIdx = -1;
      let earlierCriticalIdx = -1;
      let abnormalIdx = -1;
      const valid = (v: unknown): v is number =>
        typeof v === "number" &&
        Number.isFinite(v) &&
        (!rule.validRange ||
          (v >= rule.validRange[0] && v <= rule.validRange[1]));

      dataset.rows.forEach((row, i) => {
        const v = row[col];
        const current = inWindow(i);
        if (!valid(v)) {
          if (current && v !== null && v !== undefined) invalidInWindow++;
          return;
        }
        if (tc && times[i] === null) return;
        if (
          latestIdx === -1 ||
          (times[i] ?? i) >= (times[latestIdx] ?? latestIdx)
        )
          latestIdx = i;
        if (current) {
          validInWindow++;
          if (
            worstIdx === -1 ||
            worse(v, dataset.rows[worstIdx]![col] as number, rule.direction)
          )
            worstIdx = i;
          if (
            stats &&
            stats.std > 0 &&
            Math.abs((v - stats.mean) / stats.std) >= 3
          )
            abnormalIdx = i;
        } else if (breach(v, rule.critical, rule.direction)) {
          earlierCriticalIdx = i;
        }
      });

      if (latestIdx >= 0) {
        ev.latestValue = dataset.rows[latestIdx]![col] as number;
        ev.latestAt = label(latestIdx);
        if (tc) {
          const ma = movingAverage(
            dataset.rows.map((r, i) => ({
              t: times[i] ?? null,
              value: valid(r[col]) ? (r[col] as number) : null,
            })),
          );
          ev.movingAvg1h = ma[latestIdx]?.avg ?? null;
        }
      }
      if (worstIdx >= 0) {
        ev.worstValue = dataset.rows[worstIdx]![col] as number;
        ev.worstAt = label(worstIdx);
      }

      const name = `${rule.label} (${col})`;
      const limitText = `${rule.direction === "above" ? "≥" : "≤"} ${fmt(rule.critical, rule.unit)}`;

      // Duplicate timestamps with different values are conflicting readings.
      if (tc) {
        const seen = new Map<number, number>();
        let conflict = false;
        dataset.rows.forEach((r, i) => {
          const t = times[i];
          const v = r[col];
          if (t === null || t === undefined || !inWindow(i) || !valid(v))
            return;
          const prev = seen.get(t);
          if (prev !== undefined && prev !== v) conflict = true;
          seen.set(t, v);
        });
        if (conflict) {
          notes.push(
            `${name}: different values were logged for the same timestamp.`,
          );
          insufficient.push(
            `${name} has conflicting readings at the same timestamp.`,
          );
        }
      }

      if (
        ev.worstValue !== null &&
        breach(ev.worstValue, rule.critical, rule.direction)
      ) {
        ev.level = "critical";
        ev.explanation = `${fmt(ev.worstValue, rule.unit)} at ${ev.worstAt} breaches the critical limit (${limitText}; ${rule.source}).`;
        critical.push(`${name}: ${ev.explanation}`);
      } else if (latestIdx === -1 || validInWindow === 0) {
        ev.level = invalidInWindow > 0 ? "invalid" : "no_data";
        ev.explanation =
          invalidInWindow > 0
            ? `All ${invalidInWindow} reading(s) in the current window are invalid.`
            : "No valid reading in the current window.";
        insufficient.push(`${name}: ${ev.explanation}`);
      } else if (
        tc &&
        lastT !== null &&
        times[latestIdx] !== null &&
        lastT - (times[latestIdx] as number) >
          (rule.maxStalenessMinutes ?? settings.defaultMaxStalenessMinutes) *
            60_000
      ) {
        ev.level = "stale";
        ev.explanation = `Last valid reading (${ev.latestAt}) is ${minutes(lastT - (times[latestIdx] as number))} older than the rest of the data.`;
        insufficient.push(`${name}: ${ev.explanation}`);
      } else if (
        rule.warning !== undefined &&
        ev.worstValue !== null &&
        breach(ev.worstValue, rule.warning, rule.direction)
      ) {
        ev.level = "warning";
        ev.explanation = `${fmt(ev.worstValue, rule.unit)} at ${ev.worstAt} is at or beyond the warning level (${rule.direction === "above" ? "≥" : "≤"} ${fmt(rule.warning, rule.unit)}; ${rule.source}).`;
        caution.push(`${name}: ${ev.explanation}`);
      } else {
        ev.level = "ok";
        ev.explanation = `Within limits in the current window (worst ${fmt(ev.worstValue, rule.unit)}; critical ${limitText}).`;
      }

      if (invalidInWindow > 0 && ev.level !== "invalid") {
        notes.push(
          `${name}: ${invalidInWindow} invalid reading(s) in the current window were ignored.`,
        );
        if (ev.level === "ok")
          caution.push(
            `${name}: some readings in the current window are invalid and need checking.`,
          );
      }
      if (earlierCriticalIdx >= 0 && ev.level !== "critical") {
        caution.push(
          `${name}: ${fmt(dataset.rows[earlierCriticalIdx]![col] as number, rule.unit)} at ${label(earlierCriticalIdx)} breached the critical limit earlier in the file.`,
        );
      }
      if (abnormalIdx >= 0 && ev.level === "ok") {
        caution.push(
          `${name}: an abnormal reading (|z| ≥ 3) at ${label(abnormalIdx)} needs verification.`,
        );
      }
      levels.push(ev.level);
      evaluations.push(ev);
    }
    // Several sensors for the same rule that disagree.
    if (
      new Set(levels).size > 1 &&
      levels.some((l) => l === "critical" || l === "warning")
    ) {
      notes.push(
        `Sensors for "${rule.label}" disagree (${cols.join(", ")}); the worst reading was used.`,
      );
      if (!levels.includes("critical"))
        caution.push(
          `Sensors for "${rule.label}" disagree and need cross-checking.`,
        );
    }
  }

  const unassessed = dataset.numericNames.filter((n) => !covered.has(n));
  if (rules.length > 0 && covered.size === 0) {
    insufficient.push(
      "None of the configured thresholds apply to the parameters in this file.",
    );
  }
  if (unassessed.length > 0 && covered.size > 0) {
    notes.push(
      `No configured threshold for: ${unassessed.join(", ")}. These were not assessed.`,
    );
  }
  for (const c of dataset.columns) {
    if (c.stats && c.stats.missingPct >= 10)
      notes.push(
        `${c.name}: ${Number(c.stats.missingPct.toFixed(1))}% of values are missing.`,
      );
  }

  let status: SafetyStatus;
  let reasons: string[];
  if (critical.length > 0) {
    status = "UNSAFE";
    reasons = [...critical, ...insufficient, ...caution];
  } else if (insufficient.length > 0) {
    status = "INSUFFICIENT_DATA";
    reasons = [...insufficient, ...caution];
  } else if (caution.length > 0) {
    status = "CAUTION";
    reasons = caution;
  } else {
    status = "SAFE";
    reasons = [
      `All ${evaluations.length} configured check(s) passed for readings up to ${dataAsOf}.`,
      "This is a rule-based check of the supplied readings, not a certification that the mine is safe.",
    ];
  }

  const actions: string[] = [];
  for (const e of evaluations) {
    const name = `${e.label} (${e.column})`;
    if (e.level === "critical")
      actions.push(
        `Verify ${name} with an independent instrument and follow the site response procedure for this limit (${e.source}).`,
      );
    else if (e.level === "warning")
      actions.push(
        `Increase monitoring of ${name} and confirm the trend before the next shift.`,
      );
    else if (
      e.level === "stale" ||
      e.level === "no_data" ||
      e.level === "invalid"
    )
      actions.push(
        `Check the ${e.column} sensor and logger: readings are ${e.level === "stale" ? "stale" : e.level === "invalid" ? "invalid" : "missing"}.`,
      );
  }
  if (rules.length === 0)
    actions.push(
      "Add verified site thresholds (src/config/safety-rules.ts or a thresholds file) so readings can be checked against limits.",
    );
  else if (covered.size === 0)
    actions.push(
      "Check that the thresholds file uses the same column names as this CSV.",
    );
  if (
    status === "INSUFFICIENT_DATA" &&
    lastT !== null &&
    now - lastT > settings.maxDataAgeMinutes * 60_000
  )
    actions.push("Load a current log to assess present conditions.");

  return {
    status,
    reasons,
    evaluations,
    dataQualityNotes: [...new Set(notes)],
    nextActions: [...new Set(actions)].slice(0, 8),
    unassessedParameters: unassessed,
    dataAsOf,
    rulesSource:
      options.rulesSource ?? (rules.length ? "configured rules" : "none"),
    ruleCount: rules.length,
  };
}

const clipText = (t: string, n = 300) =>
  t.length > n ? `${t.slice(0, n - 1)}…` : t;

/** Size-limited copy for sending to the analyst (keeps the prompt small). */
export function compactAssessment(a: SafetyAssessment): SafetyAssessment {
  return {
    ...a,
    reasons: a.reasons.slice(0, 8).map((r) => clipText(r)),
    evaluations: a.evaluations.slice(0, 12).map((e) => ({
      ...e,
      explanation: clipText(e.explanation),
      source: clipText(e.source, 200),
    })),
    dataQualityNotes: a.dataQualityNotes.slice(0, 8).map((n) => clipText(n)),
    nextActions: a.nextActions.slice(0, 8).map((n) => clipText(n)),
    unassessedParameters: a.unassessedParameters.slice(0, 30),
  };
}
