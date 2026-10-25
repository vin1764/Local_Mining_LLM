import type { DatasetInsights } from "@/lib/dataset";
import type { LocalAiErrorCode, ProviderStatus } from "./provider";

export type { DatasetInsights };

/** Predictable response envelope for the AI analyst endpoint. */
export type AnalyzeResult =
  | {
      ok: true;
      insights: DatasetInsights;
      meta: {
        provider: string;
        model: string;
        durationMs: number;
        /** Model sentences dropped for contradicting the data. */
        droppedItems: number;
        /** "code" when the model's summary contradicted the data and was replaced. */
        summarySource: "model" | "code";
      };
    }
  | {
      ok: false;
      error: { code: LocalAiErrorCode; message: string; hint?: string };
    };

export type AiStatus = ProviderStatus;

/** Progress while a browser model downloads or loads. */
export interface LoadProgress {
  text: string;
  /** 0..1 */
  progress: number;
}

/**
 * How the UI reaches the AI analyst. React components use only this.
 * - "server": the Node app calls Ollama on this computer (npm start / npm run dev).
 * - "browser": the model runs in the visitor's browser with WebGPU (GitHub Pages build).
 */
export interface AiClient {
  mode: "server" | "browser";
  analyze(profile: unknown, signal?: AbortSignal): Promise<AnalyzeResult>;
  status(): Promise<AiStatus>;
  /** Browser mode: the visitor agreed to download the model. */
  allowDownload?(): void;
  /** Browser mode: model download/load progress. Returns an unsubscribe function. */
  subscribeProgress?(cb: (p: LoadProgress | null) => void): () => void;
}
