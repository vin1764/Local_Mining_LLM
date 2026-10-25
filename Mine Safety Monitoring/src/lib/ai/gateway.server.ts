import { createOpenAI } from "@ai-sdk/openai";
import { streamText, Output, type FlexibleSchema } from "ai";

import { createLovableAiGatewayRunIdFetch } from "./run-id.server";

export const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
export const DEFAULT_MODEL = "openai/gpt-6-astra";

/**
 * One-shot structured AI call through Lovable AI Gateway.
 * Streams server-side (never buffered raw HTTP), returns the parsed object.
 */
export async function runStructuredCall<T>(options: {
  apiKey: string;
  instructions: string;
  prompt: string;
  schema: FlexibleSchema<T>;
  schemaName: string;
}): Promise<T> {
  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey: options.apiKey,
    headers: {
      "Lovable-API-Key": options.apiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    fetch: runIdFetch.fetch,
  });

  const result = streamText({
    model: provider.responses(DEFAULT_MODEL),
    instructions: options.instructions,
    messages: [{ role: "user", content: options.prompt }],
    output: Output.object({ schema: options.schema, name: options.schemaName }),
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
  });

  return await result.output;
}

/** Extract a safe, user-presentable message from a gateway/SDK error. */
export function safeAiErrorMessage(error: unknown): string {
  const raw =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  // Keep gateway messages intact (they carry remedy info), trim SDK noise.
  const cleaned = raw.replace(/^AI_\w+Error:\s*/i, "").trim();
  return cleaned.length > 0 && cleaned.length < 400 ? cleaned : "The analysis layer is unavailable right now.";
}
