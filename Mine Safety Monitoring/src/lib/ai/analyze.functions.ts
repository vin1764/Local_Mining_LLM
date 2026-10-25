import { createServerFn } from "@tanstack/react-start";

import type { DatasetInsights, DatasetProfile } from "@/lib/dataset";
import type { AiStatus, AnalyzeResult } from "./types";

export type { DatasetInsights };

export type { AiStatus, AnalyzeResult } from "./types";

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
