// @vitest-environment node
// All readings are SYNTHETIC; the site CO rule comes from a test fixture, not a real limit.
import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/ai/analyst";
import {
  buildFactsSheet,
  findBreachMisattribution,
  findSafetyClaimConflict,
  normaliseInsights,
  planFindings,
} from "@/lib/ai/insights";
import { MINING_SYSTEM_PROMPT, buildSystemPrompt } from "@/lib/ai/prompts";
import type {
  LocalInferenceProvider,
  StructuredRequest,
} from "@/lib/ai/provider";
import { buildProfile } from "@/lib/dataset";
import { assessSafety } from "@/lib/safety/assess";
import { builtinConfig, type RulesConfig } from "@/lib/safety/config";
import { NOW, sensorData, siteFile, withSite } from "./fixtures";

const verifiedCo = withSite(siteFile());
const ds = (lastCh4: number) =>
  sensorData({ edit: (i) => (i === 9 ? { CH4_vol_pct: lastCh4 } : {}) });

function profileFor(lastCh4: number, config: RulesConfig = verifiedCo) {
  const d = ds(lastCh4);
  return buildProfile(d, assessSafety(d, config, { now: NOW }));
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
  headline: "Methane reading reached the critical limit",
  summary: "CH4_vol_pct reached the critical limit in the last hour.",
  notes: [],
  recommendations: ["Verify the methane sensor reading."],
  safety_status: "UNSAFE",
  safety_explanation:
    "CH4_vol_pct at 2026-10-28T08:59:00Z breaches Reg. 153(2)(c).",
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
    expect(MINING_SYSTEM_PROMPT).toMatch(
      /The only statuses are SAFE, CAUTION and UNSAFE/,
    );
    expect(MINING_SYSTEM_PROMPT).not.toMatch(/INSUFFICIENT/);
  });

  it("includes sensor names, units, thresholds, verification status and clauses", () => {
    const sys = buildSystemPrompt(profileFor(1.5));
    expect(sys).toContain("- CH4_vol_pct (%vol)");
    expect(sys).toContain("- CO_ppm (ppm)");
    expect(sys).toMatch(
      /CH4_vol_pct: warning > 0\.8 %vol, critical > 1\.25 %vol \[VERIFIED REGULATORY; Reg\. 153\(2\)\(c\)/,
    );
    expect(sys).toMatch(/O2_vol_pct: critical < 19 %vol \[VERIFIED REGULATORY/);
    expect(sys).toMatch(/CO_ppm: .*\[VERIFIED SITE; TEST clause 1\]/);
  });

  it("says when no threshold could be checked", () => {
    const d = { ...sensorData({ n: 1 }), rows: [], rowCount: 0 };
    expect(
      buildSystemPrompt(
        buildProfile(d, assessSafety(d, verifiedCo, { now: NOW })),
      ),
    ).toMatch(/none\. No configured threshold could be checked/);
  });

  it("puts status, timestamp, triggered rules, sources and 1-hour averages in the facts", () => {
    const facts = buildFactsSheet(profileFor(1.5));
    expect(facts).toContain("STATUS: UNSAFE");
    expect(facts).toMatch(/Newest reading: .*2026-10-28/);
    expect(facts).toMatch(
      /cmr153-ch4-any-place \(VERIFIED REGULATORY\): CH4_vol_pct CRITICAL; worst 1\.5 %vol/,
    );
    expect(facts).toMatch(/source Reg\. 153\(2\)\(c\)/);
    expect(facts).toMatch(
      /O2_vol_pct: latest 20\.8 %vol .*1-hour average 20\.8 %vol/,
    );
  });

  it("lists required checks that are not verified when no site CO limit exists", () => {
    const facts = buildFactsSheet(profileFor(0.2, builtinConfig()));
    expect(facts).toContain("STATUS: CAUTION");
    expect(facts).toMatch(
      /Required checks not configured or not verified: .*co-site-limit/,
    );
  });

  it("includes data-quality warnings", () => {
    const d = sensorData({ endMinutesBeforeNow: 120 });
    const facts = buildFactsSheet(
      buildProfile(d, assessSafety(d, verifiedCo, { now: NOW })),
    );
    expect(facts).toMatch(/STALE/);
    expect(facts).toMatch(/Data-quality warnings:\n {2}- .*old/);
  });

  it("is sent to the model on every analysis", async () => {
    const p = fake([answer()]);
    await runAnalysis(profileFor(1.5), { provider: p });
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
    const res = await runAnalysis(profileFor(1.5), {
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
    const res = await runAnalysis(profileFor(1.5), {
      provider: fake([lie, lie]),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.insights.safety!.status).toBe("UNSAFE");
    expect(res.insights.safety!.needsReview).toBe(true);
    expect(res.insights.safety!.reviewReason).toMatch(/model reported SAFE/);
  });

  it("retries once and keeps the consistent answer", async () => {
    const p = fake([answer({ safety_status: "SAFE" }), answer()]);
    const res = await runAnalysis(profileFor(1.5), { provider: p });
    expect(p.calls).toHaveLength(2);
    expect(res.ok && res.insights.safety!.needsReview).toBe(false);
  });

  it("flags 'safe' wording when the status is CAUTION", () => {
    const profile = profileFor(0.2, builtinConfig());
    const out = normaliseInsights(
      answer({
        safety_status: "CAUTION",
        summary: "Conditions in the mine are safe this shift.",
        safety_explanation: "No verified CO threshold is configured.",
      }),
      profile,
      planFindings(profile),
    )!;
    expect(out.insights.safety).toMatchObject({
      status: "CAUTION",
      needsReview: true,
    });
  });

  it("drops recommendations that claim a breach the rules did not find", () => {
    const profile = profileFor(0.2);
    expect(profile.safety!.status).toBe("SAFE");
    const out = normaliseInsights(
      answer({
        safety_status: "SAFE",
        summary: "All configured checks passed.",
        safety_explanation:
          "All configured checks passed; this is not a certification.",
        recommendations: [
          "Evacuate: methane exceeds the limit.",
          "Recalibrate the methane sensor.",
        ],
      }),
      profile,
      planFindings(profile),
    )!;
    expect(out.insights.recommendations).toEqual([
      "Recalibrate the methane sensor.",
    ]);
  });

  it("recognises claims and negations", () => {
    expect(
      findSafetyClaimConflict("The mine is safe to enter.", "SAFE"),
    ).toMatch(/certified or safe to enter/);
    expect(
      findSafetyClaimConflict(
        "Conditions cannot be confirmed as safe.",
        "CAUTION",
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
    const res = await runAnalysis(profileFor(1.5), {
      provider: fake([
        {
          headline: "Methane check",
          summary: "CH4_vol_pct rose.",
          notes: [],
          recommendations: [],
        },
      ]),
    });
    expect(res.ok && res.insights.safety).toMatchObject({ status: "UNSAFE" });
  });

  it("returns a structured error, not a crash, for unusable JSON", async () => {
    const res = await runAnalysis(profileFor(1.5), {
      provider: fake(["not json", 42]),
    });
    expect(!res.ok && res.error.code).toBe("bad_response");
  });

  it("treats odd safety_status values as a review flag", async () => {
    const res = await runAnalysis(profileFor(1.5), {
      provider: fake([
        answer({ safety_status: { nope: 1 } }),
        answer({ safety_status: 7 }),
      ]),
    });
    expect(res.ok && res.insights.safety!.status).toBe("UNSAFE");
  });

  it("defaults to CAUTION when no assessment was supplied", async () => {
    const res = await runAnalysis(buildProfile(ds(0.2)), {
      provider: fake([
        answer({
          safety_status: "SAFE",
          safety_explanation: "No assessment was supplied.",
        }),
      ]),
    });
    expect(res.ok && res.insights.safety!.status).toBe("CAUTION");
  });

  it("does not accept the removed INSUFFICIENT_DATA status from the model", async () => {
    const odd = answer({
      safety_status: "INSUFFICIENT_DATA",
      safety_explanation: "Unknown.",
    });
    const res = await runAnalysis(profileFor(0.2, builtinConfig()), {
      provider: fake([odd, odd]),
    });
    expect(res.ok && res.insights.safety!.status).toBe("CAUTION");
    expect(res.ok && res.insights.safety!.needsReview).toBe(true);
  });
});

describe("misattributed breaches", () => {
  // Only methane breaches here; O2, CO2 and the site CO rule were checked and passed.
  const profile = profileFor(1.5);
  it("flags a parameter said to breach a limit that the rules found within limits", () => {
    expect(
      findBreachMisattribution(
        "The CO2 level exceeded critical limits and exceeded the electric supply cutoff threshold.",
        profile,
      ),
    ).toMatch(/CO2_vol_pct breached a limit/);
    expect(
      findBreachMisattribution(
        "Methane and carbon dioxide exceeded critical limits.",
        profile,
      ),
    ).toMatch(/CO2_vol_pct/);
    expect(
      findBreachMisattribution(
        "O2 vol pct is above the critical level.",
        profile,
      ),
    ).toMatch(/O2_vol_pct/);
  });

  it("accepts correct, negated, hedged and unrelated wording", () => {
    expect(
      findBreachMisattribution(
        "CH4_vol_pct exceeded the critical limit of 1.25 %vol.",
        profile,
      ),
    ).toBeNull();
    expect(
      findBreachMisattribution(
        "Methane breached Reg. 153(2)(c) while CO2 rose slightly.",
        profile,
      ),
    ).toBeNull();
    expect(
      findBreachMisattribution("CO2 did not exceed its limit.", profile),
    ).toBeNull();
    expect(
      findBreachMisattribution(
        "CO2 could exceed the limit if the trend continues.",
        profile,
      ),
    ).toBeNull();
    // "co" must not match inside "co2" or "cooling"; CO_ppm passed but is not named here.
    expect(
      findBreachMisattribution(
        "Cooling fans exceeded the expected duty limit.",
        profile,
      ),
    ).toBeNull();
  });

  it("marks such AI text for review and keeps the rule-based status", async () => {
    const wrong = answer({
      safety_explanation: "Methane and CO2 exceeded critical limits.",
    });
    const res = await runAnalysis(profile, { provider: fake([wrong, wrong]) });
    expect(res.ok && res.insights.safety).toMatchObject({
      status: "UNSAFE",
      needsReview: true,
    });
    expect(res.ok && res.insights.safety!.reviewReason).toMatch(/CO2_vol_pct/);
  });
});
