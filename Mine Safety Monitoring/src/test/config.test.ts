// @vitest-environment node
// Site files below are TEST FIXTURES; their numbers are not real limits.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import builtinJson from "@/config/safety-rules.json";
import {
  builtinConfig,
  previewSiteFile,
  validateConfig,
} from "@/lib/safety/config";
import { MIN_OXYGEN_DEFICIENCY, deriveRatios } from "@/lib/safety/derived";
import {
  activeConfigJson,
  applySiteFileText,
  clearSiteFile,
  getActiveConfig,
  reloadActiveConfig,
} from "@/lib/safety/store";
import { canConvert, convert } from "@/lib/safety/units";
import { TEST_VERIFICATION, siteFile } from "./fixtures";

const base = builtinConfig();

/** A minimal valid rule; override fields per test. */
const rule = (over: Record<string, unknown> = {}) => ({
  id: "site-rule",
  parameter: "CO_ppm",
  unit: "ppm",
  operator: "greater_than",
  warningThreshold: 20,
  criticalThreshold: 40,
  severity: "critical",
  verificationStatus: "verified_site",
  enabled: true,
  source: {
    document: "TEST site standard",
    clause: "TEST 2",
    localReference: "test",
    verification: TEST_VERIFICATION,
  },
  explanation: "Test fixture rule.",
  ...over,
});
const file = (rules: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: 1, name: "TEST", rules, ...extra });
const errorsOf = (text: string) => {
  const r = previewSiteFile(text, base);
  return r.ok ? [] : r.errors;
};

describe("built-in safety-rules.json", () => {
  it("is valid and has real rules for every listed field", () => {
    const res = validateConfig(builtinJson, []);
    expect(res.ok).toBe(true);
    const params = base.parameters.map((p) => p.name);
    for (const f of [
      "CO_ppm",
      "CH4_vol_pct",
      "O2_vol_pct",
      "CO2_vol_pct",
      "H2_ppm",
      "C2H4_ppm",
      "C2H2_ppm",
      "Coal_Seam_Temp_C",
      "Airway_Temp_C",
      "Thermal_IR_Max_C",
      "Air_Velocity_m_s",
      "Barometric_Pressure_kPa",
      "Smoke_Obscuration_pct",
      "Grahams_Ratio",
      "Trickett_Ratio",
      "Explosion_Risk_Index",
      "YOLO_Flame_Detected",
      "YOLO_Smoke_Detected",
    ]) {
      expect(params).toContain(f);
      expect(
        base.rules.some((r) => r.parameter === f),
        `rule for ${f}`,
      ).toBe(true);
    }
  });

  it("enables only verified rules with complete sources", () => {
    for (const r of base.rules.filter((x) => x.enabled)) {
      expect(r.verificationStatus).toBe("verified_regulatory");
      expect(r.source.url).toMatch(/^https:\/\//);
      expect(r.source.clause).toMatch(/^Reg\. \d+/);
      expect(r.source.verification).toBeDefined();
    }
  });

  it("keeps unverifiable thresholds null and disabled", () => {
    for (const r of base.rules.filter(
      (x) => x.verificationStatus === "requires_verification",
    )) {
      expect(r.enabled).toBe(false);
      expect(r.warningThreshold).toBeNull();
      expect(r.criticalThreshold).toBeNull();
    }
    const co = base.rules.find((r) => r.id === "co-site-limit")!;
    expect(co).toMatchObject({
      requiredForSafe: true,
      verificationStatus: "requires_verification",
    });
  });

  it("ships provisional rules disabled", () => {
    const prov = base.rules.filter(
      (r) => r.verificationStatus === "provisional",
    );
    expect(prov.length).toBeGreaterThan(0);
    expect(prov.every((r) => !r.enabled)).toBe(true);
  });
});

describe("valid site files", () => {
  it("merge: adds new rules, replaces same-id rules, keeps the rest", () => {
    const res = previewSiteFile(
      siteFile({}, [
        rule({
          id: "site-new",
          parameter: "H2_ppm",
          warningThreshold: 1,
          criticalThreshold: 2,
        }),
      ]),
      base,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.preview.policy).toBe("merge");
    expect(res.preview.replaced).toEqual(["co-site-limit"]);
    expect(res.preview.added).toEqual(["site-new"]);
    expect(res.preview.kept).toContain("cmr153-o2-min");
    expect(
      res.preview.result.rules.find((r) => r.id === "co-site-limit")!.enabled,
    ).toBe(true);
  });

  it("replace: uses only the file's rules", () => {
    const o2 = { ...base.rules.find((r) => r.id === "cmr153-o2-min")! };
    const res = previewSiteFile(
      file([o2, rule()], { mergePolicy: "replace" }),
      base,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.preview.result.rules.map((r) => r.id)).toEqual([
      "cmr153-o2-min",
      "site-rule",
    ]);
    expect(res.preview.removed).toContain("cmr153-ch4-any-place");
  });

  it("settings-only file changes the degree of gassiness and stale timeout", () => {
    const res = previewSiteFile(
      file([], {
        mineContext: { degreeOfGassiness: 2 },
        dataQuality: { staleAfterMinutes: 5 },
      }),
      base,
    );
    expect(res.ok && res.preview.result.mineContext.degreeOfGassiness).toBe(2);
    expect(res.ok && res.preview.result.dataQuality.staleAfterMinutes).toBe(5);
    expect(
      res.ok && res.preview.result.dataQuality.evaluationWindowMinutes,
    ).toBe(60);
  });

  it("warns (but accepts) an enabled provisional rule", () => {
    const res = previewSiteFile(
      file([rule({ verificationStatus: "provisional" })]),
      base,
    );
    expect(res.ok).toBe(true);
    expect(res.warnings.join(" ")).toMatch(/never UNSAFE/);
  });
});

describe("invalid site files are rejected with a clear reason", () => {
  it.each([
    ["not JSON", "{ nope", /Not valid JSON/],
    [
      "wrong schema version",
      JSON.stringify({ schemaVersion: 2, name: "x", rules: [] }),
      /schemaVersion/,
    ],
    [
      "missing required field",
      file([{ ...rule(), explanation: undefined }]),
      /explanation/,
    ],
    ["unknown operator", file([rule({ operator: "above" })]), /operator/],
    ["unknown unit", file([rule({ unit: "mg/m3" })]), /unit/],
    [
      "unknown parameter",
      file([rule({ parameter: "CO_pmm" })]),
      /unknown parameter "CO_pmm"/,
    ],
    [
      "unit not convertible",
      file([rule({ unit: "°C" })]),
      /cannot be converted/,
    ],
    [
      "boolean field with a number operator",
      file([rule({ parameter: "YOLO_Flame_Detected", unit: "boolean" })]),
      /use operator "is_true"/,
    ],
    ["duplicate id", file([rule(), rule()]), /duplicate id/],
    [
      "warning above critical",
      file([rule({ warningThreshold: 50, criticalThreshold: 40 })]),
      /must be below critical/,
    ],
    [
      "below-rule warning under critical",
      file([
        rule({
          parameter: "O2_vol_pct",
          unit: "%vol",
          operator: "less_than",
          warningThreshold: 18,
          criticalThreshold: 19,
        }),
      ]),
      /must be above critical/,
    ],
    [
      "out of range",
      file([
        rule({
          parameter: "O2_vol_pct",
          unit: "%vol",
          operator: "less_than",
          warningThreshold: 150,
          criticalThreshold: 19,
        }),
      ]),
      /outside O2_vol_pct's valid range/,
    ],
    [
      "critical rule without critical threshold",
      file([rule({ criticalThreshold: null })]),
      /needs a criticalThreshold/,
    ],
    [
      "verified rule without verification metadata",
      file([
        rule({
          source: { document: "TEST", clause: "1", localReference: "x" },
        }),
      ]),
      /needs source.verification/,
    ],
    [
      "verified rule without url or reference",
      file([
        rule({
          source: {
            document: "TEST",
            clause: "1",
            verification: TEST_VERIFICATION,
          },
        }),
      ]),
      /source.url or source.localReference/,
    ],
    [
      "enabled requires_verification",
      file([rule({ verificationStatus: "requires_verification" })]),
      /cannot be enabled/,
    ],
    ["bad rule id", file([rule({ id: "Bad ID" })]), /lowercase/],
    ["empty file", file([]), /no rules or settings/],
    [
      "replace without a verified rule",
      file([rule({ verificationStatus: "provisional" })], {
        mergePolicy: "replace",
      }),
      /at least one enabled verified rule/,
    ],
    [
      "field unit redefinition",
      file([], {
        parameters: [
          { name: "CO_ppm", unit: "%vol", type: "number", description: "x" },
        ],
      }),
      /Field units cannot be changed/,
    ],
    [
      "duplicate of a built-in check",
      file([
        { ...base.rules.find((r) => r.id === "cmr153-o2-min")!, id: "my-o2" },
      ]),
      /duplicates rule "cmr153-o2-min"/,
    ],
  ])("%s", (_name, text, pattern) => {
    const errs = errorsOf(text as string);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(" | ")).toMatch(pattern as RegExp);
  });
});

describe("unit conversion", () => {
  it("converts %vol ↔ ppm and m/s ↔ m/min", () => {
    expect(convert(1.25, "%vol", "ppm")).toBe(12_500);
    expect(convert(50, "ppm", "%vol")).toBe(0.005);
    expect(convert(30, "m/min", "m/s")).toBe(0.5);
    expect(convert(1, "m/s", "m/min")).toBe(60);
    expect(convert(19, "%vol", "%vol")).toBe(19);
  });

  it("refuses conversions it does not know", () => {
    expect(canConvert("°C", "kPa")).toBe(false);
    expect(canConvert("%", "%vol")).toBe(false);
    expect(() => convert(1, "°C", "ppm")).toThrow();
  });
});

describe("derived fire-gas ratios (CIMFR, Ray et al. 2004)", () => {
  it("reproduces the paper's Table 2 row for 12 Sep", () => {
    // O2 4.7, CO 1.25 %, CO2 14.2, H2 0, N2 76.35 (CH4 3.5 makes up the balance).
    const r = deriveRatios({
      O2_vol_pct: 4.7,
      CO2_vol_pct: 14.2,
      CO_ppm: 12_500,
      CH4_vol_pct: 3.5,
      H2_ppm: 0,
    })!;
    expect(r.nitrogen).toBeCloseTo(76.35, 6);
    expect(r.grahamsRatio).toBeCloseTo(8.047513, 4);
    expect(r.trickettRatio).toBeCloseTo(0.974554, 5);
  });

  it("returns no ratio when oxygen deficiency is too small or gases are missing", () => {
    const fresh = deriveRatios({
      O2_vol_pct: 20.8,
      CO2_vol_pct: 0.08,
      CO_ppm: 5,
    })!;
    expect(fresh.oxygenDeficiency).toBeLessThan(MIN_OXYGEN_DEFICIENCY);
    expect(fresh.grahamsRatio).toBeNull();
    expect(
      deriveRatios({ O2_vol_pct: 20.8, CO2_vol_pct: null, CO_ppm: 5 }),
    ).toBeNull();
  });
});

describe("stored site file (local persistence)", () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    };
    clearSiteFile();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("uses the built-in rules when no site file was imported", () => {
    const a = getActiveConfig();
    expect(a.site).toBeNull();
    expect(a.config.rules.filter((r) => r.enabled).length).toBeGreaterThan(0);
  });

  it("an invalid file never replaces the active rules", () => {
    applySiteFileText(siteFile());
    const before = getActiveConfig();
    const errs = applySiteFileText(file([rule({ unit: "°C" })]));
    expect(errs).not.toBeNull();
    expect(getActiveConfig()).toBe(before);
    expect(getActiveConfig().site?.replaced).toEqual(["co-site-limit"]);
  });

  it("applies, persists, exports and clears a valid file", () => {
    expect(applySiteFileText(siteFile())).toBeNull();
    expect(Object.values(store)).toHaveLength(1);
    expect(getActiveConfig().source).toMatch(/site file/);
    const exported = JSON.parse(activeConfigJson());
    expect(exported.mergePolicy).toBe("replace");
    // The export is itself a valid replace file.
    expect(previewSiteFile(JSON.stringify(exported), base).ok).toBe(true);
    clearSiteFile();
    expect(getActiveConfig().site).toBeNull();
    expect(Object.values(store)).toHaveLength(0);
  });

  it("ignores a stored file that no longer validates, and says so", () => {
    store["strata-site-thresholds-v2"] = file([rule({ unit: "°C" })]);
    reloadActiveConfig();
    const a = getActiveConfig();
    expect(a.site).toBeNull();
    expect(a.config).toBe(base);
    expect(a.siteError).toMatch(/no longer valid.*cannot be converted/);
  });
});
