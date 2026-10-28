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

// No local STRATA app unless a test sets `local`.
let local: null | { status: unknown; analyze: unknown } = null;
const fetchMock = vi.fn(async (url: string) => {
  if (!local) throw new TypeError("Failed to fetch");
  const body = url.endsWith("/status") ? local.status : local.analyze;
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
vi.stubGlobal("fetch", fetchMock);

describe("GitHub Pages AI client", () => {
  beforeEach(() => {
    local = null;
    fetchMock.mockClear();
    Object.assign(state, {
      gpu: true,
      cached: false,
      loaded: false,
      answers: [answer, answer],
    });
  });

  it("uses the local STRATA app (Ollama) when it is running", async () => {
    local = {
      status: {
        provider: "ollama",
        model: "qwen2.5:1.5b",
        reachable: true,
        modelInstalled: true,
      },
      analyze: {
        ok: true,
        insights: { headline: "h" },
        meta: { provider: "ollama" },
      },
    };
    const client = await freshClient();
    expect((await client.status()).provider).toBe("ollama");
    const res = await client.analyze(profile);
    expect(res.ok && res.meta.provider).toBe("ollama");
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain("http://127.0.0.1:8080/api/local-ai/analyze");
    expect(state.loaded).toBe(false);
  });

  it("explains that local AI is not running, without downloading anything", async () => {
    const client = await freshClient();
    const s = await client.status();
    expect(s).toMatchObject({
      localBackendMissing: true,
      browserModelAvailable: true,
      reachable: false,
    });
    expect(s.hint).toMatch(/npm run start:with-pages/);
    const res = await client.analyze(profile);
    expect(!res.ok && res.error.code).toBe("backend_unavailable");
    expect(state.loaded).toBe(false);
  });

  it("reports when the in-browser model is not an option (no WebGPU)", async () => {
    state.gpu = false;
    const client = await freshClient();
    expect((await client.status()).browserModelAvailable).toBe(false);
    client.allowDownload!();
    const res = await client.analyze(profile);
    expect(!res.ok && res.error.code).toBe("unsupported");
  });

  it("runs the shared analysis in the browser only after the visitor chooses it", async () => {
    const client = await freshClient();
    client.allowDownload!();
    const res = await client.analyze(profile);
    expect(res.ok).toBe(true);
    expect(res.ok && res.meta.provider).toBe("webllm");
    expect(res.ok && res.insights.findings[0]!.observation).toMatch(
      /^(Rose|Fell|Roughly flat)/,
    );
    expect(res.ok && res.insights.safety!.status).toBe("CAUTION");
  });

  it("never falls back to a remote service", async () => {
    const client = await freshClient();
    await client.status();
    await client.analyze(profile);
    for (const [url] of fetchMock.mock.calls)
      expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:8080\//);
  });
});
