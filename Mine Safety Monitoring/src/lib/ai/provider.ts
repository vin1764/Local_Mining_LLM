/**
 * Provider-neutral contract for local inference. React components never talk
 * to a model runtime directly; they call server functions that use this.
 * Ollama is the first implementation (see ollama.server.ts).
 */

export type LocalAiErrorCode =
  | "config" // bad environment configuration
  | "unreachable" // runtime not running / connection refused
  | "model_missing" // runtime is up but the model is not downloaded
  | "timeout" // took longer than the configured limit
  | "cancelled" // the user or browser cancelled the request
  | "bad_response" // the model answered but not in the required shape
  | "runtime_error" // the runtime reported an error
  | "invalid_input" // the request payload failed validation
  | "consent_required" // browser mode: the model must be downloaded first
  | "unsupported" // browser mode: no WebGPU on this device
  | "backend_unavailable"; // Pages edition: the local STRATA app is not reachable

export class LocalAiError extends Error {
  override name = "LocalAiError";
  constructor(
    public readonly code: LocalAiErrorCode,
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
  }
}

export interface ProviderStatus {
  provider: string;
  model: string;
  baseUrl: string;
  /** Runtime answered on its API. */
  reachable: boolean;
  /** Configured model is downloaded and available. */
  modelInstalled: boolean;
  runtimeVersion: string | null;
  installedModels: string[];
  message: string;
  hint?: string;
  /** Browser mode: this device cannot run the model (no WebGPU). */
  unsupported?: boolean;
  /** Browser mode: approximate one-time download size. */
  downloadSizeMB?: number;
  /** Pages edition: the local STRATA app (Ollama) was not reachable. */
  localBackendMissing?: boolean;
  /** Pages edition: this browser can run the in-browser model instead. */
  browserModelAvailable?: boolean;
}

/** A JSON schema object understood by the runtime's structured-output mode. */
export type JsonSchema = Record<string, unknown>;

export interface StructuredRequest {
  system: string;
  prompt: string;
  /** JSON schema the runtime should constrain its output to. */
  jsonSchema: JsonSchema;
  signal?: AbortSignal;
}

export interface StructuredResult {
  /** Parsed JSON value returned by the model (validate before use). */
  value: unknown;
  model: string;
  durationMs: number;
}

export interface LocalInferenceProvider {
  readonly name: string;
  readonly model: string;
  status(signal?: AbortSignal): Promise<ProviderStatus>;
  generateStructured(request: StructuredRequest): Promise<StructuredResult>;
}
