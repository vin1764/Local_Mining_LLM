import { getRequest } from "@tanstack/react-start/server";

import { runAnalysis } from "./analyst";
import { loadLocalAiConfig } from "./config.server";
import { OllamaProvider } from "./ollama.server";
import type { LocalInferenceProvider } from "./provider";
import type { AiStatus, AnalyzeResult } from "./types";

/** Swap this factory to plug in another local runtime (llama.cpp, LM Studio, ...). */
export function createProvider(
  env: Record<string, string | undefined> = process.env,
): LocalInferenceProvider {
  return new OllamaProvider(loadLocalAiConfig(env));
}

function requestSignal(): AbortSignal | undefined {
  try {
    return getRequest().signal;
  } catch {
    return undefined;
  }
}

export function runLocalAnalysis(
  input: unknown,
  options: { provider?: LocalInferenceProvider; signal?: AbortSignal } = {},
): Promise<AnalyzeResult> {
  const signal = options.signal ?? requestSignal();
  return runAnalysis(input, {
    provider: options.provider ?? (() => createProvider()),
    ...(signal ? { signal } : {}),
  });
}

export async function getLocalAiStatus(): Promise<AiStatus> {
  try {
    return await createProvider().status(requestSignal());
  } catch (error) {
    return {
      provider: "ollama",
      model: process.env["OLLAMA_MODEL"] ?? "",
      baseUrl: process.env["OLLAMA_BASE_URL"] ?? "",
      reachable: false,
      modelInstalled: false,
      runtimeVersion: null,
      installedModels: [],
      message:
        error instanceof Error ? error.message : "Local AI is not configured.",
      hint: "Check the values in your .env file.",
    };
  }
}
