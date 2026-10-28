// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDataset, buildDemoDataset } from "@/lib/dataset";
import { assessSafety } from "@/lib/safety/assess";
import {
  parseRulesFile,
  safetyRuleSchema,
  type SafetyRule,
} from "@/lib/safety/rules";

// Test-only thresholds. These numbers are fixtures, not real safety limits.
const rule = (over: Partial<SafetyRule> = {}): SafetyRule =>
  safetyRuleSchema.parse({
    id: "gas",
    label: "Test gas",
    columns: ["gas_pct"],
    unit: "%",
    direction: "above",
    warning: 1,
    critical: 2,
    source: "test fixture",
    required: true,
    ...over,
  });

const NOW = Date.parse("2026-10-01T09:00:00");
const csv = (rows: string[]) =>
  buildDataset(["time,gas_pct,flow_m3s", ...rows].join("\n"), "t.csv");
// Seven readings from 08:00 to 09:00, the last hour before NOW.
const hour = (gas: (i: number) => string | number) =>
  csv([
    ...Array.from(
      { length: 6 },
      (_, i) => `2026-10-01 08:${String(i * 10).padStart(2, "0")},${gas(i)},40`,
    ),
    `2026-10-01 09:00,${gas(6)},40`,
  ]);

describe("deterministic safety classification", () => {
  it("returns INSUFFICIENT_DATA when no thresholds are configured (never SAFE by default)", () => {
    const a = assessSafety(buildDemoDataset(), [], { now: NOW });
    expect(a.status).toBe("INSUFFICIENT_DATA");
    expect(a.reasons[0]).toMatch(/No verified safety thresholds/);
  });

  it("is SAFE only when every configured check passes on current, complete data", () => {
    const a = assessSafety(
      hour(() => 0.5),
      [rule()],
      { now: NOW },
    );
    expect(a.status).toBe("SAFE");
    expect(a.reasons.join(" ")).toMatch(/not a certification/);
    expect(a.evaluations[0]).toMatchObject({
      level: "ok",
      latestValue: 0.5,
      worstValue: 0.5,
    });
    expect(a.unassessedParameters).toEqual(["flow_m3s"]);
  });

  it("is UNSAFE when a reading in the current window breaches the critical limit", () => {
    const a = assessSafety(
      hour((i) => (i === 3 ? 2.4 : 0.5)),
      [rule()],
      { now: NOW },
    );
    expect(a.status).toBe("UNSAFE");
    expect(a.evaluations[0]).toMatchObject({
      level: "critical",
      worstValue: 2.4,
      worstAt: "2026-10-01 08:30",
    });
    expect(a.reasons[0]).toMatch(/breaches the critical limit .*test fixture/);
  });

  it("supports 'below' rules (lower is worse)", () => {
    const low = rule({
      id: "o2",
      direction: "below",
      warning: 19.5,
      critical: 19,
    });
    expect(
      assessSafety(
        hour(() => 18.9),
        [low],
        { now: NOW },
      ).status,
    ).toBe("UNSAFE");
    expect(
      assessSafety(
        hour(() => 19.4),
        [low],
        { now: NOW },
      ).status,
    ).toBe("CAUTION");
    expect(
      assessSafety(
        hour(() => 20.9),
        [low],
        { now: NOW },
      ).status,
    ).toBe("SAFE");
  });

  it("is CAUTION for a warning-level reading", () => {
    const a = assessSafety(
      hour((i) => (i === 6 ? 1.2 : 0.5)),
      [rule()],
      { now: NOW },
    );
    expect(a.status).toBe("CAUTION");
  });

  it("puts UNSAFE ahead of INSUFFICIENT_DATA (critical wins even on old data)", () => {
    const a = assessSafety(
      hour(() => 3),
      [rule()],
      { now: NOW + 24 * 3600_000 },
    );
    expect(a.status).toBe("UNSAFE");
    expect(
      a.reasons.some((r) => /does not describe current conditions/.test(r)),
    ).toBe(true);
  });

  it("does not return SAFE for data that is not current", () => {
    const a = assessSafety(
      hour(() => 0.5),
      [rule()],
      { now: NOW + 3 * 3600_000 },
    );
    expect(a.status).toBe("INSUFFICIENT_DATA");
  });

  it("does not return SAFE when a required parameter is missing", () => {
    const a = assessSafety(
      hour(() => 0.5),
      [rule(), rule({ id: "co", label: "CO", columns: ["co_ppm"] })],
      {
        now: NOW,
      },
    );
    expect(a.status).toBe("INSUFFICIENT_DATA");
    expect(a.reasons.join(" ")).toMatch(/Required parameter "CO"/);
  });

  it("does not return SAFE when readings are missing or invalid in the current window", () => {
    const missing = assessSafety(
      hour(() => ""),
      [rule()],
      { now: NOW },
    );
    expect(missing.status).toBe("INSUFFICIENT_DATA");
    const invalid = assessSafety(
      hour(() => 150),
      [rule({ validRange: [0, 100] })],
      { now: NOW },
    );
    expect(invalid.status).toBe("INSUFFICIENT_DATA");
    expect(invalid.evaluations[0]!.level).toBe("invalid");
  });

  it("does not return SAFE when a sensor is stale", () => {
    const ds = csv([
      "2026-10-01 07:00,0.5,40",
      "2026-10-01 08:50,,40",
      "2026-10-01 09:00,,40",
    ]);
    const a = assessSafety(ds, [rule({ maxStalenessMinutes: 15 })], {
      now: NOW,
    });
    expect(a.status).toBe("INSUFFICIENT_DATA");
  });

  it("flags conflicting readings at the same timestamp", () => {
    const ds = csv([
      "2026-10-01 08:50,0.5,40",
      "2026-10-01 09:00,0.4,40",
      "2026-10-01 09:00,0.9,40",
    ]);
    const a = assessSafety(ds, [rule()], { now: NOW });
    expect(a.status).toBe("INSUFFICIENT_DATA");
    expect(a.dataQualityNotes.join(" ")).toMatch(/same timestamp/);
  });

  it("uses the worst of several sensors for one rule and notes the disagreement", () => {
    const ds = buildDataset(
      [
        "time,gas_a,gas_b",
        "2026-10-01 08:30,0.4,2.5",
        "2026-10-01 09:00,0.5,0.6",
      ].join("\n"),
      "two.csv",
    );
    const a = assessSafety(ds, [rule({ columns: ["gas_a", "gas_b"] })], {
      now: NOW,
    });
    expect(a.status).toBe("UNSAFE");
    expect(a.dataQualityNotes.join(" ")).toMatch(/disagree/);
  });

  it("notes an earlier critical breach outside the current window as CAUTION", () => {
    const ds = csv([
      "2026-10-01 06:00,2.5,40",
      "2026-10-01 08:30,0.5,40",
      "2026-10-01 09:00,0.5,40",
    ]);
    expect(assessSafety(ds, [rule()], { now: NOW }).status).toBe("CAUTION");
  });

  it("cannot be SAFE without a time column", () => {
    const ds = buildDataset("gas_pct,flow\n0.5,40\n0.5,41", "nt.csv");
    expect(assessSafety(ds, [rule()], { now: NOW }).status).toBe(
      "INSUFFICIENT_DATA",
    );
    const bad = buildDataset("gas_pct,flow\n0.5,40\n2.5,41", "nt2.csv");
    expect(assessSafety(bad, [rule()], { now: NOW }).status).toBe("UNSAFE");
  });

  it("reports the 1-hour moving average next to the latest reading", () => {
    const a = assessSafety(
      hour((i) => i * 0.1),
      [rule()],
      { now: NOW },
    );
    expect(a.evaluations[0]!.latestValue).toBeCloseTo(0.6);
    // window (08:00, 09:00] → 08:10..09:00 = 0.1..0.6 → mean 0.35
    expect(a.evaluations[0]!.movingAvg1h).toBeCloseTo(0.35, 10);
  });
});

describe("thresholds file", () => {
  it("accepts a valid file and rejects bad ordering or missing sources", () => {
    const good = parseRulesFile(
      JSON.stringify({
        version: 1,
        rules: [
          {
            id: "x",
            label: "X",
            columns: ["x"],
            unit: "",
            direction: "above",
            warning: 1,
            critical: 2,
            source: "site std 4.2",
          },
        ],
      }),
    );
    expect(good.ok).toBe(true);
    const bad = parseRulesFile(
      JSON.stringify({
        version: 1,
        rules: [
          {
            id: "x",
            label: "X",
            columns: ["x"],
            unit: "",
            direction: "above",
            warning: 3,
            critical: 2,
            source: "s s s",
          },
        ],
      }),
    );
    expect(bad.ok).toBe(false);
    expect(parseRulesFile("{nope").ok).toBe(false);
    const noSource = parseRulesFile(
      JSON.stringify({
        version: 1,
        rules: [
          {
            id: "x",
            label: "X",
            columns: ["x"],
            unit: "",
            direction: "above",
            critical: 2,
          },
        ],
      }),
    );
    expect(noSource.ok).toBe(false);
  });
});
