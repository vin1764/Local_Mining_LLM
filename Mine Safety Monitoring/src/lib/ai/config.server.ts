import { ConfigError } from "./config-error";

export { ConfigError };

/**
 * Central configuration for the local AI layer. Every value comes from
 * environment variables (see .env.example) with offline-safe defaults.
 */

export interface LocalAiConfig {
  /** Base URL of the local Ollama server, e.g. http://127.0.0.1:11434 */
  ollamaBaseUrl: string;
  /** Ollama model tag, e.g. qwen2.5:1.5b */
  model: string;
  /** Hard limit for one analysis request, in milliseconds. */
  timeoutMs: number;
  /** Context window passed to Ollama (num_ctx). */
  numCtx: number;
  /** Sampling temperature. Low values keep the report factual. */
  temperature: number;
}

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5:1.5b";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function readInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ConfigError(
      `Expected a number between ${min} and ${max}, got "${raw}".`,
    );
  }
  return n;
}

function readFloat(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ConfigError(
      `Expected a number between ${min} and ${max}, got "${raw}".`,
    );
  }
  return n;
}

/**
 * Validate the Ollama URL. By default only loopback addresses are accepted so
 * dataset summaries can never leave this computer by accident. Set
 * OLLAMA_ALLOW_NON_LOOPBACK=1 only for a trusted machine on your own network.
 */
export function parseOllamaBaseUrl(
  raw: string,
  allowNonLoopback = false,
): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`OLLAMA_BASE_URL is not a valid URL: "${raw}".`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(
      "OLLAMA_BASE_URL must start with http:// or https://.",
    );
  }
  if (url.username || url.password) {
    throw new ConfigError("OLLAMA_BASE_URL must not contain credentials.");
  }
  if (!allowNonLoopback && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ConfigError(
      `OLLAMA_BASE_URL points to "${url.hostname}", which is not this computer. ` +
        "Use http://127.0.0.1:11434, or set OLLAMA_ALLOW_NON_LOOPBACK=1 if you really mean it.",
    );
  }
  // Drop any path/query so callers can only reach Ollama's own API routes.
  return `${url.protocol}//${url.host}`;
}

export function parseModelName(raw: string): string {
  const model = raw.trim();
  // Ollama tags look like "qwen2.5:1.5b", "llama3.2:3b" or "namespace/model:tag".
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._\-/]*(:[a-zA-Z0-9._-]+)?$/.test(model) ||
    model.length > 120
  ) {
    throw new ConfigError(
      `OLLAMA_MODEL is not a valid Ollama model name: "${raw}".`,
    );
  }
  return model;
}

export function loadLocalAiConfig(
  env: Record<string, string | undefined> = process.env,
): LocalAiConfig {
  const allowNonLoopback = env["OLLAMA_ALLOW_NON_LOOPBACK"] === "1";
  return {
    ollamaBaseUrl: parseOllamaBaseUrl(
      env["OLLAMA_BASE_URL"] || DEFAULT_OLLAMA_BASE_URL,
      allowNonLoopback,
    ),
    model: parseModelName(env["OLLAMA_MODEL"] || DEFAULT_OLLAMA_MODEL),
    timeoutMs: readInt(env["OLLAMA_TIMEOUT_MS"], 180_000, 5_000, 1_800_000),
    numCtx: readInt(env["OLLAMA_NUM_CTX"], 8192, 2048, 131_072),
    temperature: readFloat(env["OLLAMA_TEMPERATURE"], 0.2, 0, 2),
  };
}
