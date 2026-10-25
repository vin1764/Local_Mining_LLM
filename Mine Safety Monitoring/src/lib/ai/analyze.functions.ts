import { createServerFn } from "@tanstack/react-start";

import type { DatasetInsights, DatasetProfile } from "@/lib/dataset";
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

export const analyzeDataset = createServerFn({ method: "POST" })
  .inputValidator((input: DatasetProfile) => input)
  .handler(async ({ data }): Promise<AnalyzeResult> => {
    // Server-only modules are loaded inside the handler so they never reach the client bundle.
    const { runLocalAnalysis } = await import("./analyst.server");
    return runLocalAnalysis(data);
  });

export const getAiStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<AiStatus> => {
    const { getLocalAiStatus } = await import("./analyst.server");
    return getLocalAiStatus();
  },
);
