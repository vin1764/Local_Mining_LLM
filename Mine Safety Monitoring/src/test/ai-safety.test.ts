// @vitest-environment node
import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/ai/analyst";
import {
  buildFactsSheet,
  findSafetyClaimConflict,
  normaliseInsights,
  planFindings,
} from "@/lib/ai/insights";
import { MINING_SYSTEM_PROMPT, buildSystemPrompt } from "@/lib/ai/prompts";
import type {
  LocalInferenceProvider,
  StructuredRequest,
} from "@/lib/ai/provider";
import { buildDataset, buildProfile } from "@/lib/dataset";
import { assessSafety } from "@/lib/safety/assess";
import { safetyRuleSchema } from "@/lib/safety/rules";

// Test-only threshold fixture (not a real safety limit).
const gasRule = safetyRuleSchema.parse({
  id: "gas",
  label: "Test gas",
  columns: ["gas_pct"],
  unit: "%",
  direction: "above",
  warning: 1,
  critical: 2,
  source: "test fixture clause 1",
  required: true,
});
const NOW = Date.parse("2026-10-01T09:00:00");
const ds = (lastGas: number) =>
  buildDataset(
    [
      "time,gas_pct,flow_m3s",
      ...Array.from(
        { length: 6 },
        (_, i) => `2026-10-01 08:${i}0,0.5,${40 + i}`,
      ),
      `2026-10-01 09:00,${lastGas},46`,
    ].join("\n"),
    "gas.csv",
  );

function profileFor(lastGas: number, rules = [gasRule]) {
  const d = ds(lastGas);
  return buildProfile(d, assessSafety(d, rules, { now: NOW }));
}

function fake(
  answers: unknown[],
): LocalInferenceProvider & { calls: StructuredRequest[] } {
  const calls: StructuredRequest[] = [];
  return {
    name: "fake",
    model: "fake:1b",
    calls,
    status: async () => {
      throw new Error("unused");
    },
    generateStructured: async (req) => {
      calls.push(req);
      return { value: answers.shift(), model: "fake:1b", durationMs: 1 };
    },
  };
}

const answer = (over: Record<string, unknown> = {}) => ({
  headline: "Gas reading reached the critical limit",
  summary:
    "gas_pct reached the critical limit in the last hour while flow_m3s rose.",
  notes: [],
  recommendations: ["Verify the gas sensor reading."],
  safety_status: "UNSAFE",
  safety_explanation:
    "gas_pct at 2026-10-01 09:00 breaches the configured critical limit.",
  ...over,
});

describe("mining system prompt", () => {
  it("is mining-specific and states the rule-based status is final", () => {
    expect(MINING_SYSTEM_PROMPT).toMatch(
      /Mining Safety and Environmental Analytics Assistant/,
    );
    expect(MINING_SYSTEM_PROMPT).toMatch(/STATUS is final/);
    expect(MINING_SYSTEM_PROMPT).toMatch(
      /Never claim the mine is certified safe/,
    );
  });

  it("includes this file's sensor names, units and configured thresholds", () => {
    const sys = buildSystemPrompt(profileFor(2.5));
    expect(sys).toContain("- gas_pct (%)");
    expect(sys).toContain("- flow_m3s (m³/s)");
    expect(sys).toMatch(
      /gas_pct: warning ≥ 1 %, critical ≥ 2 % \(source: test fixture clause 1\)/,
    );
  });

  it("says when no thresholds are configured", () => {
    expect(buildSystemPrompt(profileFor(0.5, []))).toMatch(
      /none\. No verified thresholds apply/,
    );
  });

  it("puts the safety assessment and 1-hour averages in the facts", () => {
    const facts = buildFactsSheet(profileFor(2.5));
    expect(facts).toContain("STATUS: UNSAFE");
    expect(facts).toMatch(/1-hour moving average 0\.833 % over 6 reading\(s\)/);
    expect(facts).toMatch(/gas_pct: CRITICAL; latest 2\.5 %/);
  });

  it("is sent to the model on every analysis", async () => {
    const p = fake([answer()]);
    await runAnalysis(profileFor(2.5), { provider: p });
    expect(p.calls[0]!.system).toContain(
      "Mining Safety and Environmental Analytics Assistant",
    );
    expect(p.calls[0]!.prompt).toContain(
      "SAFETY ASSESSMENT (rule-based, final)",
    );
  });
});

describe("the model cannot override the safety status", () => {
  it("attaches the rule-based status to every successful analysis", async () => {
    const res = await runAnalysis(profileFor(2.5), {
      provider: fake([answer()]),
    });
    expect(res.ok && res.insights.safety).toMatchObject({
      status: "UNSAFE",
      needsReview: false,
    });
  });

  it("keeps UNSAFE when the model says SAFE, and flags the wording", async () => {
    const lie = answer({
      safety_status: "SAFE",
      safety_explanation: "Conditions are safe.",
    });
    const res = await runAnalysis(profileFor(2.5), {
      provider: fake([lie, lie]),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.insights.safety!.status).toBe("UNSAFE");
    expect(res.insights.safety!.needsReview).toBe(true);
    expect(res.insights.safety!.reviewReason).toMatch(/model reported SAFE/);
  });

  it("retries once and keeps the consistent answer", async () => {
    const lie = answer({ safety_status: "SAFE" });
    const p = fake([lie, answer()]);
    const res = await runAnalysis(profileFor(2.5), { provider: p });
    expect(p.calls).toHaveLength(2);
    expect(res.ok && res.insights.safety!.needsReview).toBe(false);
  });

  it("flags 'safe' wording when data is insufficient", () => {
    const profile = profileFor(0.5, []);
    const out = normaliseInsights(
      answer({
        safety_status: "INSUFFICIENT_DATA",
        summary: "Conditions in the mine are safe this shift.",
        safety_explanation: "No thresholds are configured.",
      }),
      profile,
      planFindings(profile),
    )!;
    expect(out.insights.safety).toMatchObject({
      status: "INSUFFICIENT_DATA",
      needsReview: true,
    });
  });

  it("drops recommendations that claim a breach the rules did not find", () => {
    const profile = profileFor(0.5);
    const out = normaliseInsights(
      answer({
        safety_status: "SAFE",
        summary: "All configured checks passed.",
        safety_explanation:
          "All configured checks passed; this is not a certification.",
        recommendations: [
          "Evacuate: gas exceeds the limit.",
          "Recalibrate the gas sensor.",
        ],
      }),
      profile,
      planFindings(profile),
    )!;
    expect(out.insights.recommendations).toEqual([
      "Recalibrate the gas sensor.",
    ]);
  });

  it("recognises claims and negations", () => {
    expect(
      findSafetyClaimConflict("The mine is safe to enter.", "SAFE"),
    ).toMatch(/certified or safe to enter/);
    expect(
      findSafetyClaimConflict(
        "Conditions cannot be confirmed as safe.",
        "INSUFFICIENT_DATA",
      ),
    ).toBeNull();
    expect(
      findSafetyClaimConflict("Readings may indicate a hazard.", "CAUTION"),
    ).toBeNull();
    expect(
      findSafetyClaimConflict("Gas breached the critical limit.", "CAUTION"),
    ).toMatch(/hazard or limit breach/);
    expect(
      findSafetyClaimConflict("The safety status is UNSAFE.", "UNSAFE"),
    ).toBeNull();
    // Even when every check passed, "the mine is safe" is an overclaim.
    expect(
      findSafetyClaimConflict(
        "Checks passed, indicating the mine is safe.",
        "SAFE",
      ),
    ).toMatch(/cannot establish/);
    expect(
      findSafetyClaimConflict(
        "All configured checks passed; status SAFE.",
        "SAFE",
      ),
    ).toBeNull();
    expect(
      findSafetyClaimConflict(
        "The mine cannot be declared safe from sensor data.",
        "SAFE",
      ),
    ).toBeNull();
  });
});

describe("malformed model output", () => {
  it("does not crash on missing safety fields and keeps the rule-based status", async () => {
    const res = await runAnalysis(profileFor(2.5), {
      provider: fake([
        {
          headline: "Gas check",
          summary: "gas_pct rose.",
          notes: [],
          recommendations: [],
        },
      ]),
    });
    expect(res.ok && res.insights.safety).toMatchObject({ status: "UNSAFE" });
  });

  it("returns a structured error, not a crash, for unusable JSON", async () => {
    const res = await runAnalysis(profileFor(2.5), {
      provider: fake(["not json", 42]),
    });
    expect(!res.ok && res.error.code).toBe("bad_response");
  });

  it("treats odd safety_status values as a review flag", async () => {
    const res = await runAnalysis(profileFor(2.5), {
      provider: fake([
        answer({ safety_status: { nope: 1 } }),
        answer({ safety_status: 7 }),
      ]),
    });
    expect(res.ok && res.insights.safety!.status).toBe("UNSAFE");
  });

  it("defaults to INSUFFICIENT_DATA when no assessment was supplied", async () => {
    const d = ds(0.5);
    const res = await runAnalysis(buildProfile(d), {
      provider: fake([
        answer({
          safety_status: "INSUFFICIENT_DATA",
          safety_explanation: "No assessment was supplied.",
        }),
      ]),
    });
    expect(res.ok && res.insights.safety!.status).toBe("INSUFFICIENT_DATA");
  });
});
