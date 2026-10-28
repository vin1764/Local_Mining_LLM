// @vitest-environment node
import { describe, expect, it } from "vitest";

import { runLocalAnalysis } from "@/lib/ai/analyst.server";
import {
  buildFactsSheet,
  findDirectionContradictions,
  findUngroundedNumbers,
  allowedNumbers,
  normaliseInsights,
  planFindings,
  severityFor,
} from "@/lib/ai/insights";
import {
  LocalAiError,
  type LocalInferenceProvider,
  type StructuredRequest,
} from "@/lib/ai/provider";
import { buildDataset, buildDemoDataset, buildProfile } from "@/lib/dataset";

const CSV = `timestamp,methane_pct,co_ppm,temperature_c,airflow_m3s,shift
2026-09-03 08:00,0.42,11,27.1,41.2,B
2026-09-01 08:00,0.31,8,26.2,44.0,A
2026-09-02 08:00,0.35,9,26.5,43.1,A
2026-09-04 08:00,0.47,12,27.4,40.6,B
2026-09-05 08:00,0.52,14,27.9,39.8,C
2026-09-06 08:00,0.49,13,27.6,40.1,C
2026-09-07 08:00,0.55,15,28.1,39.0,A
2026-09-08 08:00,0.58,16,28.3,38.4,A
2026-09-09 08:00,0.61,17,28.6,37.9,B
2026-09-10 08:00,0.66,19,29.0,37.0,B
2026-09-11 08:00,0.64,18,28.8,37.3,C
2026-09-12 08:00,1.35,41,29.4,30.2,C
2026-09-13 08:00,0.70,20,29.1,36.5,A
2026-09-14 08:00,0.72,21,29.3,36.1,A
2026-09-15 08:00,0.75,,29.5,35.8,B
2026-09-16 08:00,0.77,22,29.6,35.5,B`;

const profile = buildProfile(buildDataset(CSV, "sensors.csv"));
const planned = planFindings(profile);

function fakeProvider(
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
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return { value: next, model: "fake:1b", durationMs: 5 };
    },
  };
}

const goodAnswer = {
  headline: "Methane and CO rose while airflow fell",
  summary: "Methane_pct rose 89.7% over the period. Airflow_m3s fell 14.8%.",
  notes: [
    {
      parameter: "methane_pct",
      note: "May reflect a change in ventilation; check the gas monitors.",
    },
    {
      parameter: "AIRFLOW_M3S",
      note: "Could point to a fan or door issue worth inspecting.",
    },
    { parameter: "not_a_column", note: "Possibly irrelevant." },
  ],
  recommendations: [
    "Inspect the main fan.",
    "Recalibrate the methane sensors.",
  ],
};

describe("deterministic facts", () => {
  it("states directions, units and the period from the computed statistics", () => {
    const sheet = buildFactsSheet(profile);
    expect(sheet).toContain("PERIOD: 2026-09-01 08:00 to 2026-09-16 08:00");
    expect(sheet).toMatch(/temperature_c \(unit °C\): ROSE\. Rose 9\.6%/);
    expect(sheet).toMatch(/airflow_m3s \(unit m³\/s\): FELL\. Fell 14\.8%/);
    expect(sheet).toContain("co_ppm (unit ppm)");
    expect(sheet).toContain("SAFETY ASSESSMENT (rule-based, final):");
    expect(sheet).toContain("STATUS: CAUTION");
  });

  it("assigns severity with the documented rule", () => {
    const byName = Object.fromEntries(profile.columns.map((c) => [c.name, c]));
    expect(severityFor(byName["co_ppm"]!)).toBe("critical"); // +125% change
    expect(severityFor(byName["airflow_m3s"]!)).toBe("watch"); // -14.8%
    expect(severityFor(byName["temperature_c"]!)).toBe("normal"); // +9.6%, no outliers
  });

  it("writes finding observations from code, not the model", () => {
    const methane = planned.find((f) => f.parameter === "methane_pct")!;
    expect(methane.observation).toContain("Rose 89.7%");
    expect(methane.observation).toContain(
      "largest 1.35 % at 2026-09-12 08:00 (z = 3.16)",
    );
  });
});

describe("consistency checks", () => {
  it("catches a parameter described in the wrong direction", () => {
    expect(
      findDirectionContradictions(
        "Temperature showed a minor decrease.",
        profile,
      ),
    ).toEqual(["temperature_c"]);
    expect(
      findDirectionContradictions("Airflow increased slightly.", profile),
    ).toEqual(["airflow_m3s"]);
    expect(
      findDirectionContradictions(
        "Methane rose sharply while airflow fell.",
        profile,
      ),
    ).toEqual([]);
  });

  it("catches 'stable' for a parameter that moved", () => {
    expect(
      findDirectionContradictions("Airflow remained stable.", profile),
    ).toEqual(["airflow_m3s"]);
  });

  it("does not treat imperatives in recommendations as claims", () => {
    expect(
      findDirectionContradictions(
        "Reduce airflow restrictions.",
        profile,
        "descriptive",
      ),
    ).toEqual([]);
  });

  it("flags numbers that are not in the facts, allowing rounding", () => {
    const allowed = allowedNumbers(profile);
    expect(
      findUngroundedNumbers("Methane rose 89.7% (about 90%).", allowed),
    ).toEqual([]);
    expect(
      findUngroundedNumbers("Throughput increased by 6.4%.", allowed),
    ).toEqual([6.4]);
  });
});

describe("normaliseInsights", () => {
  it("keeps code-written findings and attaches only valid model notes", () => {
    const out = normaliseInsights(goodAnswer, profile, planned)!;
    expect(out.summaryContradicted).toBe(false);
    expect(out.insights.findings.map((f) => f.parameter)).toEqual(
      planned.map((f) => f.parameter),
    );
    const methane = out.insights.findings.find(
      (f) => f.parameter === "methane_pct",
    )!;
    expect(methane.observation).toBe(
      planned.find((f) => f.parameter === "methane_pct")!.observation,
    );
    expect(methane.interpretation).toMatch(/^May reflect/);
    expect(
      out.insights.findings.find((f) => f.parameter === "airflow_m3s")!
        .interpretation,
    ).toBeTruthy();
    expect(out.droppedItems).toBe(1); // the unknown parameter
  });

  it("drops notes that contradict the data or invent numbers", () => {
    const out = normaliseInsights(
      {
        ...goodAnswer,
        notes: [
          {
            parameter: "airflow_m3s",
            note: "Airflow increased, possibly due to a new fan.",
          },
          {
            parameter: "methane_pct",
            note: "May have risen 42% because of blasting.",
          },
        ],
      },
      profile,
      planned,
    )!;
    expect(out.insights.findings.every((f) => !f.interpretation)).toBe(true);
    expect(out.droppedItems).toBe(2);
  });

  it("marks a contradicting summary", () => {
    const out = normaliseInsights(
      { ...goodAnswer, summary: "Temperature decreased." },
      profile,
      planned,
    )!;
    expect(out.summaryContradicted).toBe(true);
  });

  it("returns null for unusable JSON", () => {
    expect(normaliseInsights({ text: "hello" }, profile, planned)).toBeNull();
  });
});

describe("runLocalAnalysis", () => {
  it("returns the existing insights shape plus metadata", async () => {
    const provider = fakeProvider([goodAnswer]);
    const res = await runLocalAnalysis(profile, { provider });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.insights.headline).toBe(goodAnswer.headline);
    expect(res.insights.findings.length).toBeGreaterThan(0);
    expect(res.meta).toMatchObject({
      provider: "fake",
      model: "fake:1b",
      summarySource: "model",
    });
    // The model sees computed facts, never raw CSV rows.
    expect(provider.calls[0]!.prompt).toContain("FACTS:");
    expect(provider.calls[0]!.prompt).not.toContain("2026-09-03 08:00,0.42");
  });

  it("retries a contradicting summary, then falls back to a code-written one", async () => {
    const bad = { ...goodAnswer, summary: "Airflow increased a lot." };
    const provider = fakeProvider([bad, bad]);
    const res = await runLocalAnalysis(profile, { provider });
    expect(provider.calls).toHaveLength(2);
    expect(res.ok && res.meta.summarySource).toBe("code");
    expect(res.ok && res.insights.summary).toContain("airflow_m3s fell 14.8%");
  });

  it("retries once on malformed output, then reports bad_response", async () => {
    const provider = fakeProvider([{ nope: 1 }, { nope: 2 }]);
    const res = await runLocalAnalysis(profile, { provider });
    expect(provider.calls).toHaveLength(2);
    expect(!res.ok && res.error.code).toBe("bad_response");
  });

  it("passes provider errors through as a structured error", async () => {
    const provider = fakeProvider([
      new LocalAiError("unreachable", "Ollama down", "Start Ollama"),
    ]);
    const res = await runLocalAnalysis(profile, { provider });
    expect(res).toEqual({
      ok: false,
      error: {
        code: "unreachable",
        message: "Ollama down",
        hint: "Start Ollama",
      },
    });
  });

  it("rejects an invalid or oversized payload before calling the model", async () => {
    const provider = fakeProvider([]);
    const res = await runLocalAnalysis(
      { name: "x", columns: "nope" },
      { provider },
    );
    expect(!res.ok && res.error.code).toBe("invalid_input");
    const huge = {
      ...profile,
      columns: Array.from({ length: 501 }, () => profile.columns[0]),
    };
    expect((await runLocalAnalysis(huge, { provider })).ok).toBe(false);
    expect(provider.calls).toHaveLength(0);
  });

  it("refuses a cloud Ollama URL from configuration", async () => {
    const { createProvider } = await import("@/lib/ai/analyst.server");
    expect(() =>
      createProvider({ OLLAMA_BASE_URL: "https://ollama.example.com" }),
    ).toThrow();
  });
});

describe("dataset", () => {
  it("sorts rows by time so trends follow the real timeline", () => {
    const d = buildDataset(CSV, "sensors.csv");
    expect(d.rows[0]!["timestamp"]).toBe("2026-09-01 08:00");
    expect(profile.timeRange).toEqual({
      start: "2026-09-01 08:00",
      end: "2026-09-16 08:00",
    });
    expect(
      d.columns.find((c) => c.name === "co_ppm")!.stats!.missingPct,
    ).toBeCloseTo(6.25);
  });

  it("keeps the source CSV so a run can be saved and rebuilt identically", () => {
    const d = buildDemoDataset();
    const again = buildDataset(d.sourceText, d.name);
    expect(buildProfile(again)).toEqual(buildProfile(d));
  });
});
