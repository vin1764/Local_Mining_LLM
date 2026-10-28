/**
 * Which safety rules are active: a thresholds file the user loaded in the app
 * (kept in this browser), otherwise the rules in src/config/safety-rules.ts.
 */
import { useSyncExternalStore } from "react";

import { SAFETY_RULES } from "@/config/safety-rules";
import {
  parseRulesFile,
  safetyRuleSchema,
  type SafetyRule,
  type SafetyRulesFile,
} from "./rules";

const KEY = "strata-safety-rules-v1";

export interface ActiveRules {
  rules: SafetyRule[];
  /** Human-readable origin of the thresholds, shown next to the status. */
  source: string;
  fromFile: boolean;
}

function configRules(): SafetyRule[] {
  const out: SafetyRule[] = [];
  for (const r of SAFETY_RULES) {
    const parsed = safetyRuleSchema.safeParse(r);
    if (parsed.success) out.push(parsed.data);
    else
      console.warn(
        `[safety] Ignoring invalid rule in src/config/safety-rules.ts: ${parsed.error.issues[0]?.message}`,
      );
  }
  return out;
}

function readStoredFile(): SafetyRulesFile | null {
  try {
    const text = globalThis.localStorage?.getItem(KEY);
    if (!text) return null;
    const parsed = parseRulesFile(text);
    return parsed.ok ? parsed.file : null;
  } catch {
    return null;
  }
}

let cache: ActiveRules | null = null;
const listeners = new Set<() => void>();

function compute(): ActiveRules {
  const file = readStoredFile();
  if (file) {
    return {
      rules: file.rules,
      source: `thresholds file "${file.name ?? "unnamed"}"`,
      fromFile: true,
    };
  }
  const rules = configRules();
  return {
    rules,
    source: rules.length ? "src/config/safety-rules.ts" : "none configured",
    fromFile: false,
  };
}

export function getActiveRules(): ActiveRules {
  cache ??= compute();
  return cache;
}

function changed() {
  cache = compute();
  for (const l of listeners) l();
}

/** Store a thresholds file in this browser. Returns an error message on failure. */
export function saveRulesFileText(text: string): string | null {
  const parsed = parseRulesFile(text);
  if (!parsed.ok) return parsed.error;
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(parsed.file));
  } catch {
    return "This browser does not allow saving the thresholds file.";
  }
  changed();
  return null;
}

export function clearRulesFile() {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  changed();
}

const SERVER_SNAPSHOT: ActiveRules = {
  rules: [],
  source: "none configured",
  fromFile: false,
};

export function useActiveRules(): ActiveRules {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getActiveRules,
    () => SERVER_SNAPSHOT,
  );
}
