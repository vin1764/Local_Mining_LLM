import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FolderOpen, Save, Trash2, TriangleAlert } from "lucide-react";

import type { Dataset } from "@/lib/dataset";
import type { AnalysisRecord } from "@/lib/report";
import {
  deleteRun,
  getRun,
  listRuns,
  saveRun,
  type SavedRun,
} from "@/lib/storage/runs";

interface Props {
  dataset: Dataset | null;
  analysis: AnalysisRecord | null;
  savedRunId: string | null;
  onSaved: (id: string) => void;
  onLoad: (run: SavedRun) => void;
  onDeleted: (id: string) => void;
}

const btn =
  "flex items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 py-1 font-mono text-[10px] tracking-wider text-foreground transition-colors hover:border-primary/60 disabled:opacity-50";

/** Save the current CSV + AI report to this browser, and reopen saved runs. */
export function SavedRunsPanel({
  dataset,
  analysis,
  savedRunId,
  onSaved,
  onLoad,
  onDeleted,
}: Props) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const runs = useQuery({
    queryKey: ["saved-runs"],
    queryFn: listRuns,
    enabled: typeof window !== "undefined",
    retry: false,
  });

  const save = useMutation({
    mutationFn: () =>
      saveRun({
        ...(savedRunId ? { id: savedRunId } : {}),
        name: dataset!.name,
        rowCount: dataset!.rowCount,
        csvText: dataset!.sourceText,
        insights: analysis?.insights ?? null,
        model: analysis?.model ?? null,
        analysedAt: analysis?.analysedAt ?? null,
      }),
    onSuccess: (run) => {
      setError(null);
      onSaved(run.id);
      void qc.invalidateQueries({ queryKey: ["saved-runs"] });
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : "Could not save."),
  });

  const load = useMutation({
    mutationFn: async (id: string) => {
      const run = await getRun(id);
      if (!run) throw new Error("That saved run no longer exists.");
      return run;
    },
    onSuccess: (run) => {
      setError(null);
      onLoad(run);
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : "Could not open."),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await deleteRun(id);
      return id;
    },
    onSuccess: (id) => {
      onDeleted(id);
      void qc.invalidateQueries({ queryKey: ["saved-runs"] });
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : "Could not delete."),
  });

  const list = runs.data ?? [];

  return (
    <div className="mt-4 rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wider text-foreground">
          <Archive className="size-3.5 text-primary" />
          SAVED RUNS · STORED IN THIS BROWSER
        </p>
        <button
          className={`${btn} ml-auto`}
          disabled={!dataset || save.isPending}
          onClick={() => save.mutate()}
          title={
            analysis
              ? "Save the CSV and its AI report"
              : "Save the CSV (no AI report yet)"
          }
        >
          <Save className="size-3.5" />
          {savedRunId ? "UPDATE SAVED RUN" : "SAVE CURRENT RUN"}
        </button>
      </div>

      {(error || runs.isError) && (
        <p className="mt-2 flex items-center gap-2 font-mono text-[11px] text-negative">
          <TriangleAlert className="size-3.5" />
          {error ??
            (runs.error instanceof Error
              ? runs.error.message
              : "Local storage unavailable.")}
        </p>
      )}

      {list.length === 0 ? (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          Nothing saved yet. Saved runs stay on this computer and survive
          restarts.
        </p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {list.map((r) => (
            <li
              key={r.id}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border px-2 py-1.5 font-mono text-[11px] ${
                r.id === savedRunId
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/60"
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-foreground">
                {r.name}
              </span>
              <span className="text-muted-foreground">{r.rowCount} ROWS</span>
              <span
                className={
                  r.insights ? "text-positive" : "text-muted-foreground"
                }
              >
                {r.insights ? "AI REPORT" : "NO REPORT"}
              </span>
              <span className="text-muted-foreground">
                {new Date(r.savedAt).toLocaleString()}
              </span>
              <button
                className={btn}
                onClick={() => load.mutate(r.id)}
                disabled={load.isPending}
              >
                <FolderOpen className="size-3.5" />
                OPEN
              </button>
              <button
                className={btn}
                aria-label={`Delete ${r.name}`}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete the saved run "${r.name}"? This cannot be undone.`,
                    )
                  ) {
                    remove.mutate(r.id);
                  }
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
