// @vitest-environment node
// All measurements and site thresholds below are SYNTHETIC test fixtures.
import { describe, expect, it } from "vitest";

import { buildDataset } from "@/lib/dataset";
import {
  SAFETY_STATUSES,
  assessSafety,
  type SafetyStatus,
} from "@/lib/safety/assess";
import { builtinConfig } from "@/lib/safety/config";
import { formatThreshold } from "@/lib/safety/format";
import {
  NOW,
  TEST_VERIFICATION,
  sensorData,
  siteFile,
  withSite,
} from "./fixtures";

const base = builtinConfig();
const verifiedCo = withSite(siteFile());
const assess = (ds = sensorData(), cfg = verifiedCo, now = NOW) =>
  assessSafety(ds, cfg, { now });
type Edit = NonNullable<NonNullable<Parameters<typeof sensorData>[0]>["edit"]>;
const latest = (edit: Edit) =>
  sensorData({ edit: (i) => (i === 9 ? edit(i) : {}) });
const ev = (a: ReturnType<typeof assess>, id: string) =>
  a.evaluations.find((e) => e.ruleId === id)!;
/** A dataset with headers but no rows (buildDataset itself rejects such files). */
const emptyData = () => ({ ...sensorData({ n: 1 }), rows: [], rowCount: 0 });
/** Gas readings with a reliable oxygen deficiency (ΔO2 ≈ 1.67 %), so Graham's ratio is meaningful. */
const HEATING = { O2_vol_pct: 19.5, CO2_vol_pct: 0.4, CO_ppm: 40 };

describe("built-in configuration (no site file imported)", () => {
  it("loads real rules, not zero", () => {
    expect(base.rules.length).toBeGreaterThanOrEqual(20);
    const enabledVerified = base.rules.filter(
      (r) => r.enabled && r.verificationStatus === "verified_regulatory",
    );
    expect(enabledVerified.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        "cmr153-ch4-any-place",
        "cmr153-o2-min",
        "cmr153-co2-max",
        "cmr138-flame-detected",
        "cmr138-smoke-detected",
      ]),
    );
    const a = assessSafety(sensorData(), base, { now: NOW });
    expect(a.rulesSummary.enabled).toBeGreaterThan(0);
    expect(a.rulesSummary.evaluated).toBe(5);
  });

  it("carries the verified CMR 2017 numbers and sources", () => {
    const r = (id: string) => base.rules.find((x) => x.id === id)!;
    expect(r("cmr153-ch4-any-place")).toMatchObject({
      operator: "greater_than",
      warningThreshold: 0.8,
      criticalThreshold: 1.25,
    });
    expect(r("cmr153-o2-min")).toMatchObject({
      operator: "less_than",
      criticalThreshold: 19,
    });
    expect(r("cmr153-co2-max")).toMatchObject({
      operator: "greater_than",
      criticalThreshold: 0.5,
    });
    expect(r("cmr153-ch4-any-place").source.clause).toMatch(
      /Reg\. 153\(2\)\(c\)/,
    );
    expect(r("cmr153-o2-min").source.verification?.officialCopyChecked).toBe(
      false,
    );
  });

  it("is never SAFE without a verified CO threshold (CMR 2017 has none)", () => {
    const a = assessSafety(sensorData(), base, { now: NOW });
    expect(a.status).toBe("CAUTION");
    expect(a.unverifiedRequired).toContain("co-site-limit");
    expect(a.reasons.join(" ")).toMatch(/co-site-limit/);
  });
});

describe("three statuses only", () => {
  it("SAFE when every required verified check passes on current data", () => {
    const a = assess();
    expect(a.status).toBe("SAFE");
    expect(a.reasons.join(" ")).toMatch(/not a certification/);
  });

  it("never returns anything but SAFE, CAUTION or UNSAFE", () => {
    const scenarios = [
      assess(),
      assess(latest(() => ({ CH4_vol_pct: 2 }))),
      assess(sensorData(), base),
      assess(emptyData()),
      assess(buildDataset("a,b\n1,2", "x.csv")),
      assess(sensorData({ endMinutesBeforeNow: 600 })),
    ];
    for (const s of scenarios)
      expect(SAFETY_STATUSES).toContain(s.status as SafetyStatus);
    expect(SAFETY_STATUSES).toEqual(["SAFE", "CAUTION", "UNSAFE"]);
  });
});

describe("methane — Reg. 153(2)(c) and 169(1)(c)(i)", () => {
  it("UNSAFE above 1.25 %vol, not at exactly 1.25", () => {
    expect(assess(latest(() => ({ CH4_vol_pct: 1.26 }))).status).toBe("UNSAFE");
    const at = assess(latest(() => ({ CH4_vol_pct: 1.25 })));
    expect(ev(at, "cmr153-ch4-any-place").result).toBe("warning");
    expect(at.status).toBe("CAUTION");
  });

  it("CAUTION above the 0.8 % warning, OK at exactly 0.8", () => {
    expect(
      ev(assess(latest(() => ({ CH4_vol_pct: 0.81 }))), "cmr153-ch4-any-place")
        .result,
    ).toBe("warning");
    expect(
      ev(assess(latest(() => ({ CH4_vol_pct: 0.8 }))), "cmr153-ch4-any-place")
        .result,
    ).toBe("ok");
  });

  it("cites the regulation that was triggered", () => {
    const a = assess(latest(() => ({ CH4_vol_pct: 1.5 })));
    expect(a.triggeredRuleIds).toContain("cmr153-ch4-any-place");
    expect(a.reasons[0]).toMatch(/Reg\. 153\(2\)\(c\)/);
  });
});

describe("oxygen and carbon dioxide — Reg. 153(2)(b)", () => {
  it("O2 below 19 % is UNSAFE; exactly 19 % passes", () => {
    expect(assess(latest(() => ({ O2_vol_pct: 18.99 }))).status).toBe("UNSAFE");
    expect(
      ev(assess(latest(() => ({ O2_vol_pct: 19 }))), "cmr153-o2-min").result,
    ).toBe("ok");
  });

  it("CO2 above 0.5 % is UNSAFE; exactly 0.5 % passes", () => {
    expect(assess(latest(() => ({ CO2_vol_pct: 0.51 }))).status).toBe("UNSAFE");
    expect(
      ev(assess(latest(() => ({ CO2_vol_pct: 0.5 }))), "cmr153-co2-max").result,
    ).toBe("ok");
  });
});

describe("carbon monoxide (site rule from a site file)", () => {
  it("applies warning and critical boundaries from the site file", () => {
    expect(
      ev(assess(latest(() => ({ CO_ppm: 26 }))), "co-site-limit").result,
    ).toBe("warning");
    expect(
      ev(assess(latest(() => ({ CO_ppm: 25 }))), "co-site-limit").result,
    ).toBe("ok");
    expect(assess(latest(() => ({ CO_ppm: 51 }))).status).toBe("UNSAFE");
  });
});

describe("vision detections — Reg. 138(1)", () => {
  it("a positive flame or smoke detection is UNSAFE", () => {
    expect(assess(latest(() => ({ YOLO_Flame_Detected: 1 }))).status).toBe(
      "UNSAFE",
    );
    const smoke = assess(latest(() => ({ YOLO_Smoke_Detected: "yes" })));
    expect(smoke.status).toBe("UNSAFE");
    expect(smoke.nextActions.join(" ")).toMatch(/possible fire/);
  });

  it("accepts true/false words and flags unreadable detections", () => {
    const words = buildDataset(
      [
        "Timestamp,CO_ppm,CH4_vol_pct,O2_vol_pct,CO2_vol_pct,YOLO_Flame_Detected",
        `${new Date(NOW - 60_000).toISOString()},5,0.2,20.8,0.08,maybe`,
      ].join("\n"),
      "w.csv",
    );
    const a = assess(words);
    expect(
      a.dataQuality.some(
        (q) =>
          q.code === "invalid_values" && q.parameter === "YOLO_Flame_Detected",
      ),
    ).toBe(true);
    expect(a.status).toBe("CAUTION");
  });

  it("a negative detection is not proof of safety: it only means the rule passed", () => {
    const a = assess();
    expect(ev(a, "cmr138-flame-detected").result).toBe("ok");
    expect(ev(a, "cmr138-flame-detected").explanation).not.toMatch(/no fire/i);
  });
});

describe("timestamps and freshness", () => {
  it("stale data is CAUTION with a clear warning", () => {
    const a = assess(sensorData({ endMinutesBeforeNow: 16 }));
    expect(a.status).toBe("CAUTION");
    expect(a.isStale).toBe(true);
    expect(a.dataQuality.find((q) => q.code === "stale_data")!.message).toMatch(
      /16 min old/,
    );
  });

  it("a critical reading still gives UNSAFE on stale data", () => {
    expect(
      assess(
        sensorData({
          endMinutesBeforeNow: 600,
          edit: (i) => (i === 9 ? { CH4_vol_pct: 2 } : {}),
        }),
      ).status,
    ).toBe("UNSAFE");
  });

  it("sorts unsorted rows and reports the newest valid timestamp", () => {
    const t = (m: number) => new Date(NOW - m * 60_000).toISOString();
    const csv = [
      "Timestamp,CO_ppm,CH4_vol_pct,O2_vol_pct,CO2_vol_pct",
      `${t(1)},5,0.2,20.8,0.08`,
      `${t(3)},5,0.2,20.8,0.08`,
      `${t(2)},5,0.2,20.8,0.08`,
    ].join("\n");
    const a = assess(buildDataset(csv, "u.csv"));
    expect(a.latestTimestampIso).toBe(t(1));
    expect(a.samplingIntervalSeconds).toBe(60);
  });

  it("uses the configured stale timeout and expected sampling interval", () => {
    const cfg = withSite(
      siteFile({
        dataQuality: {
          staleAfterMinutes: 30,
          expectedSamplingIntervalSeconds: 10,
        },
      }),
    );
    const a = assessSafety(sensorData({ endMinutesBeforeNow: 20 }), cfg, {
      now: NOW,
    });
    expect(a.isStale).toBe(false);
    expect(a.dataQuality.some((q) => q.code === "sampling_interval")).toBe(
      true,
    );
    expect(a.status).toBe("CAUTION");
  });

  it("without a time column the data cannot be confirmed current", () => {
    const a = assess(
      buildDataset(
        "CO_ppm,CH4_vol_pct,O2_vol_pct,CO2_vol_pct\n5,0.2,20.8,0.08",
        "nt.csv",
      ),
    );
    expect(a.status).toBe("CAUTION");
    expect(a.dataQuality[0]!.code).toBe("no_time_column");
  });

  it("flags timestamps in the future", () => {
    expect(
      assess(sensorData({ endMinutesBeforeNow: -30 })).dataQuality.some(
        (q) => q.code === "future_timestamps",
      ),
    ).toBe(true);
  });
});

describe("missing, invalid, conflicting and empty data", () => {
  it("a missing reading is never treated as normal", () => {
    const a = assess(latest(() => ({ O2_vol_pct: "" })));
    expect(a.status).toBe("CAUTION");
    expect(
      a.dataQuality.some(
        (q) => q.code === "missing_latest" && q.parameter === "O2_vol_pct",
      ),
    ).toBe(true);
  });

  it("a required parameter absent from the data blocks SAFE", () => {
    const ds = buildDataset(
      [
        "Timestamp,CO_ppm,CH4_vol_pct,CO2_vol_pct",
        `${new Date(NOW - 60_000).toISOString()},5,0.2,0.08`,
      ].join("\n"),
      "no-o2.csv",
    );
    const a = assess(ds);
    expect(a.status).toBe("CAUTION");
    expect(ev(a, "cmr153-o2-min").notEvaluatedReason).toMatch(
      /not in this data/,
    );
  });

  it("out-of-range and non-numeric readings are invalid, not used", () => {
    const a = assess(latest(() => ({ O2_vol_pct: 150 })));
    expect(
      a.dataQuality.some(
        (q) => q.code === "invalid_values" && q.parameter === "O2_vol_pct",
      ),
    ).toBe(true);
    expect(a.status).toBe("CAUTION");
  });

  it("different values at the same timestamp are conflicting", () => {
    const t = new Date(NOW - 60_000).toISOString();
    const ds = buildDataset(
      [
        "Timestamp,CO_ppm,CH4_vol_pct,O2_vol_pct,CO2_vol_pct",
        `${t},5,0.2,20.8,0.08`,
        `${t},5,0.3,20.8,0.08`,
      ].join("\n"),
      "c.csv",
    );
    const a = assess(ds);
    expect(
      a.dataQuality.some(
        (q) => q.code === "conflict" && q.parameter === "CH4_vol_pct",
      ),
    ).toBe(true);
    expect(a.status).toBe("CAUTION");
  });

  it("an empty dataset is CAUTION", () => {
    const a = assess(emptyData());
    expect(a.status).toBe("CAUTION");
    expect(a.dataQuality[0]!.code).toBe("empty");
  });

  it("a stale sensor inside fresh data is flagged", () => {
    const a = assess(
      sensorData({ n: 30, edit: (i) => (i > 5 ? { CH4_vol_pct: "" } : {}) }),
    );
    expect(
      a.dataQuality.some(
        (q) => q.code === "stale_parameter" && q.parameter === "CH4_vol_pct",
      ),
    ).toBe(true);
    expect(a.status).toBe("CAUTION");
  });
});

describe("unverified and provisional rules", () => {
  it("disabled and unverified rules are reported as not checked, never as passed", () => {
    const a = assess();
    for (const id of [
      "cimfr-grahams-ratio",
      "h2-monitoring",
      "cmr153-wet-bulb",
      "cmr160-velocity-outbye-connection",
    ]) {
      expect(ev(a, id).result).toBe("not_evaluated");
      expect(ev(a, id).notEvaluatedReason).toBeTruthy();
    }
    expect(ev(a, "h2-monitoring").notEvaluatedReason).toMatch(
      /requires verification/,
    );
  });

  it("a triggered provisional critical rule gives CAUTION, never UNSAFE", () => {
    const cfg = withSite(
      siteFile({}, [
        {
          ...base.rules.find((r) => r.id === "cimfr-grahams-ratio")!,
          enabled: true,
        },
      ]),
    );
    // Gases giving a reliable oxygen deficiency and Graham's ratio ≈ 1.5 %.
    const ds = sensorData({
      extraColumns: ["Grahams_Ratio"],
      edit: () => ({ ...HEATING, Grahams_Ratio: 1.5 }),
    });
    const a = assessSafety(ds, cfg, { now: NOW });
    expect(ev(a, "cimfr-grahams-ratio").result).toBe("critical");
    expect(ev(a, "cimfr-grahams-ratio").effect).toBe("CAUTION");
    expect(a.status).not.toBe("UNSAFE");
  });

  it("Reg. 166 degree-specific methane rules apply only when the degree is set", () => {
    expect(
      ev(assess(latest(() => ({ CH4_vol_pct: 0.3 }))), "cmr166-ch4-degree-1")
        .notEvaluatedReason,
    ).toMatch(/not set/);
    const deg1 = withSite(siteFile({ mineContext: { degreeOfGassiness: 1 } }));
    const a = assessSafety(
      latest(() => ({ CH4_vol_pct: 0.1 })),
      deg1,
      { now: NOW },
    );
    expect(ev(a, "cmr166-ch4-degree-1").result).toBe("critical");
    expect(a.status).toBe("UNSAFE");
  });
});

describe("unit conversion inside the engine", () => {
  it("a site rule written in ppm checks a %vol field", () => {
    const cfg = withSite(
      siteFile({}, [
        {
          id: "site-ch4-ppm",
          parameter: "CH4_vol_pct",
          unit: "ppm",
          operator: "greater_than_or_equal",
          warningThreshold: 5000,
          criticalThreshold: null,
          severity: "warning",
          verificationStatus: "verified_site",
          enabled: true,
          source: {
            document: "TEST",
            clause: "TEST",
            localReference: "test",
            verification: TEST_VERIFICATION,
          },
          explanation: "Test fixture.",
        },
      ]),
    );
    const a = assessSafety(
      latest(() => ({ CH4_vol_pct: 0.5 })),
      cfg,
      { now: NOW },
    );
    expect(ev(a, "site-ch4-ppm")).toMatchObject({
      warning: 0.5,
      unit: "%vol",
      result: "warning",
    });
  });

  it("the Reg. 160 velocity rule (m/min) checks an m/s field when enabled", () => {
    const vel = {
      ...base.rules.find((r) => r.id === "cmr160-velocity-outbye-connection")!,
      enabled: true,
    };
    const cfg = withSite(siteFile({}, [vel]));
    const a = assessSafety(
      latest(() => ({ Air_Velocity_m_s: 0.4 })),
      cfg,
      { now: NOW },
    );
    expect(ev(a, "cmr160-velocity-outbye-connection")).toMatchObject({
      critical: 0.5,
      result: "critical",
    });
    expect(a.status).toBe("UNSAFE");
    expect(
      ev(
        assessSafety(
          latest(() => ({ Air_Velocity_m_s: 0.5 })),
          cfg,
          { now: NOW },
        ),
        "cmr160-velocity-outbye-connection",
      ).result,
    ).toBe("ok");
  });
});

describe("derived indicators", () => {
  it("flags a supplied Graham's ratio that disagrees with the gas readings", () => {
    const ds = sensorData({
      extraColumns: ["Grahams_Ratio", "Trickett_Ratio"],
      edit: () => ({
        O2_vol_pct: 19.5,
        CO2_vol_pct: 0.4,
        CO_ppm: 40,
        Grahams_Ratio: 9,
        Trickett_Ratio: 0.3,
      }),
    });
    const a = assess(ds);
    expect(
      a.dataQuality.some(
        (q) => q.code === "derived_mismatch" && q.parameter === "Grahams_Ratio",
      ),
    ).toBe(true);
    expect(a.status).toBe("CAUTION");
  });

  it("recognises a Graham's ratio written as a fraction instead of a percentage", () => {
    // ΔO2 = 0.265 × (100 − 19.5 − 0.4 − 0.2 − 0.004) − 19.5 = 1.6739 → GR = 0.2390 %
    const ds = sensorData({
      extraColumns: ["Grahams_Ratio"],
      edit: () => ({
        O2_vol_pct: 19.5,
        CO2_vol_pct: 0.4,
        CO_ppm: 40,
        Grahams_Ratio: 0.00239,
      }),
    });
    expect(
      assess(ds).dataQuality.find((q) => q.code === "derived_mismatch")!
        .message,
    ).toMatch(/looks like a fraction/);
  });

  it("skips Graham's ratio when the oxygen deficiency is too small (fresh air)", () => {
    const cfg = withSite(
      siteFile({}, [
        {
          ...base.rules.find((r) => r.id === "cimfr-grahams-ratio")!,
          enabled: true,
        },
      ]),
    );
    const a = assessSafety(
      sensorData({
        extraColumns: ["Grahams_Ratio"],
        edit: () => ({ Grahams_Ratio: 3 }),
      }),
      cfg,
      { now: NOW },
    );
    expect(ev(a, "cimfr-grahams-ratio").notEvaluatedReason).toMatch(
      /below 0\.3%/,
    );
  });

  it("detects a steady increase when that provisional rule is enabled", () => {
    const rule = {
      ...base.rules.find((r) => r.id === "cmr137-grahams-steady-increase")!,
      enabled: true,
    };
    const cfg = withSite(siteFile({}, [rule]));
    const ds = sensorData({
      extraColumns: ["Grahams_Ratio"],
      edit: (i) => ({
        ...HEATING,
        Grahams_Ratio: i < 6 ? 0.3 : 0.3 + (i - 5) * 0.05,
      }),
    });
    const a = assessSafety(ds, cfg, { now: NOW });
    expect(ev(a, "cmr137-grahams-steady-increase").result).toBe("warning");
  });
});

describe("threshold display", () => {
  it("shows detections only at the rule's severity level", () => {
    const a = assess();
    const flame = ev(a, "cmr138-flame-detected");
    expect([
      formatThreshold(flame, "warning"),
      formatThreshold(flame, "critical"),
    ]).toEqual(["—", "detected"]);
    const ch4 = ev(a, "cmr153-ch4-any-place");
    expect([
      formatThreshold(ch4, "warning"),
      formatThreshold(ch4, "critical"),
    ]).toEqual(["> 0.8 %vol", "> 1.25 %vol"]);
  });
});
