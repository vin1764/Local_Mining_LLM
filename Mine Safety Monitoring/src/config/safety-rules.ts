/**
 * Verified safety thresholds and assessment settings.
 *
 * IMPORTANT: this list is intentionally EMPTY. The app does not know your
 * site's legal or engineering limits, and it must not guess them. Until
 * verified thresholds are added here (or loaded as a JSON file in the app),
 * every analysis is classified INSUFFICIENT DATA.
 *
 * Example of the shape (numbers deliberately omitted — take them from your
 * regulator or site standard and cite it in `source`):
 *
 *   {
 *     id: "methane",
 *     label: "Methane",
 *     columns: ["methane_pct"],
 *     unit: "%",
 *     direction: "above",
 *     warning: <site warning level>,
 *     critical: <site action/withdrawal level>,
 *     source: "<regulation / site standard, clause>",
 *     required: true,
 *     maxStalenessMinutes: <minutes>,
 *     validRange: [0, 100],
 *   }
 */
import type { SafetyRuleInput } from "@/lib/safety/rules";

export const SAFETY_RULES: SafetyRuleInput[] = [];

export interface AssessmentSettings {
  currentWindowMinutes: number;
  maxDataAgeMinutes: number;
  defaultMaxStalenessMinutes: number;
}

export const ASSESSMENT_SETTINGS: AssessmentSettings = {
  /** "Current conditions" = readings in this window ending at the file's last timestamp. */
  currentWindowMinutes: 60,
  /** SAFE also requires the newest reading to be at most this old (vs. the clock). */
  maxDataAgeMinutes: 60,
  /** Default staleness limit for a parameter when its rule sets none. */
  defaultMaxStalenessMinutes: 60,
};
