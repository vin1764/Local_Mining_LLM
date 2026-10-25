import type { DatasetProfile } from "@/lib/dataset";
import { ConfigError } from "./config-error";
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
import { LocalAiError, type LocalInferenceProvider } from "./provider";
import type { AnalyzeResult } from "./types";

export function failResult(error: unknown): AnalyzeResult {
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
        hint: "Check your configuration (.env file).",
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

/**
 * The full analysis flow, independent of where the model runs:
 * validate → plan code-written findings → prompt → check → retry/fallback.
 * Used by the Ollama server and by the in-browser (WebLLM) build.
 */
export async function runAnalysis(
  input: unknown,
  options: {
    provider: LocalInferenceProvider | (() => LocalInferenceProvider);
    signal?: AbortSignal;
  },
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
    provider =
      typeof options.provider === "function"
        ? options.provider()
        : options.provider;
  } catch (error) {
    return failResult(error);
  }

  const signal = options.signal;
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
      return failResult(error);
    }
  }

  if (!best)
    return failResult(
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
