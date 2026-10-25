/** Change at build time with VITE_WEBLLM_MODEL (any id from WebLLM's prebuilt model list). */
export const WEBLLM_MODEL: string =
  (import.meta.env["VITE_WEBLLM_MODEL"] as string | undefined) ||
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
