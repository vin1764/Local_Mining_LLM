// AI client for the GitHub Pages edition (static site).
//
// 1. Preferred: the STRATA app running on this computer (Node + Ollama),
//    reached at VITE_LOCAL_AI_URL (default http://127.0.0.1:8080). That app
//    must allow this page's origin (npm run start:with-pages).
// 2. Optional: the in-browser model (WebLLM + WebGPU), only after the visitor
//    chooses it, because it downloads about 1 GB.
// There is no cloud fallback.
import { runAnalysis } from "./analyst";
import { LocalAiError } from "./provider";
import type { AiClient, AiStatus, AnalyzeResult } from "./types";
import { WEBLLM_MODEL } from "./webllm-model";
import { subscribeProgress, webGpuAvailable } from "./webllm-progress";

export const LOCAL_AI_URL: string = (
  (import.meta.env["VITE_LOCAL_AI_URL"] as string | undefined) ||
  "http://127.0.0.1:8080"
).replace(/\/+$/, "");

const PREFER_BROWSER_KEY = "strata-use-browser-model";
const START_HINT =
  `Start the STRATA app on this computer with "npm run start:with-pages" (Ollama must be running), ` +
  `then retry. It must listen on ${LOCAL_AI_URL}. Use Chrome or Edge; allow access to local network devices if the browser asks.`;

// WebLLM is large; load it on first use so the dashboard appears immediately.
let mod: Promise<typeof import("./webllm")> | null = null;
const webllm = () => (mod ??= import("./webllm"));
let provider: import("./webllm").WebLlmProvider | null = null;
async function getProvider() {
  if (!provider) provider = new (await webllm()).WebLlmProvider();
  return provider;
}

function preferBrowser(): boolean {
  try {
    return globalThis.localStorage?.getItem(PREFER_BROWSER_KEY) === "1";
  } catch {
    return false;
  }
}
let downloadAllowed = preferBrowser();

async function localStatus(): Promise<AiStatus | null> {
  try {
    const res = await fetch(`${LOCAL_AI_URL}/api/local-ai/status`, {
      mode: "cors",
      credentials: "omit",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as AiStatus;
    return body && typeof body === "object" && "reachable" in body
      ? body
      : null;
  } catch {
    return null;
  }
}

function isAnalyzeResult(v: unknown): v is AnalyzeResult {
  return (
    !!v &&
    typeof v === "object" &&
    "ok" in v &&
    typeof (v as { ok: unknown }).ok === "boolean"
  );
}

async function analyzeViaLocal(
  profile: unknown,
  signal?: AbortSignal,
): Promise<AnalyzeResult> {
  try {
    const res = await fetch(`${LOCAL_AI_URL}/api/local-ai/analyze`, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
      ...(signal ? { signal } : {}),
    });
    const body: unknown = await res.json().catch(() => null);
    if (isAnalyzeResult(body)) return body;
    return {
      ok: false,
      error: {
        code: "runtime_error",
        message: `The local STRATA app returned an unexpected response (HTTP ${res.status}).`,
      },
    };
  } catch {
    if (signal?.aborted)
      return {
        ok: false,
        error: { code: "cancelled", message: "The analysis was cancelled." },
      };
    return {
      ok: false,
      error: {
        code: "backend_unavailable",
        message: "Lost the connection to the local STRATA app.",
        hint: START_HINT,
      },
    };
  }
}

export const aiClient: AiClient = {
  mode: "browser",
  async status() {
    const local = await localStatus();
    if (local) return local;
    const gpu = await webGpuAvailable();
    if (downloadAllowed && gpu) return (await getProvider()).status();
    return {
      provider: "local-backend",
      model: "",
      baseUrl: LOCAL_AI_URL,
      reachable: false,
      modelInstalled: false,
      runtimeVersion: null,
      installedModels: [],
      localBackendMissing: true,
      browserModelAvailable: gpu,
      message: `Local AI is not running: the STRATA app was not found at ${LOCAL_AI_URL}.`,
      hint: START_HINT,
    };
  },
  allowDownload: () => {
    downloadAllowed = true;
    try {
      globalThis.localStorage?.setItem(PREFER_BROWSER_KEY, "1");
    } catch {
      /* ignore */
    }
  },
  subscribeProgress,
  async analyze(profile, signal) {
    // 1. The local app (Ollama), when it is running and allows this page.
    if (await localStatus()) return analyzeViaLocal(profile, signal);

    // 2. The in-browser model, only if the visitor chose it.
    const gpu = await webGpuAvailable();
    if (!downloadAllowed) {
      const err = new LocalAiError(
        "backend_unavailable",
        "Local AI is not running. The AI analyst needs the STRATA app running on this computer.",
        START_HINT,
      );
      return {
        ok: false,
        error: { code: err.code, message: err.message, hint: err.hint! },
      };
    }
    if (!gpu) {
      return {
        ok: false,
        error: {
          code: "unsupported",
          message:
            "This browser cannot run the in-browser model (WebGPU is not available).",
          hint: START_HINT,
        },
      };
    }
    return runAnalysis(profile, {
      provider: await getProvider(),
      ...(signal ? { signal } : {}),
    });
  },
};

export { WEBLLM_MODEL };
