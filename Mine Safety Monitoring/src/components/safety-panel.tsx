import { useRef, useState } from "react";
import {
  FileJson,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  X,
} from "lucide-react";

import { formatValue } from "@/lib/dataset";
import {
  SAFETY_STATUS_LABEL,
  type RuleLevel,
  type SafetyAssessment,
  type SafetyStatus,
} from "@/lib/safety/assess";
import {
  clearRulesFile,
  saveRulesFileText,
  type ActiveRules,
} from "@/lib/safety/store";

const SAFETY_STYLES: Record<SafetyStatus, string> = {
  SAFE: "border-positive/60 bg-positive/10 text-positive",
  CAUTION: "border-warning/60 bg-warning/10 text-warning",
  UNSAFE: "border-negative/70 bg-negative/15 text-negative",
  INSUFFICIENT_DATA: "border-border bg-surface-2 text-muted-foreground",
};

const ICONS: Record<SafetyStatus, typeof ShieldCheck> = {
  SAFE: ShieldCheck,
  CAUTION: ShieldAlert,
  UNSAFE: ShieldX,
  INSUFFICIENT_DATA: ShieldQuestion,
};

/** What each status means, shown under the label so color is never the only cue. */
const MEANING: Record<SafetyStatus, string> = {
  SAFE: "All configured checks passed on current data. Not a certification that the mine is safe.",
  CAUTION: "Conditions need attention or verification.",
  UNSAFE: "A configured critical limit is breached.",
  INSUFFICIENT_DATA:
    "The data or thresholds are not adequate for a reliable assessment.",
};

const LEVEL_TEXT: Record<RuleLevel, string> = {
  ok: "OK",
  warning: "WARNING",
  critical: "CRITICAL",
  no_data: "NO DATA",
  stale: "STALE",
  invalid: "INVALID",
};

const LEVEL_STYLE: Record<RuleLevel, string> = {
  ok: "text-positive",
  warning: "text-warning",
  critical: "text-negative",
  no_data: "text-muted-foreground",
  stale: "text-muted-foreground",
  invalid: "text-muted-foreground",
};

export function SafetyStatusBadge({
  status,
  size = "md",
}: {
  status: SafetyStatus;
  size?: "sm" | "md";
}) {
  const Icon = ICONS[status];
  return (
    <span
      role="status"
      aria-label={`Safety status: ${SAFETY_STATUS_LABEL[status]}`}
      className={`inline-flex items-center gap-2 rounded-sm border font-mono font-semibold tracking-wider ${SAFETY_STYLES[status]} ${
        size === "md" ? "px-3 py-1.5 text-sm" : "px-1.5 py-0.5 text-[10px]"
      }`}
    >
      <Icon
        className={size === "md" ? "size-5" : "size-3"}
        aria-hidden="true"
      />
      {SAFETY_STATUS_LABEL[status]}
    </span>
  );
}

const fmt = (v: number | null, unit: string) =>
  v === null ? "—" : formatValue(v, unit);

export function SafetyPanel({
  assessment,
  rules,
}: {
  assessment: SafetyAssessment;
  rules: ActiveRules;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const { status } = assessment;

  return (
    <div
      className={`mb-4 rounded-md border bg-surface p-4 ${SAFETY_STYLES[status].split(" ")[0]}`}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-wider text-muted-foreground">
            SAFETY CLASSIFICATION · RULE-BASED
          </p>
          <div className="mt-1">
            <SafetyStatusBadge status={status} />
          </div>
        </div>
        <p className="min-w-0 flex-1 basis-64 pt-4 text-xs leading-relaxed text-foreground">
          {MEANING[status]}
        </p>
      </div>

      <p className="mt-3 font-mono text-[10px] leading-relaxed tracking-wide text-muted-foreground">
        READINGS UP TO {assessment.dataAsOf ?? "—"} · CURRENT WINDOW = LAST 60
        MIN OF THE FILE · THRESHOLDS: {rules.source.toUpperCase()} (
        {assessment.ruleCount} RULE{assessment.ruleCount === 1 ? "" : "S"})
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-wider text-primary">
            EVIDENCE
          </p>
          <ul className="mt-1 grid gap-1 text-xs leading-relaxed text-foreground">
            {assessment.reasons.map((r, i) => (
              <li key={i} className="break-words">
                • {r}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-wider text-primary">
            NEXT ACTIONS (RULE-BASED)
          </p>
          <ul className="mt-1 grid gap-1 text-xs leading-relaxed text-foreground">
            {assessment.nextActions.length === 0 ? (
              <li className="text-muted-foreground">
                No rule-based action required by the configured checks.
              </li>
            ) : (
              assessment.nextActions.map((a, i) => (
                <li key={i} className="break-words">
                  • {a}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {assessment.evaluations.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] font-mono text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-1 font-medium tracking-wider">PARAMETER</th>
                <th className="pb-1 font-medium tracking-wider">CHECK</th>
                <th className="pb-1 text-right font-medium tracking-wider">
                  LATEST
                </th>
                <th className="pb-1 text-right font-medium tracking-wider">
                  1-HOUR MA
                </th>
                <th className="pb-1 text-right font-medium tracking-wider">
                  WORST (60 MIN)
                </th>
                <th className="pb-1 text-right font-medium tracking-wider">
                  WARNING
                </th>
                <th className="pb-1 text-right font-medium tracking-wider">
                  CRITICAL
                </th>
                <th className="pb-1 pl-3 font-medium tracking-wider">SOURCE</th>
              </tr>
            </thead>
            <tbody>
              {assessment.evaluations.map((e, i) => {
                const op = e.direction === "above" ? "≥ " : "≤ ";
                return (
                  <tr key={i} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-2 text-foreground">{e.column}</td>
                    <td
                      className={`py-1.5 pr-2 font-semibold ${LEVEL_STYLE[e.level]}`}
                    >
                      {LEVEL_TEXT[e.level]}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-foreground">
                      {fmt(e.latestValue, e.unit)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-foreground">
                      {fmt(e.movingAvg1h, e.unit)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-foreground">
                      {fmt(e.worstValue, e.unit)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-muted-foreground">
                      {e.warning === null
                        ? "—"
                        : op + formatValue(e.warning, e.unit)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-muted-foreground">
                      {op + formatValue(e.critical, e.unit)}
                    </td>
                    <td className="max-w-[16rem] py-1.5 pl-3 break-words text-muted-foreground">
                      {e.source}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(assessment.dataQualityNotes.length > 0 ||
        assessment.unassessedParameters.length > 0) && (
        <div className="mt-3">
          <p className="font-mono text-[10px] tracking-wider text-primary">
            DATA QUALITY
          </p>
          <ul className="mt-1 grid gap-1 text-xs leading-relaxed text-muted-foreground">
            {assessment.dataQualityNotes.map((n, i) => (
              <li key={i} className="break-words">
                • {n}
              </li>
            ))}
            {assessment.evaluations.length === 0 &&
              assessment.unassessedParameters.length > 0 && (
                <li className="break-words">
                  • Not assessed (no threshold):{" "}
                  {assessment.unassessedParameters.join(", ")}
                </li>
              )}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 py-1 font-mono text-[10px] tracking-wider text-foreground transition-colors hover:border-primary/60"
        >
          <FileJson className="size-3.5" />
          {rules.fromFile
            ? "REPLACE THRESHOLDS FILE"
            : "LOAD SITE THRESHOLDS (JSON)"}
        </button>
        {rules.fromFile && (
          <button
            onClick={() => {
              clearRulesFile();
              setFileError(null);
            }}
            className="flex items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 py-1 font-mono text-[10px] tracking-wider text-foreground transition-colors hover:border-primary/60"
          >
            <X className="size-3.5" />
            REMOVE THRESHOLDS FILE
          </button>
        )}
        <span className="font-mono text-[10px] text-muted-foreground">
          Use only verified limits from your regulator or site standard. Format:
          see README.
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Thresholds file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 256 * 1024) {
              setFileError("The thresholds file is too large (max 256 KB).");
              return;
            }
            setFileError(saveRulesFileText(await file.text()));
          }}
        />
        {fileError && (
          <p className="w-full font-mono text-[11px] text-negative">
            {fileError}
          </p>
        )}
      </div>
    </div>
  );
}
