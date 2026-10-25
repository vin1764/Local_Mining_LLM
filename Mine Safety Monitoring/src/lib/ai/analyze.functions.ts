import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { DatasetProfile } from "@/lib/dataset";

const insightsSchema = z.strictObject({
  headline: z
    .string()
    .describe("One punchy operational headline, max 12 words, mining report tone."),
  summary: z.string().describe("2-4 sentence situational summary of the dataset."),
  findings: z
    .array(
      z.strictObject({
        parameter: z.string(),
        observation: z.string(),
        severity: z.enum(["normal", "watch", "critical"]),
      }),
    )
    .describe("3-6 findings, each tied to a specific parameter column."),
  recommendations: z
    .array(z.string())
    .describe("2-5 concrete, short operational recommendations."),
});

export type DatasetInsights = z.infer<typeof insightsSchema>;

export const analyzeDataset = createServerFn({ method: "POST" })
  .inputValidator((input: DatasetProfile) => input)
  .handler(async ({ data }): Promise<DatasetInsights> => {
    // Loaded inside the handler so the AI SDK never ships to the client bundle.
    const { runStructuredCall, safeAiErrorMessage } = await import("./gateway.server");

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      throw new Error("The analysis layer is not configured (missing AI key).");
    }

    const instructions = [
      "You are STRATA's resident mine-data analyst: a pragmatic mining engineer who reads",
      "sensor logs and operations CSVs and calls out what actually matters.",
      "You are given a compact statistical profile of one CSV dataset: per-column stats,",
      "trends, correlations, z-score anomalies and a few sample rows.",
      "Rules:",
      "- Ground every claim in the provided numbers; never invent data.",
      "- Reference parameters by their column names (they may be snake_case — use them as-is).",
      "- Trend and correlation are statistical, not causal; phrase accordingly.",
      "- Flag anomalies with their labels and z-scores when they matter operationally.",
      "- Keep the tone of a daily shift report: direct, technical, no fluff.",
      "- severity: 'normal' = healthy trend, 'watch' = drift or moderate risk, 'critical' = needs action.",
    ].join("\n");

    const prompt = [
      "DATASET PROFILE (JSON):",
      JSON.stringify(data),
      "",
      "Produce the structured analysis now.",
    ].join("\n");

    try {
      return await runStructuredCall<DatasetInsights>({
        apiKey,
        instructions,
        prompt,
        schema: insightsSchema,
        schemaName: "MineAnalysis",
      });
    } catch (error) {
      throw new Error(safeAiErrorMessage(error));
    }
  });
