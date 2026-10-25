// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  ConfigError,
  loadLocalAiConfig,
  parseOllamaBaseUrl,
} from "@/lib/ai/config.server";
import { isAllowedHost } from "@/lib/local-guard";

describe("local AI config", () => {
  it("defaults to Ollama on loopback with qwen2.5:1.5b", () => {
    expect(loadLocalAiConfig({})).toMatchObject({
      ollamaBaseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5:1.5b",
    });
  });

  it("lets the model be changed by environment variable", () => {
    expect(loadLocalAiConfig({ OLLAMA_MODEL: "llama3.2:3b" }).model).toBe(
      "llama3.2:3b",
    );
  });

  it("refuses a non-loopback Ollama URL unless explicitly allowed", () => {
    expect(() => parseOllamaBaseUrl("https://api.example.com")).toThrow(
      ConfigError,
    );
    expect(parseOllamaBaseUrl("http://192.168.1.20:11434", true)).toBe(
      "http://192.168.1.20:11434",
    );
  });

  it("strips paths so only Ollama's own routes can be reached", () => {
    expect(
      parseOllamaBaseUrl("http://localhost:11434/some/other/path?x=1"),
    ).toBe("http://localhost:11434");
  });

  it("rejects malformed values", () => {
    expect(() => parseOllamaBaseUrl("file:///etc/passwd")).toThrow(ConfigError);
    expect(() => parseOllamaBaseUrl("http://user:pw@127.0.0.1:11434")).toThrow(
      ConfigError,
    );
    expect(() =>
      loadLocalAiConfig({ OLLAMA_MODEL: "bad model; rm -rf" }),
    ).toThrow(ConfigError);
    expect(() => loadLocalAiConfig({ OLLAMA_TIMEOUT_MS: "abc" })).toThrow(
      ConfigError,
    );
  });
});

describe("host guard", () => {
  it("accepts this computer's names", () => {
    for (const h of [
      "localhost:8080",
      "127.0.0.1:8080",
      "[::1]:8080",
      "localhost",
    ]) {
      expect(isAllowedHost(h)).toBe(true);
    }
  });

  it("rejects other hosts (DNS rebinding) and a missing Host header", () => {
    expect(isAllowedHost("evil.example.com")).toBe(false);
    expect(isAllowedHost("127.0.0.1.evil.com:8080")).toBe(false);
    expect(isAllowedHost(null)).toBe(false);
  });

  it("accepts hosts listed in ALLOWED_HOSTS", () => {
    expect(
      isAllowedHost("strata.local:8080", { ALLOWED_HOSTS: "strata.local" }),
    ).toBe(true);
  });
});
