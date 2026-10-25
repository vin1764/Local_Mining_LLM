/**
 * In-browser inference with WebLLM (WebGPU). The model runs on the visitor's
 * own GPU inside a Web Worker; the dataset never leaves the device. The model
 * files are downloaded once from WebLLM's model hosts and cached by the browser.
 */
import {
  CreateWebWorkerMLCEngine,
  hasModelInCache,
  prebuiltAppConfig,
  type WebWorkerMLCEngine,
} from "@mlc-ai/web-llm";

import {
  LocalAiError,
  type LocalInferenceProvider,
  type ProviderStatus,
  type StructuredRequest,
  type StructuredResult,
} from "./provider";
import {
  emitProgress as emit,
  gpuSupportsF16,
  webGpuAvailable,
} from "./webllm-progress";
import { WEBLLM_MODEL } from "./webllm-model";

export { WEBLLM_MODEL };

const TEMPERATURE = 0.2;
const MAX_TOKENS = 900;

let resolvedModel: string | null = null;

/**
 * The configured model, or its 32-bit-float build when the GPU cannot run
 * 16-bit shaders (same weights, a little larger).
 */
export async function resolveModelId(): Promise<string> {
  if (resolvedModel) return resolvedModel;
  let id = WEBLLM_MODEL;
  if (id.includes("q4f16_1") && !(await gpuSupportsF16())) {
    const alt = id.replace("q4f16_1", "q4f32_1");
    if (prebuiltAppConfig.model_list.some((m) => m.model_id === alt)) id = alt;
  }
  resolvedModel = id;
  return id;
}

function modelRecord() {
  const id = resolvedModel ?? WEBLLM_MODEL;
  return prebuiltAppConfig.model_list.find((m) => m.model_id === id);
}

/** Rough download size: WebLLM lists VRAM need; weights are a bit smaller. */
export function approxDownloadMB(): number {
  return Math.round((modelRecord()?.vram_required_MB ?? 1200) * 0.6);
}

let engine: WebWorkerMLCEngine | null = null;
let enginePromise: Promise<WebWorkerMLCEngine> | null = null;
export function engineLoaded(): boolean {
  return engine !== null;
}

function loadEngine(modelId: string): Promise<WebWorkerMLCEngine> {
  if (engine) return Promise.resolve(engine);
  if (!enginePromise) {
    const worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), {
      type: "module",
    });
    enginePromise = CreateWebWorkerMLCEngine(worker, modelId, {
      initProgressCallback: (r) => emit({ text: r.text, progress: r.progress }),
    })
      .then((e) => {
        engine = e;
        emit(null);
        return e;
      })
      .catch((error: unknown) => {
        enginePromise = null;
        worker.terminate();
        emit(null);
        throw error;
      });
  }
  return enginePromise;
}

function describeLoadError(error: unknown): LocalAiError {
  const msg = error instanceof Error ? error.message : String(error);
  if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) {
    return new LocalAiError(
      "unreachable",
      "The AI model could not be downloaded.",
      "The first run needs an internet connection to download the model. After that it is cached in this browser.",
    );
  }
  if (/memory|OOM|device lost|out of/i.test(msg)) {
    return new LocalAiError(
      "runtime_error",
      "Your graphics card ran out of memory while loading the model.",
      "Close other GPU-heavy tabs or apps and retry, or use a computer with a stronger GPU.",
    );
  }
  return new LocalAiError(
    "runtime_error",
    `The in-browser model failed to load: ${msg.slice(0, 200)}`,
  );
}

export class WebLlmProvider implements LocalInferenceProvider {
  readonly name = "webllm";
  get model(): string {
    return resolvedModel ?? WEBLLM_MODEL;
  }

  async status(): Promise<ProviderStatus> {
    const base = {
      provider: this.name,
      model: this.model,
      baseUrl: "in-browser (WebGPU)",
      runtimeVersion: null,
      installedModels: [] as string[],
      downloadSizeMB: approxDownloadMB(),
    };
    if (!(await webGpuAvailable())) {
      return {
        ...base,
        reachable: false,
        modelInstalled: false,
        unsupported: true,
        message:
          "This browser cannot run the AI model (WebGPU is not available).",
        hint: "Open this page in a recent Chrome or Edge on a desktop or laptop. Charts and statistics still work here.",
      };
    }
    const modelId = await resolveModelId();
    const withModel = {
      ...base,
      model: modelId,
      downloadSizeMB: approxDownloadMB(),
    };
    let cached = engineLoaded();
    if (!cached) {
      try {
        cached = await hasModelInCache(modelId);
      } catch {
        cached = false;
      }
    }
    return {
      ...withModel,
      reachable: true,
      modelInstalled: cached,
      message: cached
        ? `The AI model ${modelId} is ready in this browser.`
        : `The AI model (about ${withModel.downloadSizeMB} MB) has not been downloaded to this browser yet.`,
      ...(cached
        ? {}
        : {
            hint: "It downloads once when you run an analysis, then works offline in this browser.",
          }),
    };
  }

  async generateStructured(
    request: StructuredRequest,
  ): Promise<StructuredResult> {
    if (!(await webGpuAvailable())) {
      throw new LocalAiError(
        "unsupported",
        "This browser cannot run the AI model (WebGPU is not available).",
        "Open this page in a recent Chrome or Edge on a desktop or laptop.",
      );
    }
    const started = Date.now();
    let e: WebWorkerMLCEngine;
    try {
      e = await loadEngine(await resolveModelId());
    } catch (error) {
      throw describeLoadError(error);
    }
    if (request.signal?.aborted)
      throw new LocalAiError("cancelled", "The analysis was cancelled.");

    const onAbort = () => {
      void e.interruptGenerate();
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    let content: string;
    try {
      const reply = await e.chat.completions.create({
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        response_format: {
          type: "json_object",
          schema: JSON.stringify(request.jsonSchema),
        },
      });
      content = reply.choices[0]?.message?.content ?? "";
    } catch (error) {
      if (request.signal?.aborted)
        throw new LocalAiError("cancelled", "The analysis was cancelled.");
      throw describeLoadError(error);
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
    }
    if (request.signal?.aborted)
      throw new LocalAiError("cancelled", "The analysis was cancelled.");

    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      throw new LocalAiError(
        "bad_response",
        "The model did not return valid JSON.",
        "Retry the analysis.",
      );
    }
    return { value, model: this.model, durationMs: Date.now() - started };
  }
}
