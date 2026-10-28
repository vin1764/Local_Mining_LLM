/**
 * Safety rule configuration: schema, validation and the site-file merge policy.
 *
 * The built-in configuration is src/config/safety-rules.json. A site file
 * (loaded with "LOAD SITE THRESHOLDS (JSON)") uses the same format and is
 * combined with it according to its `mergePolicy`:
 *
 *  - "merge" (default): a site rule with the same `id` as a built-in rule
 *    replaces it; site rules with new ids are added; built-in rules the site
 *    file does not mention are kept. Site `mineContext` / `dataQuality` fields
 *    override the built-in ones field by field; site `parameters` are added.
 *  - "replace": only the site file's rules are used (built-in parameters are
 *    still known). The file must contain at least one enabled verified rule.
 *
 * An invalid file is never applied.
 */
import { z } from "zod";

import builtinJson from "@/config/safety-rules.json";
import { UNITS, canConvert, convert } from "./units";

const finite = z.number().finite();
const unit = z.enum(UNITS);

export const OPERATORS = [
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "is_true",
  "steady_increase",
] as const;
export type Operator = (typeof OPERATORS)[number];

export const VERIFICATION_STATUSES = [
  "verified_regulatory",
  "verified_site",
  "provisional",
  "requires_verification",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  verified_regulatory: "VERIFIED REGULATORY",
  verified_site: "VERIFIED SITE",
  provisional: "PROVISIONAL",
  requires_verification: "REQUIRES VERIFICATION",
};

const parameterSchema = z.object({
  name: z
    .string()
    .regex(
      /^[A-Za-z][A-Za-z0-9_]{0,79}$/,
      "must be a CSV column name (letters, digits, _)",
    ),
  unit,
  type: z.enum(["number", "boolean"]),
  description: z.string().max(200).optional(),
  min: finite.optional(),
  max: finite.optional(),
});
export type ParameterDef = z.infer<typeof parameterSchema>;

const sourceSchema = z.object({
  document: z.string().min(3).max(400),
  clause: z.string().min(1).max(600),
  url: z.string().url().max(400).nullable().optional(),
  localReference: z.string().max(200).optional(),
  independentCopy: z.string().max(400).optional(),
  verification: z
    .object({
      method: z.string().min(3).max(600),
      checkedOn: z.string().max(40),
      officialCopyChecked: z.boolean(),
      amendmentsChecked: z.boolean(),
      approvedBy: z.string().max(200).optional(),
    })
    .optional(),
});

const ruleSchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9-]{1,79}$/,
      "use lowercase letters, digits and dashes",
    ),
  parameter: z.string().min(1).max(80),
  unit,
  operator: z.enum(OPERATORS),
  warningThreshold: finite.nullable().default(null),
  criticalThreshold: finite.nullable().default(null),
  severity: z.enum(["critical", "warning", "monitoring"]),
  context: z
    .object({
      location: z.string().max(80).default("any_place"),
      gassinessDegree: z
        .union([z.literal(1), z.literal(2), z.literal(3)])
        .optional(),
      measurement: z.string().max(40).optional(),
      note: z.string().max(600).optional(),
    })
    .default({ location: "any_place" }),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  enabled: z.boolean(),
  requiredForSafe: z.boolean().default(false),
  consecutiveIncreases: z.number().int().min(2).max(50).optional(),
  source: sourceSchema,
  explanation: z.string().min(3).max(800),
});
export type SafetyRule = z.output<typeof ruleSchema>;

const configSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(160),
  mergePolicy: z.enum(["merge", "replace"]).optional(),
  mineContext: z
    .object({
      country: z.string().max(80).optional(),
      mineType: z.string().max(120).optional(),
      degreeOfGassiness: z
        .union([z.literal(1), z.literal(2), z.literal(3), z.null()])
        .optional(),
      applicabilityNote: z.string().max(800).optional(),
    })
    .optional(),
  dataQuality: z
    .object({
      expectedSamplingIntervalSeconds: z
        .number()
        .positive()
        .max(86_400)
        .nullable()
        .optional(),
      staleAfterMinutes: z.number().positive().max(10_080).optional(),
      evaluationWindowMinutes: z.number().positive().max(1_440).optional(),
      parameterStaleFactor: z.number().min(1).max(100).optional(),
      derivedIndicatorTolerancePct: z.number().min(0).max(100).optional(),
      note: z.string().max(600).optional(),
    })
    .optional(),
  parameters: z.array(parameterSchema).max(500).default([]),
  rules: z.array(ruleSchema).max(500),
});
export type RulesConfigInput = z.input<typeof configSchema>;

export interface DataQualitySettings {
  expectedSamplingIntervalSeconds: number | null;
  staleAfterMinutes: number;
  evaluationWindowMinutes: number;
  parameterStaleFactor: number;
  derivedIndicatorTolerancePct: number;
}

/** A complete, validated configuration ready for the safety engine. */
export interface RulesConfig {
  name: string;
  mineContext: {
    country?: string | undefined;
    mineType?: string | undefined;
    degreeOfGassiness: 1 | 2 | 3 | null;
    applicabilityNote?: string | undefined;
  };
  dataQuality: DataQualitySettings;
  parameters: ParameterDef[];
  rules: SafetyRule[];
}

export type ValidationResult =
  | { ok: true; config: z.output<typeof configSchema>; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

const isVerified = (s: VerificationStatus) =>
  s === "verified_regulatory" || s === "verified_site";
const above = (op: Operator) =>
  op === "greater_than" || op === "greater_than_or_equal";
const below = (op: Operator) =>
  op === "less_than" || op === "less_than_or_equal";

/**
 * Validate a parsed configuration. `knownParameters` are the fields the rules
 * may refer to (built-in registry; the file's own `parameters` are added).
 */
export function validateConfig(
  raw: unknown,
  knownParameters: ParameterDef[] = [],
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 12)) {
      errors.push(
        `${issue.path.length ? issue.path.join(".") + ": " : ""}${issue.message}`,
      );
    }
    return { ok: false, errors, warnings };
  }
  const cfg = parsed.data;

  // Parameter registry: built-in + file. A file may not redefine a known field's unit/type.
  const registry = new Map(knownParameters.map((p) => [p.name, p]));
  const seenParams = new Set<string>();
  for (const p of cfg.parameters) {
    if (seenParams.has(p.name))
      errors.push(`parameters: "${p.name}" is defined twice.`);
    seenParams.add(p.name);
    const known = registry.get(p.name);
    if (known && (known.unit !== p.unit || known.type !== p.type)) {
      errors.push(
        `parameters: "${p.name}" is ${known.type} in ${known.unit}; the file says ${p.type} in ${p.unit}. Field units cannot be changed.`,
      );
    }
    if (p.min !== undefined && p.max !== undefined && p.min >= p.max)
      errors.push(`parameters: "${p.name}" min must be below max.`);
    if (!known) registry.set(p.name, p);
  }

  const ids = new Set<string>();
  const signatures = new Map<string, string>();
  for (const r of cfg.rules) {
    const where = `rule "${r.id}"`;
    if (ids.has(r.id)) errors.push(`${where}: duplicate id.`);
    ids.add(r.id);

    const param = registry.get(r.parameter);
    if (!param) {
      errors.push(
        `${where}: unknown parameter "${r.parameter}". Use an existing field name, or declare it under "parameters".`,
      );
      continue;
    }

    // Operator ↔ parameter type.
    if (param.type === "boolean" && r.operator !== "is_true")
      errors.push(
        `${where}: ${r.parameter} is a yes/no detection; use operator "is_true".`,
      );
    if (param.type === "number" && r.operator === "is_true")
      errors.push(`${where}: "is_true" only applies to yes/no detections.`);

    // Units: same unit or an explicit, supported conversion.
    if (param.type === "boolean") {
      if (r.unit !== "boolean")
        errors.push(`${where}: unit must be "boolean" for ${r.parameter}.`);
    } else if (!canConvert(r.unit, param.unit)) {
      errors.push(
        `${where}: unit "${r.unit}" cannot be converted to ${r.parameter}'s unit "${param.unit}".`,
      );
    }

    // Thresholds.
    const w = r.warningThreshold;
    const c = r.criticalThreshold;
    const hasNumbers = w !== null || c !== null;
    if (r.operator === "is_true" || r.operator === "steady_increase") {
      if (hasNumbers)
        errors.push(
          `${where}: operator "${r.operator}" does not use thresholds; set them to null.`,
        );
      if (r.operator === "steady_increase" && !r.consecutiveIncreases)
        errors.push(`${where}: "steady_increase" needs consecutiveIncreases.`);
    } else if (w !== null && c !== null) {
      if (above(r.operator) && !(w < c))
        errors.push(
          `${where}: warning (${w}) must be below critical (${c}) for "${r.operator}".`,
        );
      if (below(r.operator) && !(w > c))
        errors.push(
          `${where}: warning (${w}) must be above critical (${c}) for "${r.operator}".`,
        );
    }
    if (
      r.severity === "critical" &&
      r.enabled &&
      !["is_true", "steady_increase"].includes(r.operator) &&
      c === null
    ) {
      errors.push(
        `${where}: an enabled critical rule needs a criticalThreshold.`,
      );
    }
    if (r.severity === "warning" && c !== null)
      errors.push(
        `${where}: a warning-severity rule cannot have a criticalThreshold.`,
      );
    if (
      r.enabled &&
      r.severity !== "monitoring" &&
      !hasNumbers &&
      !["is_true", "steady_increase"].includes(r.operator)
    ) {
      errors.push(`${where}: an enabled rule needs at least one threshold.`);
    }
    const lo = param.min;
    const hi = param.max;
    for (const [label, v] of [
      ["warning", w],
      ["critical", c],
    ] as const) {
      if (
        v === null ||
        param.type !== "number" ||
        !canConvert(r.unit, param.unit)
      )
        continue;
      const inField = convert(v, r.unit, param.unit);
      if (
        (lo !== undefined && inField < lo) ||
        (hi !== undefined && inField > hi)
      ) {
        errors.push(
          `${where}: ${label} threshold ${v} ${r.unit} is outside ${r.parameter}'s valid range.`,
        );
      }
    }

    // Verification metadata.
    if (r.verificationStatus === "requires_verification" && r.enabled) {
      errors.push(
        `${where}: cannot be enabled while its threshold "requires_verification". Verify it and set verificationStatus first.`,
      );
    }
    if (
      r.verificationStatus === "requires_verification" &&
      hasNumbers &&
      r.severity !== "monitoring"
    ) {
      warnings.push(
        `${where}: has numbers but is marked requires_verification, so it is not checked.`,
      );
    }
    if (isVerified(r.verificationStatus)) {
      if (!r.source.url && !r.source.localReference)
        errors.push(
          `${where}: a verified rule needs source.url or source.localReference.`,
        );
      if (!r.source.verification)
        errors.push(
          `${where}: a verified rule needs source.verification (method, checkedOn, …).`,
        );
      if (
        r.verificationStatus === "verified_site" &&
        !r.source.verification?.approvedBy
      ) {
        warnings.push(
          `${where}: verified_site rule has no source.verification.approvedBy.`,
        );
      }
      if (r.source.verification && !r.source.verification.officialCopyChecked) {
        warnings.push(
          `${where}: official copy of the source has not been checked.`,
        );
      }
    }
    if (r.verificationStatus === "provisional" && r.enabled) {
      warnings.push(
        `${where}: provisional rule is enabled; it can raise CAUTION but never UNSAFE.`,
      );
    }

    // Duplicate rules (same check twice under different ids).
    const sig = [
      r.parameter,
      r.operator,
      r.unit,
      w,
      c,
      r.context.location,
      r.context.gassinessDegree ?? "",
    ].join("|");
    const prior = signatures.get(sig);
    if (prior)
      errors.push(
        `${where}: duplicates rule "${prior}" (same parameter, operator, thresholds and context).`,
      );
    else signatures.set(sig, r.id);
  }

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, config: cfg, warnings };
}

/** Parse JSON text, then validate it. */
export function parseConfigText(
  text: string,
  knownParameters: ParameterDef[],
): ValidationResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      errors: [
        `Not valid JSON: ${e instanceof Error ? e.message : "parse error"}.`,
      ],
      warnings: [],
    };
  }
  return validateConfig(json, knownParameters);
}

const DEFAULT_DQ: DataQualitySettings = {
  expectedSamplingIntervalSeconds: null,
  staleAfterMinutes: 15,
  evaluationWindowMinutes: 60,
  parameterStaleFactor: 3,
  derivedIndicatorTolerancePct: 5,
};

function toRulesConfig(c: z.output<typeof configSchema>): RulesConfig {
  const dq = c.dataQuality ?? {};
  return {
    name: c.name,
    mineContext: {
      ...c.mineContext,
      degreeOfGassiness: c.mineContext?.degreeOfGassiness ?? null,
    },
    dataQuality: {
      expectedSamplingIntervalSeconds:
        dq.expectedSamplingIntervalSeconds ??
        DEFAULT_DQ.expectedSamplingIntervalSeconds,
      staleAfterMinutes: dq.staleAfterMinutes ?? DEFAULT_DQ.staleAfterMinutes,
      evaluationWindowMinutes:
        dq.evaluationWindowMinutes ?? DEFAULT_DQ.evaluationWindowMinutes,
      parameterStaleFactor:
        dq.parameterStaleFactor ?? DEFAULT_DQ.parameterStaleFactor,
      derivedIndicatorTolerancePct:
        dq.derivedIndicatorTolerancePct ??
        DEFAULT_DQ.derivedIndicatorTolerancePct,
    },
    parameters: c.parameters,
    rules: c.rules,
  };
}

let builtinCache: RulesConfig | null = null;

/** The built-in configuration. Throws if the shipped JSON is invalid (caught by tests). */
export function builtinConfig(): RulesConfig {
  if (builtinCache) return builtinCache;
  const res = validateConfig(builtinJson, []);
  if (!res.ok)
    throw new Error(
      `Built-in safety-rules.json is invalid: ${res.errors.join("; ")}`,
    );
  builtinCache = toRulesConfig(res.config);
  return builtinCache;
}

export interface MergePreview {
  policy: "merge" | "replace";
  added: string[];
  replaced: string[];
  kept: string[];
  removed: string[];
  result: RulesConfig;
}

/** Combine the built-in configuration with a validated site file. */
export function mergeSiteConfig(
  base: RulesConfig,
  site: z.output<typeof configSchema>,
): MergePreview {
  const policy = site.mergePolicy ?? "merge";
  const params = [...base.parameters];
  for (const p of site.parameters)
    if (!params.some((q) => q.name === p.name)) params.push(p);
  const siteIds = new Set(site.rules.map((r) => r.id));
  const baseIds = new Set(base.rules.map((r) => r.id));
  const added = site.rules.filter((r) => !baseIds.has(r.id)).map((r) => r.id);
  const replaced = site.rules.filter((r) => baseIds.has(r.id)).map((r) => r.id);
  let rules: SafetyRule[];
  let kept: string[];
  let removed: string[];
  if (policy === "replace") {
    rules = site.rules;
    kept = [];
    removed = base.rules.filter((r) => !siteIds.has(r.id)).map((r) => r.id);
  } else {
    rules = [
      ...base.rules.map((r) => site.rules.find((s) => s.id === r.id) ?? r),
      ...site.rules.filter((r) => !baseIds.has(r.id)),
    ];
    kept = base.rules.filter((r) => !siteIds.has(r.id)).map((r) => r.id);
    removed = [];
  }
  const siteDq = toRulesConfig(site).dataQuality;
  const rawDq = site.dataQuality ?? {};
  const result: RulesConfig = {
    name: `${base.name} + ${site.name}`,
    mineContext: {
      ...base.mineContext,
      ...Object.fromEntries(
        Object.entries(site.mineContext ?? {}).filter(
          ([, v]) => v !== undefined,
        ),
      ),
      degreeOfGassiness:
        site.mineContext && "degreeOfGassiness" in site.mineContext
          ? (site.mineContext.degreeOfGassiness ?? null)
          : base.mineContext.degreeOfGassiness,
    },
    dataQuality: {
      ...base.dataQuality,
      ...Object.fromEntries(
        Object.keys(rawDq)
          .filter((k) => k in siteDq)
          .map((k) => [k, siteDq[k as keyof DataQualitySettings]]),
      ),
    },
    parameters: params,
    rules,
  };
  return { policy, added, replaced, kept, removed, result };
}

/**
 * Validate a site file against the built-in registry and preview the result.
 * Extra checks: a "replace" file needs an enabled verified rule; the merged
 * set must not contain duplicate checks.
 */
export function previewSiteFile(
  text: string,
  base: RulesConfig = builtinConfig(),
):
  | { ok: true; preview: MergePreview; warnings: string[]; fileName: string }
  | { ok: false; errors: string[]; warnings: string[] } {
  const res = parseConfigText(text, base.parameters);
  if (!res.ok) return res;
  const preview = mergeSiteConfig(base, res.config);
  const errors: string[] = [];
  if (
    preview.policy === "replace" &&
    !preview.result.rules.some(
      (r) => r.enabled && isVerified(r.verificationStatus),
    )
  ) {
    errors.push(
      'A "replace" file must contain at least one enabled verified rule, otherwise nothing would be checked.',
    );
  }
  if (
    res.config.rules.length === 0 &&
    !res.config.mineContext &&
    !res.config.dataQuality
  ) {
    errors.push("The file contains no rules or settings.");
  }
  // Re-validate the merged result to catch duplicates across built-in and site rules.
  const merged = validateConfig(
    {
      schemaVersion: 1,
      name: preview.result.name,
      rules: preview.result.rules,
      parameters: [],
    },
    preview.result.parameters,
  );
  if (!merged.ok)
    errors.push(...merged.errors.map((e) => `After merging: ${e}`));
  if (errors.length) return { ok: false, errors, warnings: res.warnings };
  return {
    ok: true,
    preview,
    warnings: res.warnings,
    fileName: res.config.name,
  };
}
