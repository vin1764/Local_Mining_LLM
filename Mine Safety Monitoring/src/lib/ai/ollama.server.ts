import type { LocalAiConfig } from "./config.server";
import {
  LocalAiError,
  type LocalInferenceProvider,
  type ProviderStatus,
  type StructuredRequest,
  type StructuredResult,
} from "./provider";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const STATUS_TIMEOUT_MS = 4_000;

function setupHint(model: string) {
  return {
    unreachable:
      "Start Ollama (open the Ollama app, or run `ollama serve` in a terminal), then retry. " +
      "Install it from https://ollama.com/download if it is not installed.",
    modelMissing: `Download the model once while online: \`ollama pull ${model}\`, then retry.`,
  };
}

/** True when an installed Ollama tag satisfies the configured model name. */
export function modelMatches(installed: string, wanted: string): boolean {
  const a = installed.toLowerCase();
  const b = wanted.toLowerCase();
  if (a === b) return true;
  // "qwen2.5" means "qwen2.5:latest" in Ollama.
  if (!b.includes(":") && a === `${b}:latest`) return true;
  if (!a.includes(":") && b === `${a}:latest`) return true;
  return false;
}

function combineSignals(signals: (AbortSignal | undefined)[]): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => !!s);
  if (typeof AbortSignal.any === "function") return AbortSignal.any(list);
  const controller = new AbortController();
  for (const s of list) {
    if (s.aborted) controller.abort(s.reason);
    else
      s.addEventListener("abort", () => controller.abort(s.reason), {
        once: true,
      });
  }
  return controller.signal;
}

function isAbortError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    ((error as { name: string }).name === "AbortError" ||
      (error as { name: string }).name === "TimeoutError")
  );
}

export class OllamaProvider implements LocalInferenceProvider {
  readonly name = "ollama";
  readonly model: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: LocalAiConfig,
    fetchImpl?: FetchLike,
  ) {
    this.model = config.model;
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private url(path: "/api/version" | "/api/tags" | "/api/chat") {
    // Only fixed Ollama routes on the configured, validated base URL.
    return `${this.config.ollamaBaseUrl}${path}`;
  }

  async status(signal?: AbortSignal): Promise<ProviderStatus> {
    const hints = setupHint(this.model);
    const base = {
      provider: this.name,
      model: this.model,
      baseUrl: this.config.ollamaBaseUrl,
    };
    const timeout = AbortSignal.timeout(STATUS_TIMEOUT_MS);
    const combined = combineSignals([signal, timeout]);

    let runtimeVersion: string | null = null;
    let installedModels: string[] = [];
    try {
      const v = await this.fetchImpl(this.url("/api/version"), {
        signal: combined,
      });
      if (v.ok) {
        const body = (await v.json()) as { version?: unknown };
        runtimeVersion = typeof body.version === "string" ? body.version : null;
      }
      const tags = await this.fetchImpl(this.url("/api/tags"), {
        signal: combined,
      });
      if (!tags.ok) throw new Error(`HTTP ${tags.status}`);
      const body = (await tags.json()) as {
        models?: { name?: unknown; model?: unknown }[];
      };
      installedModels = (body.models ?? [])
        .map((m) =>
          typeof m.name === "string"
            ? m.name
            : typeof m.model === "string"
              ? m.model
              : "",
        )
        .filter(Boolean);
    } catch {
      return {
        ...base,
        reachable: false,
        modelInstalled: false,
        runtimeVersion: null,
        installedModels: [],
        message: `Ollama is not reachable at ${this.config.ollamaBaseUrl}.`,
        hint: hints.unreachable,
      };
    }

    const modelInstalled = installedModels.some((m) =>
      modelMatches(m, this.model),
    );
    return {
      ...base,
      reachable: true,
      modelInstalled,
      runtimeVersion,
      installedModels,
      message: modelInstalled
        ? `Local model ${this.model} is ready.`
        : `Ollama is running, but the model ${this.model} is not downloaded.`,
      ...(modelInstalled ? {} : { hint: hints.modelMissing }),
    };
  }

  async generateStructured(
    request: StructuredRequest,
  ): Promise<StructuredResult> {
    const hints = setupHint(this.model);
    const started = Date.now();
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const signal = combineSignals([request.signal, timeout]);

    let response: Response;
    try {
      response = await this.fetchImpl(this.url("/api/chat"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: request.jsonSchema,
          keep_alive: "15m",
          options: {
            temperature: this.config.temperature,
            num_ctx: this.config.numCtx,
          },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
        }),
      });
    } catch (error) {
      if (request.signal?.aborted) {
        throw new LocalAiError("cancelled", "The analysis was cancelled.");
      }
      if (timeout.aborted || isAbortError(error)) {
        throw new LocalAiError(
          "timeout",
          `The local model did not answer within ${Math.round(this.config.timeoutMs / 1000)} s.`,
          "The first request after starting Ollama loads the model and is slower. Retry, or raise OLLAMA_TIMEOUT_MS.",
        );
      }
      throw new LocalAiError(
        "unreachable",
        `Could not connect to Ollama at ${this.config.ollamaBaseUrl}.`,
        hints.unreachable,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let message = "";
      try {
        const parsed = JSON.parse(text) as { error?: unknown };
        message = typeof parsed.error === "string" ? parsed.error : "";
      } catch {
        message = text.slice(0, 200);
      }
      if (response.status === 404 || /not found/i.test(message)) {
        throw new LocalAiError(
          "model_missing",
          `The model ${this.model} is not available in Ollama.`,
          hints.modelMissing,
        );
      }
      throw new LocalAiError(
        "runtime_error",
        `Ollama returned an error (HTTP ${response.status})${message ? `: ${message}` : "."}`,
      );
    }

    let content: string;
    let servedModel = this.model;
    try {
      const body = (await response.json()) as {
        message?: { content?: unknown };
        model?: unknown;
      };
      if (typeof body.message?.content !== "string")
        throw new Error("no content");
      content = body.message.content;
      if (typeof body.model === "string") servedModel = body.model;
    } catch {
      throw new LocalAiError(
        "bad_response",
        "Ollama sent a response the app could not read.",
      );
    }

    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      throw new LocalAiError(
        "bad_response",
        "The local model did not return valid JSON.",
        "Retry the analysis. Small models occasionally break format.",
      );
    }

    return { value, model: servedModel, durationMs: Date.now() - started };
  }
}
