/**
 * Fire-gas ratios, used to cross-check the Grahams_Ratio and Trickett_Ratio
 * values supplied in the data. Formulas from CSIR-CIMFR (Ray et al., 2004),
 * checked against that paper's Table 2 (see docs/safety-sources.md):
 *
 *   N2  = 100 − (O2 + CO2 + CH4 + CO + H2 + C2H4 + C2H2)       (all % vol)
 *   ΔO2 = 0.265 × N2 − O2                                     (oxygen deficiency)
 *   Graham's ratio (%)       = 100 × CO / ΔO2
 *   Jones & Trickett ratio   = (CO2 + 0.75 × CO − 0.25 × H2) / ΔO2
 *
 * N2 is not measured, so it is estimated as the balance of the measured gases
 * (argon is included in it, as in the paper's samples).
 */
import { convert } from "./units";

export interface GasSample {
  O2_vol_pct?: number | null;
  CO2_vol_pct?: number | null;
  CH4_vol_pct?: number | null;
  CO_ppm?: number | null;
  H2_ppm?: number | null;
  C2H4_ppm?: number | null;
  C2H2_ppm?: number | null;
}

/** CIMFR: Graham's ratio is not meaningful below this oxygen deficiency (% vol). */
export const MIN_OXYGEN_DEFICIENCY = 0.3;

const pct = (ppm: number | null | undefined) =>
  ppm == null ? 0 : convert(ppm, "ppm", "%vol");

export interface DerivedRatios {
  nitrogen: number;
  oxygenDeficiency: number;
  /** null when O2, CO2 or CO is missing, or ΔO2 is too small to be meaningful. */
  grahamsRatio: number | null;
  trickettRatio: number | null;
  reliable: boolean;
}

export function deriveRatios(s: GasSample): DerivedRatios | null {
  if (s.O2_vol_pct == null || s.CO2_vol_pct == null || s.CO_ppm == null)
    return null;
  const co = pct(s.CO_ppm);
  const h2 = pct(s.H2_ppm);
  const nitrogen =
    100 -
    (s.O2_vol_pct +
      s.CO2_vol_pct +
      (s.CH4_vol_pct ?? 0) +
      co +
      h2 +
      pct(s.C2H4_ppm) +
      pct(s.C2H2_ppm));
  const oxygenDeficiency = 0.265 * nitrogen - s.O2_vol_pct;
  const reliable = oxygenDeficiency >= MIN_OXYGEN_DEFICIENCY;
  return {
    nitrogen,
    oxygenDeficiency,
    reliable,
    grahamsRatio: reliable ? (100 * co) / oxygenDeficiency : null,
    trickettRatio: reliable
      ? (s.CO2_vol_pct + 0.75 * co - 0.25 * h2) / oxygenDeficiency
      : null,
  };
}
