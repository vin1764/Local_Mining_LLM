// Small, dependency-free helpers for the browser build, so the large WebLLM
// library is only downloaded when the AI is actually needed.
import type { LoadProgress } from "./types";

const listeners = new Set<(p: LoadProgress | null) => void>();

export function emitProgress(p: LoadProgress | null) {
  for (const cb of listeners) cb(p);
}

export function subscribeProgress(
  cb: (p: LoadProgress | null) => void,
): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

type Adapter = { features: { has(name: string): boolean } };
type Gpu = { requestAdapter(): Promise<Adapter | null> };

async function adapter(): Promise<Adapter | null> {
  const gpu = (globalThis.navigator as (Navigator & { gpu?: Gpu }) | undefined)
    ?.gpu;
  if (!gpu) return null;
  try {
    return await gpu.requestAdapter();
  } catch {
    return null;
  }
}

export async function webGpuAvailable(): Promise<boolean> {
  return (await adapter()) != null;
}

/** 16-bit float shaders; the smaller q4f16 model builds need them. */
export async function gpuSupportsF16(): Promise<boolean> {
  return (await adapter())?.features.has("shader-f16") ?? false;
}
