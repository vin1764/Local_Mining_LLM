// Default AI client: the local Node app calls Ollama on this computer.
// The GitHub Pages build swaps this module for client.browser.ts (see vite.pages.config.ts).
import { analyzeDataset, getAiStatus } from "./analyze.functions";
import type { AiClient } from "./types";
import type { DatasetProfile } from "@/lib/dataset";

export const aiClient: AiClient = {
  mode: "server",
  analyze: (profile, signal) =>
    analyzeDataset({
      data: profile as DatasetProfile,
      ...(signal ? { signal } : {}),
    }),
  status: () => getAiStatus(),
};
