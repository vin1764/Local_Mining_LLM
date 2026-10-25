// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { loadLocalAiConfig } from "@/lib/ai/config.server";
import { OllamaProvider, modelMatches } from "@/lib/ai/ollama.server";
import { LocalAiError } from "@/lib/ai/provider";

const config = loadLocalAiConfig({});
const request = { system: "s", prompt: "p", jsonSchema: { type: "object" } };

function provider(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
) {
  return new OllamaProvider(config, fetchImpl);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return "no-error";
  } catch (e) {
    return e instanceof LocalAiError ? e.code : `other:${String(e)}`;
  }
}

describe("OllamaProvider.generateStructured", () => {
  it("posts to the local /api/chat with the model, schema and no streaming", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ model: "qwen2.5:1.5b", message: { content: '{"headline":"x"}' } }),
    );
    const result = await provider(fetchImpl).generateStructured(request);

    expect(result.value).toEqual({ headline: "x" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "qwen2.5:1.5b",
      stream: false,
      format: { type: "object" },
    });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual([
      "system",
      "user",
    ]);
  });

  it("reports 'unreachable' when Ollama is not running", async () => {
    const p = provider(async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    });
    expect(await codeOf(p.generateStructured(request))).toBe("unreachable");
  });

  it("reports 'model_missing' with a pull hint on 404", async () => {
    const p = provider(async () =>
      json({ error: "model 'qwen2.5:1.5b' not found" }, 404),
    );
    const err = await p
      .generateStructured(request)
      .catch((e: LocalAiError) => e);
    expect(err).toBeInstanceOf(LocalAiError);
    expect((err as LocalAiError).code).toBe("model_missing");
    expect((err as LocalAiError).hint).toContain("ollama pull qwen2.5:1.5b");
  });

  it("reports 'bad_response' when the model returns non-JSON text", async () => {
    const p = provider(async () =>
      json({ message: { content: "Sure! Here is your report" } }),
    );
    expect(await codeOf(p.generateStructured(request))).toBe("bad_response");
  });

  it("reports 'runtime_error' on other HTTP errors", async () => {
    const p = provider(async () => json({ error: "out of memory" }, 500));
    expect(await codeOf(p.generateStructured(request))).toBe("runtime_error");
  });

  it("reports 'cancelled' when the caller aborts", async () => {
    const controller = new AbortController();
    const p = provider(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const pending = p.generateStructured({
      ...request,
      signal: controller.signal,
    });
    controller.abort();
    expect(await codeOf(pending)).toBe("cancelled");
  });

  it("reports 'timeout' when Ollama is too slow", async () => {
    const slow = new OllamaProvider(
      { ...config, timeoutMs: 20 },
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(
              Object.assign(new Error("timed out"), { name: "TimeoutError" }),
            ),
          );
        }),
    );
    expect(await codeOf(slow.generateStructured(request))).toBe("timeout");
  });
});

describe("OllamaProvider.status", () => {
  it("is ready when the configured model is installed", async () => {
    const p = provider(async (url) =>
      url.endsWith("/api/version")
        ? json({ version: "0.40.11" })
        : json({ models: [{ name: "qwen2.5:1.5b" }, { name: "llama3.2:3b" }] }),
    );
    const s = await p.status();
    expect(s).toMatchObject({
      reachable: true,
      modelInstalled: true,
      runtimeVersion: "0.40.11",
    });
  });

  it("explains how to pull a missing model", async () => {
    const p = provider(async (url) =>
      url.endsWith("/api/version")
        ? json({ version: "0.40.11" })
        : json({ models: [] }),
    );
    const s = await p.status();
    expect(s.reachable).toBe(true);
    expect(s.modelInstalled).toBe(false);
    expect(s.hint).toContain("ollama pull qwen2.5:1.5b");
  });

  it("is not reachable when the connection fails", async () => {
    const p = provider(async () => {
      throw new TypeError("fetch failed");
    });
    const s = await p.status();
    expect(s).toMatchObject({ reachable: false, modelInstalled: false });
    expect(s.hint).toMatch(/ollama serve/);
  });
});

describe("modelMatches", () => {
  it("treats an untagged name as :latest", () => {
    expect(modelMatches("qwen2.5:latest", "qwen2.5")).toBe(true);
    expect(modelMatches("qwen2.5:1.5b", "qwen2.5:1.5b")).toBe(true);
    expect(modelMatches("qwen2.5:7b", "qwen2.5:1.5b")).toBe(false);
  });
});
