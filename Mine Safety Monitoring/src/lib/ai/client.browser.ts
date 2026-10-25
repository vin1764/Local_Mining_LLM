// AI client for the GitHub Pages build: the model runs in the visitor's browser.
import { runAnalysis } from "./analyst";
import { LocalAiError } from "./provider";
import type { AiClient } from "./types";
import { WEBLLM_MODEL } from "./webllm-model";
import { subscribeProgress, webGpuAvailable } from "./webllm-progress";

// WebLLM is large; load it on first use so the dashboard appears immediately.
let mod: Promise<typeof import("./webllm")> | null = null;
const webllm = () => (mod ??= import("./webllm"));
let provider: import("./webllm").WebLlmProvider | null = null;
async function getProvider() {
  if (!provider) provider = new (await webllm()).WebLlmProvider();
  return provider;
}

const unsupportedStatus = {
  provider: "webllm",
  model: WEBLLM_MODEL,
  baseUrl: "in-browser (WebGPU)",
  reachable: false,
  modelInstalled: false,
  unsupported: true,
  runtimeVersion: null,
  installedModels: [],
  message: "This browser cannot run the AI model (WebGPU is not available).",
  hint: "Open this page in a recent Chrome or Edge on a desktop or laptop. Charts and statistics still work here.",
};

let downloadAllowed = false;

export const aiClient: AiClient = {
  mode: "browser",
  async status() {
    // Check WebGPU first so unsupported devices never download the library.
    if (!(await webGpuAvailable())) return unsupportedStatus;
    return (await getProvider()).status();
  },
  allowDownload: () => {
    downloadAllowed = true;
  },
  subscribeProgress,
  async analyze(profile, signal) {
    if (!(await webGpuAvailable())) {
      return {
        ok: false,
        error: {
          code: "unsupported",
          message: unsupportedStatus.message,
          hint: unsupportedStatus.hint,
        },
      };
    }
    const p = await getProvider();
    const { engineLoaded, approxDownloadMB } = await webllm();
    // Never start a ~1 GB download without the visitor saying yes.
    if (!engineLoaded() && !downloadAllowed) {
      const s = await p.status();
      if (!s.modelInstalled) {
        const err = new LocalAiError(
          "consent_required",
          `The AI analyst runs inside your browser and needs a one-time model download (about ${approxDownloadMB()} MB).`,
          "The model is stored in this browser and works offline afterwards. Your data never leaves this device.",
        );
        return {
          ok: false,
          error: { code: err.code, message: err.message, hint: err.hint! },
        };
      }
    }
    return runAnalysis(profile, { provider: p, ...(signal ? { signal } : {}) });
  },
};
