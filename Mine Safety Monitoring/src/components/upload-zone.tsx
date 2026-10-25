import { useCallback, useRef, useState } from "react";
import { FileUp, FlaskConical, TriangleAlert } from "lucide-react";

import { buildDataset, buildDemoDataset, type Dataset } from "@/lib/dataset";

const MAX_BYTES = 12 * 1024 * 1024;

interface Props {
  onDataset: (dataset: Dataset) => void;
  compact?: boolean;
}

export function UploadZone({ onDataset, compact = false }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ingest = useCallback(
    (text: string, name: string) => {
      try {
        const dataset = buildDataset(text, name);
        setError(null);
        setFileName(name);
        onDataset(dataset);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read that file.");
        setFileName(null);
      }
    },
    [onDataset],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_BYTES) {
        setError("File is too large — keep it under 12 MB.");
        return;
      }
      const text = await file.text();
      ingest(text, file.name);
    },
    [ingest],
  );

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-stretch">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        className={`group flex cursor-pointer items-center gap-4 rounded-md border border-dashed px-5 py-4 transition-colors ${
          dragging
            ? "border-primary bg-primary/10"
            : "border-border bg-surface-2/50 hover:border-primary/60 hover:bg-surface-2"
        }`}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-primary">
          <FileUp className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold tracking-wider text-foreground">
            DROP CSV LOG — OR CLICK TO BROWSE
          </p>
          {!compact && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Column types auto-detected · numeric, time &amp; category · max 12 MB
            </p>
          )}
          {fileName && (
            <p className="mt-0.5 truncate font-mono text-[11px] text-positive">
              LOADED: {fileName}
            </p>
          )}
        </div>
      </div>

  <button
        onClick={() => onDataset(buildDemoDataset())}
        className="flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 font-mono text-xs font-semibold tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <FlaskConical className="size-4" />
        LOAD DEMO ORE SAMPLE
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,.txt"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) await handleFile(file);
          e.target.value = "";
        }}
      />

      {error && (
        <p className="md:col-span-2 flex items-center gap-2 font-mono text-xs text-negative">
          <TriangleAlert className="size-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}
