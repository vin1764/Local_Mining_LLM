import { getRequest } from "@tanstack/react-start/server";

import type { DatasetProfile } from "@/lib/dataset";
import type { AiStatus, AnalyzeResult } from "./analyze.functions";
import { ConfigError, loadLocalAiConfig } from "./config.server";
import {
  SYSTEM_INSTRUCTIONS,
  buildUserPrompt,
  fallbackSummary,
  insightsJsonSchema,
  normaliseInsights,
  planFindings,
  profileSchema,
  type NormaliseOutcome,
} from "./insights";
import { OllamaProvider } from "./ollama.server";
import { LocalAiError, type LocalInferenceProvider } from "./provider";

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

function fail(error: unknown): AnalyzeResult {
  if (error instanceof LocalAiError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
      },
    };
  }
  if (error instanceof ConfigError) {
    return {
      ok: false,
      error: {
        code: "config",
        message: error.message,
        hint: "Check the values in your .env file.",
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "runtime_error",
      message: "The local analysis failed unexpectedly.",
    },
  };
}

/** Log metadata only: never dataset contents or model text. */
function log(event: string, fields: Record<string, string | number | boolean>) {
  console.info(
    `[local-ai] ${event} ${Object.entries(fields)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );
}

export async function runLocalAnalysis(
  input: unknown,
  options: { provider?: LocalInferenceProvider; signal?: AbortSignal } = {},
): Promise<AnalyzeResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: "The dataset summary sent to the analyst was not valid.",
      },
    };
  }
  const profile = parsed.data as DatasetProfile;

  let provider: LocalInferenceProvider;
  try {
    provider = options.provider ?? createProvider();
  } catch (error) {
    return fail(error);
  }

  const signal = options.signal ?? requestSignal();
  const planned = planFindings(profile);
  if (planned.length === 0) {
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message:
          "This file has no numeric columns, so there is nothing for the analyst to explain.",
      },
    };
  }
  const prompt = buildUserPrompt(profile, planned);
  let totalMs = 0;
  let lastError: unknown = null;
  let best: NormaliseOutcome | null = null;
  let model = provider.model;

  // Up to two attempts: small models sometimes break format or flip a trend
  // direction. A second contradiction falls back to a code-written summary.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await provider.generateStructured({
        system: SYSTEM_INSTRUCTIONS,
        prompt,
        jsonSchema: insightsJsonSchema,
        ...(signal ? { signal } : {}),
      });
      totalMs += result.durationMs;
      model = result.model;
      const normalised = normaliseInsights(result.value, profile, planned);
      if (!normalised) {
        log("unusable_output", { model, attempt });
        lastError = new LocalAiError(
          "bad_response",
          "The local model's answer did not match the required report format.",
          "Retry the analysis, or try a larger local model (see README, Changing the model).",
        );
        continue;
      }
      best = normalised;
      if (!normalised.summaryContradicted) break;
      log("summary_contradicted", { model, attempt });
    } catch (error) {
      const code = error instanceof LocalAiError ? error.code : "unknown";
      log("error", { code, attempt });
      if (error instanceof LocalAiError && error.code === "bad_response") {
        lastError = error;
        continue;
      }
      return fail(error);
    }
  }

  if (!best)
    return fail(
      lastError ??
        new LocalAiError(
          "bad_response",
          "The local model did not produce a usable report.",
        ),
    );

  let insights = best.insights;
  let summarySource: "model" | "code" = "model";
  if (best.summaryContradicted) {
    insights = { ...insights, ...fallbackSummary(profile, planned) };
    summarySource = "code";
  }
  log("ok", {
    model,
    ms: totalMs,
    dropped: best.droppedItems,
    summary: summarySource,
  });
  return {
    ok: true,
    insights,
    meta: {
      provider: provider.name,
      model,
      durationMs: totalMs,
      droppedItems: best.droppedItems,
      summarySource,
    },
  };
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
