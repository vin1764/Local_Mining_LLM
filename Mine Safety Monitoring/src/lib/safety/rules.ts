/**
 * Safety threshold rules. A rule says: for these CSV columns, a reading at or
 * beyond `critical` is a hazard (UNSAFE), and at or beyond `warning` needs
 * attention (CAUTION). Every rule must name its `source` (regulation, site
 * standard, manufacturer limit) so the classification can be traced.
 *
 * The app ships with NO thresholds. Add verified ones in
 * src/config/safety-rules.ts, or load a thresholds JSON file in the app.
 */
import { z } from "zod";

const finite = z.number().finite();

export const safetyRuleSchema = z
  .object({
    id: z.string().min(1).max(60),
    label: z.string().min(1).max(120),
    /** CSV column names this rule applies to (case-insensitive exact match). */
    columns: z.array(z.string().min(1).max(200)).min(1).max(20),
    unit: z.string().max(20),
    /** "above": higher is worse (e.g. gas concentration). "below": lower is worse (e.g. oxygen). */
    direction: z.enum(["above", "below"]),
    warning: finite.optional(),
    critical: finite,
    /** Where the numbers come from. Required so nothing is unattributed. */
    source: z.string().min(3).max(300),
    /** If true, a file without this parameter cannot be classified SAFE. */
    required: z.boolean().default(false),
    /** A parameter whose last reading is older than this (vs. the file's last timestamp) is stale. */
    maxStalenessMinutes: z.number().positive().max(10_080).optional(),
    /** Physically plausible range; readings outside it are treated as invalid. */
    validRange: z.tuple([finite, finite]).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.warning !== undefined) {
      const ordered =
        r.direction === "above"
          ? r.warning < r.critical
          : r.warning > r.critical;
      if (!ordered) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Rule "${r.id}": warning must be ${r.direction === "above" ? "below" : "above"} critical.`,
        });
      }
    }
    if (r.validRange && r.validRange[0] >= r.validRange[1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Rule "${r.id}": validRange must be [min, max].`,
      });
    }
  });

export type SafetyRule = z.output<typeof safetyRuleSchema>;
export type SafetyRuleInput = z.input<typeof safetyRuleSchema>;

export const safetyRulesFileSchema = z.object({
  version: z.literal(1),
  name: z.string().max(120).optional(),
  rules: z.array(safetyRuleSchema).min(1).max(200),
});

export type SafetyRulesFile = z.output<typeof safetyRulesFileSchema>;

/** Parse a thresholds JSON file. Returns a readable error instead of throwing. */
export function parseRulesFile(
  text: string,
): { ok: true; file: SafetyRulesFile } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "The thresholds file is not valid JSON." };
  }
  const parsed = safetyRulesFileSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` (at ${first.path.join(".")})` : "";
    return {
      ok: false,
      error: `The thresholds file is not in the expected format: ${first?.message ?? "invalid"}${where}.`,
    };
  }
  return { ok: true, file: parsed.data };
}
