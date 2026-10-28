/**
 * Everything about the AI shift report that is independent of the model
 * runtime: input validation, the facts sheet sent to the model, the output
 * JSON schema, and the checks applied to what comes back.
 *
 * Division of labour (small local models misquote numbers):
 * - Code computes every number, writes each finding's measured facts and
 *   assigns its severity with a fixed rule.
 * - The model writes the headline, summary, a hedged explanation per
 *   finding and the recommendations.
 * - Model text that contradicts the computed direction of a trend is
 *   rejected; if it keeps happening, code writes the summary instead.
 * - The safety status comes from the rule-based assessment (lib/safety).
 *   The model only explains it; wording that disagrees is flagged for review.
 */
import { z } from "zod";

import type {
  DatasetInsights,
  DatasetProfile,
  ProfileColumn,
} from "@/lib/dataset";
import type { SafetyStatus } from "@/lib/safety/assess";
import { safetyFacts } from "./prompts";

type Severity = DatasetInsights["findings"][number]["severity"];

/* ============================ Input validation ============================ */

const finite = z.number().finite();
const shortText = z.string().max(300);

const nullableFinite = finite.nullable();
const statusEnum = z.enum(["SAFE", "CAUTION", "UNSAFE"]);
const text = (n: number) => z.string().max(n);
const safetySchema = z.object({
  status: statusEnum,
  reasons: z.array(text(400)).max(20),
  evaluations: z
    .array(
      z.object({
        ruleId: shortText,
        parameter: shortText,
        unit: text(20),
        ruleUnit: text(20),
        operator: z.enum([
          "greater_than",
          "greater_than_or_equal",
          "less_than",
          "less_than_or_equal",
          "is_true",
          "steady_increase",
        ]),
        warning: nullableFinite,
        critical: nullableFinite,
        severity: z.enum(["critical", "warning", "monitoring"]),
        verificationStatus: z.enum([
          "verified_regulatory",
          "verified_site",
          "provisional",
          "requires_verification",
        ]),
        enabled: z.boolean(),
        requiredForSafe: z.boolean(),
        sourceDocument: text(400),
        sourceClause: text(600),
        sourceUrl: text(400).nullable(),
        officialCopyChecked: z.boolean().nullable(),
        contextNote: text(400).nullable(),
        result: z.enum(["ok", "warning", "critical", "not_evaluated"]),
        notEvaluatedReason: text(400).nullable(),
        effect: z.enum(["UNSAFE", "CAUTION", "none"]),
        latestValue: z.union([finite, z.boolean()]).nullable(),
        latestAt: shortText.nullable(),
        worstValue: z.union([finite, z.boolean()]).nullable(),
        worstAt: shortText.nullable(),
        movingAvg1h: nullableFinite,
        explanation: text(1200),
      }),
    )
    .max(40),
  dataQuality: z
    .array(
      z.object({
        code: text(40),
        message: text(400),
        parameter: shortText.optional(),
        blocksSafe: z.boolean(),
      }),
    )
    .max(30),
  nextActions: z.array(text(400)).max(20),
  triggeredRuleIds: z.array(shortText).max(40),
  latestTimestamp: shortText.nullable(),
  latestTimestampIso: shortText.nullable(),
  dataAgeMinutes: finite.nullable(),
  isStale: z.boolean(),
  samplingIntervalSeconds: finite.nullable(),
  rulesSummary: z.object({
    total: z.number().int(),
    enabled: z.number().int(),
    evaluated: z.number().int(),
    verifiedRegulatory: z.number().int(),
    verifiedSite: z.number().int(),
    provisional: z.number().int(),
    requiresVerification: z.number().int(),
  }),
  unverifiedRequired: z.array(shortText).max(40),
  unassessedParameters: z.array(shortText).max(50),
  configName: text(400),
  officialCopyCaveat: z.boolean(),
});

export const profileSchema = z.object({
  name: z.string().min(1).max(260),
  rowCount: z.number().int().nonnegative().max(10_000_000),
  timeColumn: shortText.nullable(),
  timeRange: z.object({ start: shortText, end: shortText }).nullable(),
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        type: z.enum(["number", "time", "category"]),
        unit: z.string().max(20),
        min: finite.optional(),
        max: finite.optional(),
        mean: finite.optional(),
        std: finite.optional(),
        first: finite.optional(),
        last: finite.optional(),
        trendPct: finite.optional(),
        missingPct: finite.optional(),
        anomalyCount: z.number().int().nonnegative().optional(),
        maxAbsZ: finite.optional(),
        movingAvg1h: finite.optional(),
        movingAvg1hCount: z.number().int().nonnegative().optional(),
        distinct: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(500),
  correlations: z
    .array(z.object({ a: shortText, b: shortText, r: finite }))
    .max(50),
  anomalies: z
    .array(
      z.object({
        column: shortText,
        label: shortText,
        value: finite,
        z: finite,
      }),
    )
    .max(100),
  samples: z.object({
    first: z.array(z.string().max(4000)).max(10),
    last: z.array(z.string().max(4000)).max(10),
  }),
  safety: safetySchema.optional(),
});

/* ============================ Deterministic findings ============================ */

export const MAX_PROMPT_COLUMNS = 20;
export const MAX_FINDINGS = 6;

/** Below this absolute % change a parameter is described as flat. */
export const FLAT_TREND_PCT = 2;

/**
 * Statistical severity rule (not a safety rating):
 * - critical: a value at |z| >= 4, or a first-to-last-quarter change of 50% or more
 * - watch:    any |z| >= 3 outlier, a change of 10% or more, or 10%+ missing values
 * - normal:   otherwise
 */
export function severityFor(c: ProfileColumn): Severity {
  const trend = Math.abs(c.trendPct ?? 0);
  const maxZ = c.maxAbsZ ?? 0;
  if (maxZ >= 4 || trend >= 50) return "critical";
  if ((c.anomalyCount ?? 0) > 0 || trend >= 10 || (c.missingPct ?? 0) >= 10)
    return "watch";
  return "normal";
}

function num(v: number | undefined): string {
  if (v === undefined) return "n/a";
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return v.toExponential(3);
  return String(Number(v.toFixed(3)));
}

function withUnit(v: number | undefined, unit: string): string {
  return unit ? `${num(v)} ${unit}` : num(v);
}

export function direction(
  trendPct: number | undefined,
): "rose" | "fell" | "flat" {
  const t = trendPct ?? 0;
  if (Math.abs(t) < FLAT_TREND_PCT) return "flat";
  return t > 0 ? "rose" : "fell";
}

/** One plain-English sentence of measured facts for a numeric parameter. */
export function describeColumn(
  c: ProfileColumn,
  profile: DatasetProfile,
): string {
  const span = profile.timeRange
    ? "from the first to the last quarter of the period"
    : "from the first to the last quarter of the rows";
  const dir = direction(c.trendPct);
  const movement =
    dir === "flat"
      ? `Roughly flat ${span} (${c.trendPct && c.trendPct >= 0 ? "+" : ""}${num(c.trendPct)}%)`
      : `${dir === "rose" ? "Rose" : "Fell"} ${num(Math.abs(c.trendPct ?? 0))}% ${span}`;
  const range = `ranged ${num(c.min)} to ${withUnit(c.max, c.unit)} (mean ${withUnit(c.mean, c.unit)})`;

  const n = c.anomalyCount ?? 0;
  let outliers = "no 3-sigma outliers";
  if (n > 0) {
    const worst = profile.anomalies
      .filter((a) => a.column === c.name)
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
    outliers = `${n} outlier${n === 1 ? "" : "s"} at |z| ≥ 3`;
    if (worst)
      outliers += `, largest ${withUnit(worst.value, c.unit)} at ${worst.label} (z = ${num(worst.z)})`;
  }
  const missing =
    (c.missingPct ?? 0) > 0 ? `; ${num(c.missingPct)}% of values missing` : "";
  return `${movement}; ${range}; ${outliers}${missing}.`;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 2,
  watch: 1,
  normal: 0,
};

export interface PlannedFinding {
  parameter: string;
  severity: Severity;
  observation: string;
}

/** Choose which parameters get a finding and write their measured facts. */
export function planFindings(profile: DatasetProfile): PlannedFinding[] {
  return profile.columns
    .filter((c) => c.type === "number")
    .map((c) => ({ c, severity: severityFor(c) }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        Math.abs(b.c.trendPct ?? 0) - Math.abs(a.c.trendPct ?? 0),
    )
    .slice(0, MAX_FINDINGS)
    .map(({ c, severity }) => ({
      parameter: c.name,
      severity,
      observation: describeColumn(c, profile),
    }));
}

/** Summary and headline written by code, used when the model's text is unreliable. */
export function fallbackSummary(
  profile: DatasetProfile,
  planned: PlannedFinding[],
): { headline: string; summary: string } {
  const numeric = profile.columns.filter((c) => c.type === "number");
  const flagged = planned.filter((f) => f.severity !== "normal").length;
  const period = profile.timeRange
    ? `from ${profile.timeRange.start} to ${profile.timeRange.end}`
    : "in file order";
  const moves = [...numeric]
    .filter((c) => direction(c.trendPct) !== "flat")
    .sort((a, b) => Math.abs(b.trendPct ?? 0) - Math.abs(a.trendPct ?? 0))
    .slice(0, 3)
    .map(
      (c) =>
        `${c.name} ${direction(c.trendPct)} ${num(Math.abs(c.trendPct ?? 0))}%`,
    );
  const outliers = numeric.reduce((s, c) => s + (c.anomalyCount ?? 0), 0);
  const summary = [
    `${profile.rowCount} rows ${period} across ${numeric.length} numeric parameters.`,
    moves.length > 0
      ? `Largest movements: ${moves.join(", ")}.`
      : "No parameter moved by more than 2%.",
    `${outliers} value${outliers === 1 ? "" : "s"} flagged as 3-sigma outliers.`,
  ].join(" ");
  const headline =
    flagged === 0
      ? "All parameters stable over the period"
      : `${flagged} of ${numeric.length} parameters flagged for review`;
  return { headline, summary };
}

/* ============================ Prompt ============================ */

// The system prompt lives in ./prompts.ts (MINING_SYSTEM_PROMPT / buildSystemPrompt).

function rankColumns(columns: ProfileColumn[]): {
  kept: ProfileColumn[];
  omitted: string[];
} {
  const numeric = columns.filter((c) => c.type === "number");
  if (numeric.length <= MAX_PROMPT_COLUMNS)
    return { kept: numeric, omitted: [] };
  const ranked = [...numeric].sort(
    (a, b) =>
      SEVERITY_RANK[severityFor(b)] - SEVERITY_RANK[severityFor(a)] ||
      Math.abs(b.trendPct ?? 0) - Math.abs(a.trendPct ?? 0),
  );
  const keep = new Set(ranked.slice(0, MAX_PROMPT_COLUMNS).map((c) => c.name));
  return {
    kept: numeric.filter((c) => keep.has(c.name)),
    omitted: numeric.filter((c) => !keep.has(c.name)).map((c) => c.name),
  };
}

/** Render the deterministic profile as a compact, readable facts sheet. */
export function buildFactsSheet(profile: DatasetProfile): string {
  const lines: string[] = [];
  lines.push(`FILE: ${profile.name}`);
  lines.push(`ROWS: ${profile.rowCount}`);
  if (profile.timeColumn && profile.timeRange) {
    lines.push(
      `PERIOD: ${profile.timeRange.start} to ${profile.timeRange.end} (rows sorted by ${profile.timeColumn})`,
    );
  } else {
    lines.push("PERIOD: unknown (no time column; rows are in file order)");
  }

  const { kept, omitted } = rankColumns(profile.columns);
  lines.push("");
  lines.push(
    "PARAMETERS (direction compares the mean of the last quarter of rows with the first quarter):",
  );
  if (kept.length === 0) lines.push("- none");
  for (const c of kept) {
    const dir = direction(c.trendPct).toUpperCase();
    const unit = c.unit ? `unit ${c.unit}` : "unit not stated";
    let ma = "";
    if (c.movingAvg1h !== undefined && c.last !== undefined) {
      const diff = c.last - c.movingAvg1h;
      ma = ` Latest ${withUnit(c.last, c.unit)}; 1-hour moving average ${withUnit(c.movingAvg1h, c.unit)} over ${c.movingAvg1hCount ?? "?"} reading(s); latest is ${diff === 0 ? "equal to" : `${num(Math.abs(diff))} ${diff > 0 ? "above" : "below"}`} it.`;
    }
    lines.push(
      `- ${c.name} (${unit}): ${dir}. ${describeColumn(c, profile)}${ma}`,
    );
  }
  if (omitted.length > 0) {
    lines.push(
      `- (${omitted.length} more numeric columns not shown: ${omitted.slice(0, 15).join(", ")}${omitted.length > 15 ? ", ..." : ""})`,
    );
  }

  const categories = profile.columns.filter((c) => c.type === "category");
  if (categories.length > 0) {
    lines.push("");
    lines.push("CATEGORY COLUMNS:");
    for (const c of categories.slice(0, 15)) {
      lines.push(
        `- ${c.name}: ${c.distinct ?? "?"} distinct values in the first 500 rows`,
      );
    }
  }

  lines.push("");
  lines.push(
    "CORRELATIONS (Pearson r, |r| >= 0.35; association only, not cause):",
  );
  if (profile.correlations.length === 0)
    lines.push("- none strong enough to report");
  for (const p of profile.correlations) {
    lines.push(
      `- ${p.a} and ${p.b}: r = ${num(p.r)} (${p.r > 0 ? "move together" : "move in opposite directions"})`,
    );
  }

  lines.push("");
  lines.push(safetyFacts(profile));
  return lines.join("\n");
}

export function buildUserPrompt(
  profile: DatasetProfile,
  planned: PlannedFinding[],
): string {
  return [
    "FACTS:",
    buildFactsSheet(profile),
    "",
    `FINDINGS ALREADY WRITTEN (give one note for each, using these parameter names): ${planned.map((f) => f.parameter).join(", ")}`,
    "",
    "Return JSON with:",
    "- headline: one sentence, at most 12 words.",
    "- summary: 2 to 4 sentences on the period and the main movements, directions copied from FACTS.",
    "- notes: for each finding parameter, one short sentence with a possible explanation or what to check, without numbers. Start with May, Possibly or Could.",
    "- recommendations: 2 to 5 short, concrete checks for the next shift.",
    `- safety_status: exactly "${profile.safety?.status ?? "CAUTION"}" (copied from SAFETY ASSESSMENT).`,
    "- safety_explanation: 1 to 3 sentences explaining that status from the SAFETY ASSESSMENT evidence.",
  ].join("\n");
}

/** JSON schema handed to Ollama's structured-output mode. */
export const insightsJsonSchema = {
  type: "object",
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: { parameter: { type: "string" }, note: { type: "string" } },
        required: ["parameter", "note"],
      },
    },
    recommendations: { type: "array", items: { type: "string" } },
    safety_status: {
      type: "string",
      enum: ["SAFE", "CAUTION", "UNSAFE"],
    },
    safety_explanation: { type: "string" },
  },
  required: [
    "headline",
    "summary",
    "notes",
    "recommendations",
    "safety_status",
    "safety_explanation",
  ],
} as const;

// Lenient on purpose: small models wobble on casing and extra fields.
const rawModelSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  notes: z
    .array(z.object({ parameter: z.string(), note: z.string() }))
    .default([]),
  recommendations: z
    .array(z.union([z.string(), z.object({}).passthrough()]))
    .default([]),
  // Optional and loosely typed: a missing or odd value is a review flag, not a failure.
  safety_status: z.unknown().optional(),
  safety_explanation: z.unknown().optional(),
});

/* ============================ Consistency checks ============================ */

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const UP =
  /\b(increas\w*|rose|rise[sn]?|rising|higher|grew|grow\w*|climb\w*|upward|gain\w*|surg\w*)\b/i;
const DOWN =
  /\b(decreas\w*|fell|fall\w*|drop\w*|lower|declin\w*|reduc\w*|downward|shrank|dip\w*)\b/i;
// Descriptive forms only, so imperatives such as "reduce energy use" in a
// recommendation are not mistaken for a claim about the trend.
const UP_DESC =
  /\b(increased|increasing|rose|risen|rising|grew|growing|climbed|climbing|(increase|rise|growth|climb|surge|gain)s?\s+in)\b/i;
const DOWN_DESC =
  /\b(decreased|decreasing|fell|fallen|falling|dropped|dropping|declined|declining|(decrease|drop|decline|fall|reduction)s?\s+in)\b/i;

function mentionTokens(name: string): string[] {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  const units = new Set(["pct", "percent", "kwh", "ppm", "m3s"]);
  return [
    name.toLowerCase(),
    name.toLowerCase().replace(/[_-]+/g, " "),
    ...words.filter((w) => !units.has(w)),
  ];
}

/**
 * Find clauses that name exactly one parameter and describe it moving in
 * the opposite direction to the computed trend. Returns the offending
 * parameter names (empty when the text is consistent).
 */
export function findDirectionContradictions(
  text: string,
  profile: DatasetProfile,
  mode: "descriptive" | "strict" = "strict",
): string[] {
  const upRe = mode === "strict" ? UP : UP_DESC;
  const downRe = mode === "strict" ? DOWN : DOWN_DESC;
  const numeric = profile.columns.filter((c) => c.type === "number");
  const clauses = text
    .toLowerCase()
    .split(/[.;:!?]|,|\bwhile\b|\bwhereas\b|\bbut\b|\band\b/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = new Set<string>();
  for (const clause of clauses) {
    const mentioned = numeric.filter((c) =>
      mentionTokens(c.name).some((t) => clause.includes(t)),
    );
    if (mentioned.length !== 1) continue;
    const c = mentioned[0]!;
    const dir = direction(c.trendPct);
    const up = upRe.test(clause);
    const down = downRe.test(clause);
    if (up === down) continue;
    if ((dir === "fell" && up) || (dir === "rose" && down)) bad.add(c.name);
  }
  // "X remained stable" when X moved noticeably.
  if (mode === "strict") {
    for (const clause of clauses) {
      if (!STABLE.test(clause) || UP.test(clause) || DOWN.test(clause))
        continue;
      const mentioned = numeric.filter((c) =>
        mentionTokens(c.name).some((t) => clause.includes(t)),
      );
      if (mentioned.length !== 1) continue;
      const c = mentioned[0]!;
      if (Math.abs(c.trendPct ?? 0) >= STABLE_CONTRADICTION_PCT)
        bad.add(c.name);
    }
  }
  return [...bad];
}

const STABLE =
  /\b(stable|steady|unchanged|flat|constant|no (significant )?change)\b/i;
/** A parameter that moved at least this much should not be called stable. */
export const STABLE_CONTRADICTION_PCT = 5;

const NUMBER_TOKEN = /\d+(?:[.,]\d+)*(?:\.\d+)?/g;

function numbersIn(text: string): number[] {
  return (text.match(NUMBER_TOKEN) ?? [])
    .map((t) => Number(t.replace(/,(?=\d{3}\b)/g, "")))
    .filter((n) => Number.isFinite(n));
}

/** Every number that appears in the facts sheet, plus small counts. */
export function allowedNumbers(profile: DatasetProfile): number[] {
  return numbersIn(`${buildFactsSheet(profile)} ${describeAll(profile)}`);
}

function describeAll(profile: DatasetProfile): string {
  return profile.columns
    .filter((c) => c.type === "number")
    .map((c) => describeColumn(c, profile))
    .join(" ");
}

/**
 * Numbers in model text that do not appear in the facts (allowing the model
 * to round a fact to fewer decimals). Small integers (counts) are allowed.
 */
export function findUngroundedNumbers(
  text: string,
  allowed: number[],
): number[] {
  const bad: number[] = [];
  for (const x of numbersIn(text)) {
    if (Number.isInteger(x) && x <= 12) continue;
    const ok = allowed.some((y) => {
      const ay = Math.abs(y);
      if (x === ay) return true;
      for (let d = 0; d <= 3; d++) if (Number(ay.toFixed(d)) === x) return true;
      return false;
    });
    if (!ok) bad.push(x);
  }
  return bad;
}

const NEGATION =
  /\b(not|no|cannot|can't|isn't|aren't|unable|insufficient|unconfirmed|without|nor|never)\b/i;
const HEDGE = /\b(may|might|could|possibly|potential(ly)?|if)\b/i;
// "The mine is safe" overclaims under any status: sensor checks cannot establish it.
const OVERCLAIM_SAFE =
  /\b(mine|site|area|conditions?|operations?|environment|workplace|workings?|it)\s+(is|are|was|were|remains?|appears?|seems?)\s+(to be\s+)?(completely\s+|fully\s+|totally\s+|entirely\s+)?safe\b/i;
const CERTIFIED_SAFE =
  /\bcertif\w*\b[^.]*\bsafe\b|\bsafe to (enter|work|operate|proceed)\b/i;
const CLAIMS_UNSAFE =
  /\bunsafe\b|\bbreach(es|ed)?\b|\bexceed(s|ed)? (the )?(critical |warning |safety )?(limit|threshold)s?\b|\bdanger(ous)?\b/i;

/**
 * Does model text claim a safety state the rule-based status does not
 * support? Returns a short reason, or null when the text is consistent.
 */
export function findSafetyClaimConflict(
  text: string,
  status: SafetyStatus,
): string | null {
  const clauses = text
    .split(/[.;!?]|\bbut\b|\bhowever\b/i)
    .map((c) => c.trim())
    .filter(Boolean);
  for (const c of clauses) {
    if (CERTIFIED_SAFE.test(c) && !NEGATION.test(c)) {
      return "it claims conditions are certified or safe to enter, which sensor data cannot establish";
    }
    if (OVERCLAIM_SAFE.test(c) && !NEGATION.test(c) && !HEDGE.test(c)) {
      return "it states that the mine or conditions are safe, which sensor checks alone cannot establish";
    }
    // "safety" alone (e.g. "safety status") is not a claim; look for "safe".
    const saysSafe =
      /(^|[^a-z])safe(?![a-z])/i.test(c) ||
      /\bno (safety )?(hazards?|concerns|risks?)\b|\ball clear\b/i.test(c);
    if (
      status !== "SAFE" &&
      saysSafe &&
      !/\bunsafe\b/i.test(c) &&
      !NEGATION.test(c) &&
      !HEDGE.test(c)
    ) {
      return `it describes conditions as safe while the rule-based status is ${status}`;
    }
    if (
      status !== "UNSAFE" &&
      CLAIMS_UNSAFE.test(c) &&
      !NEGATION.test(c) &&
      !HEDGE.test(c)
    ) {
      return `it reports a hazard or limit breach while the rule-based status is ${status}`;
    }
  }
  return null;
}

const BREACH_CLAIM =
  /\bbreach(es|ed|ing)?\b|\bexceed(s|ed|ing)?\b[^,;]*\b(limits?|thresholds?|cut-?off)\b|\babove (the |its )?(critical|warning|safe|permissible)\b/i;
const COMMON_NAMES: Record<string, string[]> = {
  ch4: ["methane", "firedamp"],
  o2: ["oxygen"],
  co2: ["carbon dioxide"],
  co: ["carbon monoxide"],
  h2: ["hydrogen"],
  c2h4: ["ethylene"],
  c2h2: ["acetylene"],
};

/** Ways model text may refer to a column: its name, its spaced name, its gas formula. */
function aliasesOf(name: string): RegExp {
  const lower = name.toLowerCase();
  const head = lower.split("_")[0]!;
  const words = [
    lower,
    lower.replace(/_/g, " "),
    ...(COMMON_NAMES[head] ?? []),
  ];
  if (COMMON_NAMES[head]) words.push(head);
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(^|[^a-z0-9])(${esc.join("|")})(?![a-z0-9])`, "i");
}

/**
 * Does model text say a parameter breached a limit when the rules checked it
 * and found no breach (e.g. "CO2 exceeded critical limits" when only methane
 * did)? Returns a short reason, or null.
 */
export function findBreachMisattribution(
  text: string,
  profile: DatasetProfile,
): string | null {
  const evals = profile.safety?.evaluations ?? [];
  const byParam = new Map<string, { checked: boolean; triggered: boolean }>();
  for (const e of evals) {
    const cur = byParam.get(e.parameter) ?? {
      checked: false,
      triggered: false,
    };
    if (e.result !== "not_evaluated") cur.checked = true;
    if (e.result === "warning" || e.result === "critical") cur.triggered = true;
    byParam.set(e.parameter, cur);
  }
  const clean = [...byParam].filter(([, v]) => v.checked && !v.triggered);
  if (clean.length === 0) return null;
  const clauses = text
    .split(/[.;!?,]|\bwhile\b|\bwhereas\b|\band\b|\bbut\b|\bhowever\b/i)
    .map((c) => c.trim())
    .filter(Boolean);
  for (const c of clauses) {
    if (!BREACH_CLAIM.test(c) || NEGATION.test(c) || HEDGE.test(c)) continue;
    for (const [param] of clean) {
      if (aliasesOf(param).test(c)) {
        return `it says ${param} breached a limit, but the rules checked ${param} and found no breach`;
      }
    }
  }
  return null;
}

/** Status claims and misattributed breaches, in one check. */
export function findSafetyWordingConflict(
  text: string,
  status: SafetyStatus,
  profile: DatasetProfile,
): string | null {
  return (
    findSafetyClaimConflict(text, status) ??
    findBreachMisattribution(text, profile)
  );
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export interface NormaliseOutcome {
  insights: DatasetInsights;
  /** Model sentences dropped for contradicting the data or naming unknown parameters. */
  droppedItems: number;
  /** Why the wording conflicts with the rule-based safety status (null if it doesn't). */
  safetyConflict: string | null;
  /** Headline/summary contradicted the data or quoted a number not in the facts. */
  summaryContradicted: boolean;
}

/**
 * Merge the model's JSON with the code-written findings and drop anything
 * that contradicts the computed directions. Returns null if the JSON is unusable.
 */
export function normaliseInsights(
  value: unknown,
  profile: DatasetProfile,
  planned: PlannedFinding[],
): NormaliseOutcome | null {
  const parsed = rawModelSchema.safeParse(value);
  if (!parsed.success) return null;
  const raw = parsed.data;
  let dropped = 0;
  // Without a rule-based assessment the analysis can never be SAFE.
  const status: SafetyStatus = profile.safety?.status ?? "CAUTION";
  const claimConflict = (t: string) =>
    findSafetyWordingConflict(t, status, profile) !== null;
  const allowed = allowedNumbers(profile);
  const grounded = (text: string) =>
    findUngroundedNumbers(text, allowed).length === 0;

  const notes = new Map<string, string>();
  for (const n of raw.notes) {
    const target = planned.find((f) => key(f.parameter) === key(n.parameter));
    // Small models sometimes emit "May: ..." literally.
    const note = clip(n.note.replace(/^(may|possibly|could)\s*:\s*/i, ""), 300);
    if (!target || !note || notes.has(target.parameter)) {
      dropped++;
      continue;
    }
    if (
      findDirectionContradictions(note, profile, "descriptive").length > 0 ||
      !grounded(note) ||
      claimConflict(note)
    ) {
      dropped++;
      continue;
    }
    notes.set(target.parameter, note);
  }

  const findings: DatasetInsights["findings"] = planned.map((f) => {
    const interpretation = notes.get(f.parameter);
    return { ...f, ...(interpretation ? { interpretation } : {}) };
  });

  const recommendations = raw.recommendations
    .map((r) =>
      typeof r === "string"
        ? r
        : Object.values(r)
            .filter((v) => typeof v === "string")
            .join(" "),
    )
    .map((r) => clip(r, 300))
    .filter((r) => {
      if (!r) return false;
      if (
        findDirectionContradictions(r, profile, "descriptive").length > 0 ||
        !grounded(r) ||
        claimConflict(r)
      ) {
        dropped++;
        return false;
      }
      return true;
    })
    .slice(0, 5);

  const headline = clip(raw.headline, 120);
  const summary = clip(raw.summary, 1200);
  if (!headline || !summary) return null;
  const summaryText = `${headline}. ${summary}`;
  const summaryContradicted =
    findDirectionContradictions(summaryText, profile).length > 0 ||
    !grounded(summaryText);

  // Safety: the status is the rule-based one. The model's wording is kept
  // only if it agrees; otherwise it is shown with a "needs review" flag.
  let explanation =
    typeof raw.safety_explanation === "string"
      ? clip(raw.safety_explanation, 800)
      : "";
  if (explanation && !grounded(explanation)) {
    explanation = "";
    dropped++;
  }
  const modelStatus =
    typeof raw.safety_status === "string"
      ? raw.safety_status.trim().toUpperCase().replace(/\s+/g, "_")
      : "";
  let safetyConflict: string | null = null;
  if (modelStatus && modelStatus !== status) {
    safetyConflict = `the model reported ${modelStatus} but the rule-based status is ${status}`;
  } else {
    safetyConflict = findSafetyWordingConflict(
      `${headline}. ${summary}. ${explanation}`,
      status,
      profile,
    );
  }

  return {
    insights: {
      headline,
      summary,
      findings,
      recommendations,
      safety: {
        status,
        ...(explanation ? { explanation } : {}),
        needsReview: safetyConflict !== null,
        ...(safetyConflict
          ? { reviewReason: `The AI wording needs review: ${safetyConflict}.` }
          : {}),
      },
    },
    droppedItems: dropped,
    summaryContradicted,
    safetyConflict,
  };
}
