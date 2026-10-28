import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  BrainCircuit,
  CircleDot,
  Cpu,
  Download,
  GitBranch,
  HardHat,
  RefreshCw,
  ScanSearch,
  TriangleAlert,
  Waves,
} from "lucide-react";

import { UploadZone } from "@/components/upload-zone";
import { SavedRunsPanel } from "@/components/saved-runs";
import { SafetyPanel, SafetyStatusBadge } from "@/components/safety-panel";
import {
  assessSafety,
  SAFETY_STATUS_LABEL,
  type SafetyAssessment,
} from "@/lib/safety/assess";
import { useActiveConfig } from "@/lib/safety/store";
import {
  EmptyChartNote,
  MiniChart,
  SectionHeader,
  TrendConsole,
} from "@/components/charts";
import {
  buildDataset,
  buildProfile,
  computeAnomalies,
  formatValue,
  prettyName,
  type Dataset,
  type DatasetInsights,
  type DatasetProfile,
} from "@/lib/dataset";
import { aiClient } from "@/lib/ai/client";
import type { AnalyzeResult, LoadProgress } from "@/lib/ai/types";
import type { LocalAiErrorCode } from "@/lib/ai/provider";
import {
  AI_DISCLAIMER,
  buildMarkdownReport,
  downloadText,
  reportFileName,
  type AnalysisRecord,
} from "@/lib/report";
import type { SavedRun } from "@/lib/storage/runs";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "STRATA — Mine Operations Dashboard" },
      {
        name: "description",
        content:
          "Upload mine-site CSV logs and get multi-parameter trends, correlations, outlier flags and a local AI analyst read in one offline dashboard.",
      },
      { property: "og:title", content: "STRATA — Mine Operations Dashboard" },
      {
        property: "og:description",
        content:
          "Upload mine-site CSV logs and get multi-parameter trends, correlations, outlier flags and an AI analyst read in one dashboard.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

/* ---------------- Small readout pieces ---------------- */

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <p className="font-mono text-[10px] tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate font-mono text-sm font-semibold text-foreground">
        {value}
      </p>
    </div>
  );
}

function HazardStrip() {
  return <div className="hazard h-1.5 w-full" aria-hidden="true" />;
}

const SEVERITY_STYLES: Record<
  DatasetInsights["findings"][number]["severity"],
  string
> = {
  normal: "border-positive/50 bg-positive/10 text-positive",
  watch: "border-warning/50 bg-warning/10 text-warning",
  critical: "border-negative/50 bg-negative/15 text-negative",
};

const SEVERITY_LABEL: Record<
  DatasetInsights["findings"][number]["severity"],
  string
> = {
  normal: "NOMINAL",
  watch: "WATCH",
  critical: "CRITICAL",
};

/* ---------------- Local AI status ---------------- */

function useAiStatus() {
  return useQuery({
    queryKey: ["ai-status"],
    queryFn: () => aiClient.status(),
    refetchInterval: (q) => (q.state.data?.modelInstalled ? 60_000 : 10_000),
    refetchOnWindowFocus: true,
    retry: false,
  });
}

function AiStatusBadge() {
  const status = useAiStatus();
  const s = status.data;
  const ready = !!s?.reachable && !!s?.modelInstalled;
  const browser = s?.provider === "webllm";
  const modelName = (s?.model ?? "")
    .replace(/-q\d.*$/i, "")
    .replace(/-Instruct$/i, "");
  const label = status.isPending
    ? "CHECKING LOCAL AI"
    : ready
      ? `${browser ? "BROWSER AI" : "LOCAL AI"} · ${modelName.toUpperCase()}`
      : s?.unsupported
        ? "BROWSER AI UNSUPPORTED"
        : s?.reachable
          ? "MODEL NOT DOWNLOADED"
          : s?.localBackendMissing
            ? "LOCAL AI NOT RUNNING"
            : "LOCAL AI OFFLINE";
  return (
    <span
      title={
        s
          ? `${s.message}${s.hint ? ` ${s.hint}` : ""}`
          : "Checking the local AI…"
      }
      className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 ${
        ready
          ? "border-positive/50 bg-positive/10 text-positive"
          : status.isPending
            ? "border-border bg-surface-2 text-muted-foreground"
            : "border-warning/50 bg-warning/10 text-warning"
      }`}
    >
      <Cpu className="size-3" />
      {label}
    </span>
  );
}

/* ---------------- AI analyst panel ---------------- */

class AnalystError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
    public readonly code?: LocalAiErrorCode,
  ) {
    super(message);
  }
}

/** Download/load progress of an in-browser model (browser build only). */
function useModelProgress(): LoadProgress | null {
  const [p, setP] = useState<LoadProgress | null>(null);
  useEffect(() => aiClient.subscribeProgress?.(setP), []);
  return p;
}

function AnalystPanel({
  dataset,
  assessment,
  analysis,
  runKey,
  onAnalysis,
}: {
  dataset: Dataset | null;
  /** Rule-based safety classification for this dataset (sent to the model to explain). */
  assessment: SafetyAssessment | null;
  analysis: AnalysisRecord | null;
  /** Increments whenever a fresh automatic run should start. */
  runKey: number;
  onAnalysis: (record: AnalysisRecord) => void;
}) {
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const progress = useModelProgress();
  const aiStatus = useAiStatus();
  const datasetRef = useRef(dataset);
  datasetRef.current = dataset;
  const assessmentRef = useRef(assessment);
  assessmentRef.current = assessment;

  const run = useMutation({
    mutationFn: async ({
      profile,
    }: {
      profile: DatasetProfile;
      dataset: Dataset;
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const res: AnalyzeResult = await aiClient.analyze(
        profile,
        controller.signal,
      );
      if (!res.ok)
        throw new AnalystError(
          res.error.message,
          res.error.hint,
          res.error.code,
        );
      return {
        insights: res.insights,
        model: res.meta.model,
        analysedAt: new Date().toISOString(),
        durationMs: res.meta.durationMs,
        summarySource: res.meta.summarySource,
        provider: res.meta.provider,
      } satisfies AnalysisRecord;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-status"] });
    },
    onSuccess: (record, vars) => {
      // Ignore answers for a dataset that is no longer on screen.
      if (vars.dataset === datasetRef.current) onAnalysis(record);
    },
  });

  const start = (d: Dataset) =>
    run.mutate({
      profile: buildProfile(d, assessmentRef.current ?? undefined),
      dataset: d,
    });

  // A new dataset cancels any analysis still running for the old one.
  useEffect(() => {
    abortRef.current?.abort();
    run.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset]);

  useEffect(() => {
    if (runKey > 0 && datasetRef.current) start(datasetRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!dataset) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface px-5 py-8 text-center">
        <BrainCircuit className="mx-auto size-7 text-muted-foreground" />
        <p className="mt-2 font-mono text-xs tracking-wider text-muted-foreground">
          ANALYST ON STANDBY — LOAD A DATASET TO WAKE IT UP
        </p>
      </div>
    );
  }

  if (run.isPending) {
    return (
      <div className="scanline rounded-md border border-border bg-surface px-5 py-8 text-center">
        <Cpu className="mx-auto size-7 text-primary" />
        <p className="mt-2 font-mono text-xs tracking-wider text-primary status-blink">
          PROCESSING {dataset.rowCount} ROWS × {dataset.numericNames.length}{" "}
          PARAMETERS…
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          The safety classification above is rule-based and up to date · the AI
          explanation is being generated
        </p>
        {progress ? (
          <div className="mx-auto mt-3 max-w-md">
            <div className="h-1.5 overflow-hidden rounded-sm bg-surface-2">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${Math.round(progress.progress * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
              LOADING MODEL {Math.round(progress.progress * 100)}% ·{" "}
              {progress.text.slice(0, 90)}
            </p>
          </div>
        ) : (
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            Statistical profile compiled · local model reading now (the first
            run can take a minute)
          </p>
        )}
        <button
          onClick={() => {
            abortRef.current?.abort();
            run.reset();
          }}
          className="mt-3 rounded-sm border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] tracking-wider text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
        >
          CANCEL
        </button>
      </div>
    );
  }

  const rerunButton = (label: string) => (
    <button
      onClick={() => start(dataset)}
      className="flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-1.5 font-mono text-[11px] tracking-wider text-foreground transition-colors hover:border-primary/60"
    >
      <RefreshCw className="size-3.5" />
      {label}
    </button>
  );

  if (run.isError) {
    const err = run.error;
    const hint = err instanceof AnalystError ? err.hint : undefined;
    const code = err instanceof AnalystError ? err.code : undefined;
    if (
      code === "consent_required" ||
      code === "unsupported" ||
      code === "backend_unavailable"
    ) {
      return (
        <div className="rounded-md border border-primary/40 bg-surface px-5 py-6">
          <p className="flex items-center gap-2 font-mono text-xs text-primary">
            <BrainCircuit className="size-4 shrink-0" />
            {err.message}
          </p>
          {hint && (
            <p className="mt-2 text-xs leading-relaxed text-foreground">
              {hint}
            </p>
          )}
          {code === "backend_unavailable" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {rerunButton("RETRY WITH LOCAL AI")}
              {aiStatus.data?.browserModelAvailable && (
                <button
                  onClick={() => {
                    aiClient.allowDownload?.();
                    start(dataset);
                  }}
                  className="flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-1.5 font-mono text-[11px] tracking-wider text-foreground transition-colors hover:border-primary/60"
                >
                  <Download className="size-3.5" />
                  USE IN-BROWSER MODEL INSTEAD (~1 GB DOWNLOAD)
                </button>
              )}
            </div>
          )}
          <p className="mt-3 font-mono text-[10px] text-muted-foreground">
            The rule-based safety classification above does not need the AI and
            is still valid.
          </p>
          {code === "consent_required" && (
            <button
              onClick={() => {
                aiClient.allowDownload?.();
                start(dataset);
              }}
              className="mt-3 flex items-center gap-2 rounded-sm bg-primary px-3 py-1.5 font-mono text-[11px] font-semibold tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Download className="size-3.5" />
              DOWNLOAD MODEL &amp; RUN ANALYSIS
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="rounded-md border border-negative/50 bg-negative/10 px-5 py-6">
        <p className="flex items-center gap-2 font-mono text-xs text-negative">
          <TriangleAlert className="size-4 shrink-0" />
          {err instanceof Error ? err.message : "Analyst call failed."}
        </p>
        {hint && (
          <p className="mt-2 text-xs leading-relaxed text-foreground">{hint}</p>
        )}
        <div className="mt-3">{rerunButton("RETRY ANALYSIS")}</div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface px-5 py-6 text-center">
        <BrainCircuit className="mx-auto size-7 text-muted-foreground" />
        <p className="mt-2 font-mono text-xs tracking-wider text-muted-foreground">
          NO ANALYSIS FOR THIS DATASET YET
        </p>
        <div className="mt-3 flex justify-center">
          {rerunButton("RUN LOCAL ANALYSIS")}
        </div>
      </div>
    );
  }

  const { insights } = analysis;
  const aiSafety = insights.safety;
  const statusChanged =
    !!aiSafety && !!assessment && aiSafety.status !== assessment.status;

  return (
    <div className="grid gap-3">
      <div className="rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[10px] tracking-wider text-primary">
            AI EXPLANATION OF THE SAFETY STATUS
          </p>
          {aiSafety && <SafetyStatusBadge status={aiSafety.status} size="sm" />}
        </div>
        {!aiSafety ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            This saved analysis was made before safety classification was added.
            Re-run it for an explanation.
          </p>
        ) : (
          <>
            <p className="mt-1.5 text-sm leading-relaxed break-words text-foreground">
              {aiSafety.explanation ??
                "The model did not provide a usable explanation. Rely on the rule-based evidence above."}
            </p>
            {(aiSafety.needsReview || statusChanged) && (
              <p
                role="alert"
                className="mt-2 flex items-start gap-2 rounded-sm border border-warning/60 bg-warning/10 px-2.5 py-1.5 text-xs text-warning"
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 break-words">
                  {statusChanged
                    ? `This explanation was written for ${SAFETY_STATUS_LABEL[aiSafety.status]}, but the current rule-based status is ${SAFETY_STATUS_LABEL[assessment!.status]} (the data or thresholds changed). Re-run the analysis.`
                    : `${aiSafety.reviewReason ?? "The AI wording needs review."} The rule-based status above stands.`}
                </span>
              </p>
            )}
          </>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-md border border-primary/40 bg-surface p-5">
          <p className="font-mono text-[10px] tracking-wider text-primary">
            HEADLINE READ
          </p>
          <p className="font-display text-3xl leading-tight tracking-wide text-foreground text-glow">
            {insights.headline}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {insights.summary}
          </p>
        </div>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <p className="font-mono text-[10px] tracking-wider text-muted-foreground">
              STATISTICAL FINDINGS · TREND/OUTLIER SEVERITY, NOT SAFETY
              THRESHOLDS
            </p>
            {insights.findings.map((f, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-md border border-border bg-surface px-3 py-2"
              >
                <span
                  className={`mt-0.5 shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[9px] tracking-wider ${SEVERITY_STYLES[f.severity]}`}
                >
                  {SEVERITY_LABEL[f.severity]}
                </span>
                <div className="min-w-0 text-xs leading-relaxed text-foreground">
                  <p>
                    <span className="font-mono font-semibold">
                      {prettyName(f.parameter)}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      — {f.observation}
                    </span>
                  </p>
                  {f.interpretation && (
                    <p className="mt-0.5 italic text-muted-foreground">
                      <span className="font-mono text-[9px] not-italic tracking-wider text-primary">
                        POSSIBLE EXPLANATION ·{" "}
                      </span>
                      {f.interpretation}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="font-mono text-[10px] tracking-wider text-primary">
              SHIFT ACTIONS
            </p>
            <ol className="mt-1.5 grid gap-1">
              {insights.recommendations.map((rec, i) => (
                <li key={i} className="flex gap-2 text-xs text-foreground">
                  <span className="font-mono text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {rec}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
          MODEL: {analysis.model} (
          {analysis.provider === "webllm" ? "IN YOUR BROWSER" : "LOCAL"}) ·{" "}
          {new Date(analysis.analysedAt).toLocaleString()}
          {analysis.durationMs
            ? ` · ${(analysis.durationMs / 1000).toFixed(1)} s`
            : ""}
          <br />
          FINDING FACTS AND SEVERITY ARE COMPUTED BY THE APP; THE MODEL WRITES
          THE WORDING AND EXPLANATIONS.
          {analysis.summarySource === "code" &&
            " THE MODEL'S SUMMARY CONTRADICTED THE DATA, SO THE HEADLINE AND SUMMARY ABOVE WERE WRITTEN FROM THE STATISTICS."}
          <br />
          {AI_DISCLAIMER}
        </p>
        <button
          onClick={() =>
            downloadText(
              reportFileName(dataset.name),
              buildMarkdownReport(dataset, analysis, assessment ?? undefined),
            )
          }
          className="flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-1.5 font-mono text-[11px] tracking-wider text-foreground transition-colors hover:border-primary/60"
        >
          <Download className="size-3.5" />
          EXPORT REPORT
        </button>
        {rerunButton("RE-RUN")}
      </div>
    </div>
  );
}

/* ---------------- Correlation + anomaly panels ---------------- */

function CorrelationPanel({ dataset }: { dataset: Dataset }) {
  const pairs = useMemo(() => {
    // Reuse the profile's correlation routine by building a lightweight profile.
    return buildProfile(dataset).correlations;
  }, [dataset]);

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wider text-foreground">
        <GitBranch className="size-3.5 text-primary" />
        PARAMETER CORRELATIONS (|r| ≥ 0.35)
      </p>
      {pairs.length === 0 ? (
        <p className="mt-3 font-mono text-xs text-muted-foreground">
          No strong pairwise relationships in this dataset.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2.5">
          {pairs.map((p) => (
            <li key={`${p.a}-${p.b}`} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
                <span className="truncate text-foreground">
                  {prettyName(p.a)}{" "}
                  <span className="text-muted-foreground">↔</span>{" "}
                  {prettyName(p.b)}
                </span>
                <span
                  className={`shrink-0 font-semibold ${p.r >= 0 ? "text-positive" : "text-negative"}`}
                >
                  r = {p.r >= 0 ? "+" : ""}
                  {p.r.toFixed(2)}
                </span>
              </div>
              <div className="relative h-1.5 overflow-hidden rounded-sm bg-surface-2">
                <div
                  className="absolute inset-y-0 rounded-sm"
                  style={{
                    left: "50%",
                    width: `${Math.abs(p.r) * 50}%`,
                    transform: p.r >= 0 ? "none" : "translateX(-100%)",
                    background:
                      p.r >= 0
                        ? "var(--color-positive)"
                        : "var(--color-negative)",
                  }}
                />
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnomalyPanel({ dataset }: { dataset: Dataset }) {
  const anomalies = useMemo(() => computeAnomalies(dataset, 10), [dataset]);

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wider text-foreground">
        <ScanSearch className="size-3.5 text-primary" />
        TOP OUTLIERS (|z| ≥ 3)
      </p>
      {anomalies.length === 0 ? (
        <p className="mt-3 font-mono text-xs text-muted-foreground">
          No 3-sigma outliers detected — the seam is behaving.
        </p>
      ) : (
        <table className="mt-3 w-full font-mono text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pb-1 font-medium tracking-wider">PARAMETER</th>
              <th className="pb-1 font-medium tracking-wider">AT</th>
              <th className="pb-1 text-right font-medium tracking-wider">
                VALUE
              </th>
              <th className="pb-1 text-right font-medium tracking-wider">Z</th>
            </tr>
          </thead>
          <tbody>
            {anomalies.map((a, i) => (
              <tr key={i} className="border-t border-border/60">
                <td className="py-1.5 pr-2 text-foreground">
                  {prettyName(a.column)}
                </td>
                <td className="py-1.5 pr-2 text-muted-foreground">{a.label}</td>
                <td className="py-1.5 pr-2 text-right text-foreground">
                  {formatValue(a.value)}
                </td>
                <td className="py-1.5 text-right font-semibold text-negative">
                  {a.z.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CategoryPanel({ dataset }: { dataset: Dataset }) {
  if (dataset.categoryNames.length === 0) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
      <CircleDot className="size-3 text-primary" />
      CATEGORY COLUMNS:
      {dataset.categoryNames.map((c) => (
        <span
          key={c}
          className="rounded-sm border border-border bg-surface px-1.5 py-0.5 text-foreground"
        >
          {prettyName(c)}
        </span>
      ))}
    </p>
  );
}

/* ---------------- Page ---------------- */

function Dashboard() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [normalized, setNormalized] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  const active = useActiveConfig();
  // Re-check freshness every 30 s so a live feed that stops updating turns stale on screen.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  // Rule-based safety classification: deterministic, independent of the AI model.
  const assessment = useMemo(
    () => (dataset ? assessSafety(dataset, active.config, { now }) : null),
    [dataset, active, now],
  );
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const showDataset = (d: Dataset) => {
    setDataset(d);
    setSelected(d.numericNames.slice(0, 5));
    setNormalized(false);
    setLoadError(null);
  };

  // Fresh upload or demo: analyse automatically, as before.
  const handleDataset = (d: Dataset) => {
    showDataset(d);
    setAnalysis(null);
    setSavedRunId(null);
    setRunKey((k) => k + 1);
  };

  // Saved run: show the stored analysis without calling the model again.
  const handleLoadRun = (run: SavedRun) => {
    try {
      showDataset(buildDataset(run.csvText, run.name));
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Could not read the saved run.",
      );
      return;
    }
    setSavedRunId(run.id);
    if (run.insights && run.model && run.analysedAt) {
      setAnalysis({
        insights: run.insights,
        model: run.model,
        analysedAt: run.analysedAt,
      });
    } else {
      setAnalysis(null);
    }
  };

  const toggle = (name: string) =>
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );

  const stats = useMemo(() => {
    if (!dataset) return null;
    const outlierTotal = dataset.numericNames.reduce(
      (sum, n) =>
        sum +
        (dataset.columns.find((c) => c.name === n)?.stats?.anomalyCount ?? 0),
      0,
    );
    let span = "—";
    if (dataset.timeColumn) {
      const labels = dataset.rows.map((r) =>
        String(r[dataset.timeColumn!] ?? ""),
      );
      span = `${labels[0] ?? ""} → ${labels[labels.length - 1] ?? ""}`;
    }
    return { outlierTotal, span };
  }, [dataset]);

  return (
    <div className="min-h-screen">
      <HazardStrip />

      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-md border border-primary/50 bg-primary/10">
              <HardHat className="size-6 text-primary" />
            </span>
            <div>
              <h1 className="font-display text-3xl leading-none tracking-widest text-foreground text-glow">
                STRATA
              </h1>
              <p className="font-mono text-[10px] tracking-[0.25em] text-muted-foreground">
                MINE DATA INTELLIGENCE
              </p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-wider">
            <AiStatusBadge />
            <span
              className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 ${
                dataset
                  ? "border-positive/50 bg-positive/10 text-positive"
                  : "border-border bg-surface-2 text-muted-foreground"
              }`}
            >
              <Waves className={`size-3 ${dataset ? "status-blink" : ""}`} />
              {dataset ? "SIGNAL LIVE" : "AWAITING FEED"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-4 py-8 sm:px-6">
        {/* 01 — Ingest */}
        <section>
          <SectionHeader
            index="01"
            title="FEED INTAKE"
            right={
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
                CSV · AUTO-TYPED COLUMNS
              </span>
            }
          />
          <UploadZone onDataset={handleDataset} compact={!!dataset} />

          {dataset && stats && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <StatBlock label="ROWS" value={String(dataset.rowCount)} />
              <StatBlock
                label="NUMERIC PARAMS"
                value={String(dataset.numericNames.length)}
              />
              <StatBlock
                label="TIME COLUMN"
                value={
                  dataset.timeColumn ? prettyName(dataset.timeColumn) : "NONE"
                }
              />
              <StatBlock label="WINDOW" value={stats.span} />
              <StatBlock
                label="OUTLIERS TOTAL"
                value={String(stats.outlierTotal)}
              />
            </div>
          )}

          {loadError && (
            <p className="mt-3 flex items-center gap-2 font-mono text-xs text-negative">
              <TriangleAlert className="size-3.5" />
              {loadError}
            </p>
          )}

          <SavedRunsPanel
            dataset={dataset}
            analysis={analysis}
            savedRunId={savedRunId}
            onSaved={setSavedRunId}
            onLoad={handleLoadRun}
            onDeleted={(id) => {
              if (id === savedRunId) setSavedRunId(null);
            }}
          />
        </section>

        {/* 02 — Trend console */}
        <section>
          <SectionHeader
            index="02"
            title="TREND CONSOLE"
            right={
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
                MULTI-PARAMETER OVERLAY
              </span>
            }
          />
          {dataset ? (
            <TrendConsole
              dataset={dataset}
              selected={selected}
              normalized={normalized}
              onToggle={toggle}
              onNormalized={setNormalized}
            />
          ) : (
            <EmptyChartNote />
          )}
        </section>

        {/* 03 — Parameter deck */}
        <section>
          <SectionHeader
            index="03"
            title="PARAMETER DECK"
            right={
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
                1-HOUR MOVING AVERAGE PER PARAMETER (TRAILING 60 MIN)
              </span>
            }
          />
          {dataset ? (
            <div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {dataset.numericNames.map((name, i) => (
                  <MiniChart
                    key={name}
                    dataset={dataset}
                    column={name}
                    colorIndex={i}
                  />
                ))}
              </div>
              <CategoryPanel dataset={dataset} />
            </div>
          ) : (
            <EmptyChartNote />
          )}
        </section>

        {/* 04 — Cross-signals */}
        <section>
          <SectionHeader index="04" title="CROSS-SIGNALS" />
          {dataset ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <CorrelationPanel dataset={dataset} />
              <AnomalyPanel dataset={dataset} />
            </div>
          ) : (
            <EmptyChartNote />
          )}
        </section>

        {/* 05 — AI analyst */}
        <section>
          <SectionHeader
            index="05"
            title="AI ANALYST"
            right={
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
                LOCAL MODEL · RUNS ON THIS COMPUTER
              </span>
            }
          />
          {dataset && assessment && (
            <SafetyPanel assessment={assessment} active={active} />
          )}
          <AnalystPanel
            dataset={dataset}
            assessment={assessment}
            analysis={analysis}
            runKey={runKey}
            onAnalysis={setAnalysis}
          />
        </section>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
          <p className="font-mono text-[10px] tracking-wider text-muted-foreground">
            STRATA // ALL READINGS COMPUTED IN YOUR BROWSER FROM THE UPLOADED
            LOG · AI READ BY A LOCAL MODEL ON THIS COMPUTER · NOTHING LEAVES
            THIS MACHINE
          </p>
        </div>
      </footer>

      <HazardStrip />
    </div>
  );
}
