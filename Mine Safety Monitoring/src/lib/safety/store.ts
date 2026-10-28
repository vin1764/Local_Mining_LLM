/**
 * The active safety configuration: the built-in src/config/safety-rules.json,
 * combined with a site thresholds file if one has been applied in this
 * browser (see the merge policy in ./config.ts). Only files that pass
 * validation are stored; an invalid file never replaces the active rules.
 */
import { useSyncExternalStore } from "react";

import {
  builtinConfig,
  previewSiteFile,
  type MergePreview,
  type RulesConfig,
} from "./config";

const KEY = "strata-site-thresholds-v2";

export interface ActiveConfig {
  config: RulesConfig;
  /** Human-readable origin, shown next to the status. */
  source: string;
  site: null | {
    fileName: string;
    policy: MergePreview["policy"];
    added: string[];
    replaced: string[];
    kept: string[];
    removed: string[];
  };
  /** Set when a stored site file no longer validates (it is then ignored). */
  siteError: string | null;
}

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

function compute(): ActiveConfig {
  const base = builtinConfig();
  const text = readStored();
  if (text) {
    const res = previewSiteFile(text, base);
    if (res.ok) {
      const { policy, added, replaced, kept, removed, result } = res.preview;
      return {
        config: result,
        source: `built-in CMR 2017 rules + site file "${res.fileName}" (${policy})`,
        site: {
          fileName: res.fileName,
          policy,
          added,
          replaced,
          kept,
          removed,
        },
        siteError: null,
      };
    }
    return {
      config: base,
      source: "built-in CMR 2017 rules",
      site: null,
      siteError: `The saved site thresholds file is no longer valid and was ignored: ${res.errors[0]}`,
    };
  }
  return {
    config: base,
    source: "built-in CMR 2017 rules",
    site: null,
    siteError: null,
  };
}

let cache: ActiveConfig | null = null;
const listeners = new Set<() => void>();

export function getActiveConfig(): ActiveConfig {
  cache ??= compute();
  return cache;
}

function changed() {
  cache = compute();
  for (const l of listeners) l();
}

/** Re-read the stored site file (e.g. after another tab changed it). */
export function reloadActiveConfig() {
  changed();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) changed();
  });
}

/** Validate and preview a site file without applying it. */
export function previewSiteFileText(text: string) {
  return previewSiteFile(text, builtinConfig());
}

/** Apply (and remember) a site file. Returns error messages, or null on success. */
export function applySiteFileText(text: string): string[] | null {
  const res = previewSiteFile(text, builtinConfig());
  if (!res.ok) return res.errors;
  try {
    globalThis.localStorage.setItem(KEY, text);
  } catch {
    return ["This browser does not allow saving the thresholds file."];
  }
  changed();
  return null;
}

export function clearSiteFile() {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  changed();
}

/** The active rules as a JSON file, usable as a template for a site file. */
export function activeConfigJson(): string {
  const { config } = getActiveConfig();
  return JSON.stringify(
    {
      schemaVersion: 1,
      name: config.name,
      mergePolicy: "replace",
      mineContext: config.mineContext,
      dataQuality: config.dataQuality,
      parameters: config.parameters,
      rules: config.rules,
    },
    null,
    2,
  );
}

const SERVER_SNAPSHOT: ActiveConfig = {
  config: builtinConfig(),
  source: "built-in CMR 2017 rules",
  site: null,
  siteError: null,
};

export function useActiveConfig(): ActiveConfig {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getActiveConfig,
    () => SERVER_SNAPSHOT,
  );
}
