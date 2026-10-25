// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDemoDataset, buildProfile } from "@/lib/dataset";

const state = {
  gpu: true,
  cached: false,
  loaded: false,
  answers: [] as unknown[],
};

vi.mock("@/lib/ai/webllm-progress", () => ({
  webGpuAvailable: async () => state.gpu,
  gpuSupportsF16: async () => true,
  subscribeProgress: () => () => {},
  emitProgress: () => {},
}));

vi.mock("@/lib/ai/webllm", () => ({
  engineLoaded: () => state.loaded,
  approxDownloadMB: () => 978,
  WebLlmProvider: class {
    name = "webllm";
    model = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
    async status() {
      return {
        reachable: true,
        modelInstalled: state.cached,
        message: "",
        model: this.model,
      };
    }
    async generateStructured() {
      state.loaded = true;
      return { value: state.answers.shift(), model: this.model, durationMs: 1 };
    }
  },
}));

const profile = buildProfile(buildDemoDataset());
const answer = {
  headline: "Ore grade fell while depth rose",
  summary: "ore_grade_pct fell 28.7% while depth_m rose 16.9%.",
  notes: [],
  recommendations: ["Review grade control samples."],
};

async function freshClient() {
  vi.resetModules();
  return (await import("@/lib/ai/client.browser")).aiClient;
}

describe("browser AI client", () => {
  beforeEach(() => {
    Object.assign(state, {
      gpu: true,
      cached: false,
      loaded: false,
      answers: [answer, answer],
    });
  });

  it("reports unsupported devices without loading the model", async () => {
    state.gpu = false;
    const client = await freshClient();
    expect((await client.status()).unsupported).toBe(true);
    const res = await client.analyze(profile);
    expect(!res.ok && res.error.code).toBe("unsupported");
  });

  it("asks before the one-time model download", async () => {
    const client = await freshClient();
    const res = await client.analyze(profile);
    expect(!res.ok && res.error.code).toBe("consent_required");
    expect(!res.ok && res.error.message).toContain("978 MB");
    expect(state.loaded).toBe(false);
  });

  it("runs the shared analysis after consent", async () => {
    const client = await freshClient();
    client.allowDownload!();
    const res = await client.analyze(profile);
    expect(res.ok).toBe(true);
    expect(res.ok && res.meta.provider).toBe("webllm");
    expect(res.ok && res.insights.findings[0]!.observation).toMatch(
      /^(Rose|Fell|Roughly flat)/,
    );
  });

  it("does not ask again when the model is already cached", async () => {
    state.cached = true;
    const client = await freshClient();
    expect((await client.analyze(profile)).ok).toBe(true);
  });
});
