# Site thresholds file

The safety panel checks every file against the built-in rules in
`src/config/safety-rules.json` (Coal Mines Regulations, 2017; sources in
[safety-sources.md](safety-sources.md)). A **site thresholds file** adds your
mine's own verified limits, settings and context on top of them.

Load it with **LOAD SITE THRESHOLDS (JSON)** in the safety panel. The app
validates the file and shows a preview (errors, warnings, rules added and
replaced). Nothing changes until you press **APPLY SITE THRESHOLDS**. The
file is saved in that browser only (`localStorage`). **REMOVE SITE FILE**
goes back to the built-in rules. **EXPORT ACTIVE RULES** downloads the rules
in force as a complete `replace` file, which is a good starting template.

An invalid file is rejected with the reasons and never replaces the active
rules. If a file saved earlier stops validating (for example after an app
update), it is ignored and the panel says so.

## Merge policy

| `mergePolicy` | Effect |
| --- | --- |
| `"merge"` (default) | A rule with the same `id` as a built-in rule **replaces** it. New ids are **added**. All other built-in rules are **kept**. `mineContext` and `dataQuality` values you give override the built-in ones; values you leave out are kept. |
| `"replace"` | Only the rules in your file apply. The built-in rules are **removed**. The file must contain at least one enabled verified rule. |

After merging, the combined rules are validated again. A site rule that
duplicates a built-in check (same parameter, operator, unit, thresholds and
context) under a different id is rejected; use the built-in id to replace it.

## Example: add a verified CO limit (merge)

CMR 2017 sets no numeric CO limit, so the built-in `co-site-limit` rule has
`requires_verification` and the app shows CAUTION until a site supplies one.
Replace it by using the same id. The numbers below are placeholders: take
yours from your approved site standard.

```json
{
  "schemaVersion": 1,
  "name": "Mine X ventilation standard rev 4",
  "mineContext": { "degreeOfGassiness": 2 },
  "dataQuality": { "expectedSamplingIntervalSeconds": 60, "staleAfterMinutes": 10 },
  "rules": [
    {
      "id": "co-site-limit",
      "parameter": "CO_ppm",
      "unit": "ppm",
      "operator": "greater_than",
      "warningThreshold": 0,
      "criticalThreshold": 0,
      "severity": "critical",
      "verificationStatus": "verified_site",
      "enabled": true,
      "requiredForSafe": true,
      "source": {
        "document": "Mine X Ventilation Standard, rev 4 (approved 2026-05-01)",
        "clause": "Section 6.2, CO action levels",
        "localReference": "DMS-VENT-004",
        "verification": {
          "method": "Checked against the signed controlled copy",
          "checkedOn": "2026-10-28",
          "officialCopyChecked": true,
          "amendmentsChecked": true,
          "approvedBy": "Ventilation Officer, J. Doe"
        }
      },
      "explanation": "Site CO action level from the approved standard."
    }
  ]
}
```

(Replace both `0` values: as written, the warning is not below the critical
threshold, so the validator would reject this file. That stops a template
being applied by accident.)

## Rule fields

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Lowercase letters, digits and dashes. Unique. |
| `parameter` | yes | An existing field name (see below) or one declared under `parameters`. |
| `unit` | yes | Unit of the thresholds. One of `ppm`, `%vol`, `%`, `°C`, `m/s`, `m/min`, `kPa`, `ratio`, `index`, `boolean`. It may differ from the field's unit only if it can be converted (`%vol`↔`ppm`, `m/s`↔`m/min`). |
| `operator` | yes | `greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal`, `is_true` (yes/no detections only), `steady_increase` (needs `consecutiveIncreases`, no thresholds). |
| `warningThreshold`, `criticalThreshold` | — | Numbers or `null`. For "higher is worse" operators, warning must be below critical; for "lower is worse", above it. Both must be inside the field's valid range. |
| `severity` | yes | `critical` (needs `criticalThreshold` when enabled), `warning` (no `criticalThreshold`), or `monitoring`. |
| `context` | — | `location` (default `any_place`), `gassinessDegree` (1–3: applies only when `mineContext.degreeOfGassiness` matches), `measurement`, `note`. |
| `verificationStatus` | yes | See below. |
| `enabled` | yes | Disabled rules are listed but never checked. |
| `requiredForSafe` | — | If `true`, SAFE is impossible unless this rule is enabled, verified and checked. |
| `consecutiveIncreases` | for `steady_increase` | Number of successive rises that count as "steady" (2–50). |
| `source` | yes | `document`, `clause`, and for verified rules `url` or `localReference` plus `verification` (`method`, `checkedOn`, `officialCopyChecked`, `amendmentsChecked`, optional `approvedBy`). |
| `explanation` | yes | Plain-language reason, shown in the rule table. |

### Verification status and its effect

| Status | Can be enabled | Effect when triggered |
| --- | --- | --- |
| `verified_regulatory` | yes | critical → **UNSAFE**; warning → CAUTION |
| `verified_site` | yes | critical → **UNSAFE**; warning → CAUTION |
| `provisional` | yes (warned) | critical or warning → **CAUTION only**, never UNSAFE |
| `requires_verification` | **no** | Not checked. If `requiredForSafe`, the status stays CAUTION. |

Never mark a value as verified unless you checked it against the original
document. A value from a search result, an article or an AI answer is not
verified.

### Settings

`mineContext`: `country`, `mineType`, `degreeOfGassiness` (1, 2, 3 or
`null`; enables the matching Reg. 166 methane rules), `applicabilityNote`.

`dataQuality` (defaults in brackets):

- `expectedSamplingIntervalSeconds` [null = inferred from the data]: a
  median gap of more than 2× this value adds a data-quality warning (and prevents SAFE).
- `staleAfterMinutes` [15]: newest reading older than this → STALE → CAUTION.
- `evaluationWindowMinutes` [60]: rules are checked on readings in this window
  ending at the newest timestamp.
- `parameterStaleFactor` [3]: a sensor whose last valid reading is more than
  this many sampling intervals behind the newest row is flagged stale.
- `derivedIndicatorTolerancePct` [5]: a supplied `Grahams_Ratio` or
  `Trickett_Ratio` that differs from the value computed from the gas readings
  by more than this is flagged.

## How the status is decided

1. **UNSAFE** if any enabled, verified rule's critical threshold is breached by
   a valid reading in the window (including a positive flame or smoke
   detection). This holds even on stale data.
2. **CAUTION** if data is missing, invalid, stale, conflicting or inconsistent;
   if a required rule is unverified or could not be checked; or if no
   verified rule could be checked at all.
3. **CAUTION** if a warning threshold, a provisional rule, or an earlier
   critical breach (outside the window) is triggered.
4. **SAFE** only if the data is current and valid, every required rule is
   verified and checked, and every check passed. SAFE is not a certification
   that the mine is safe.

A missing reading is never treated as normal, and no configured thresholds
never gives SAFE.

## Using a new dataset

1. **Column names.** The rules match these field names exactly (a
   case-insensitive match also works, with a note): `CO_ppm`, `CH4_vol_pct`,
   `O2_vol_pct`, `CO2_vol_pct`, `H2_ppm`, `C2H4_ppm`, `C2H2_ppm`,
   `Coal_Seam_Temp_C`, `Airway_Temp_C`, `Thermal_IR_Max_C`,
   `Air_Velocity_m_s`, `Barometric_Pressure_kPa`, `Smoke_Obscuration_pct`,
   `Grahams_Ratio`, `Trickett_Ratio`, `Explosion_Risk_Index`,
   `YOLO_Flame_Detected`, `YOLO_Smoke_Detected`. Rename columns in the CSV
   rather than editing rules.
2. **Units.** Gases in `%vol` must be percent by volume (0.5 = 0.5 %), not
   fractions. `ppm` columns are parts per million. Air velocity is m/s.
   Graham's ratio is a percentage (CIMFR convention); a value that looks like
   a fraction is flagged.
3. **Timestamps.** Put them in one column (ISO 8601 with a time zone, e.g.
   `2026-10-28T09:00:00Z`, is safest). Rows can be in any order. A file
   without a time column can never be SAFE.
4. **Detections.** `1/0`, `true/false`, `yes/no`, `detected/not detected` are
   accepted. Anything else is invalid and flagged.
5. **A new sensor.** Declare it under `parameters` (`name`, `unit`, `type`
   `number` or `boolean`, `description`, optional `min`/`max`), then add rules
   for it. Existing fields' units and types cannot be changed by a site file.
6. **Different location or regime.** Built-in rules with a context (return
   air, wet-bulb temperature, the outbye ventilation connection, degree of
   gassiness) are disabled or conditional, because a single CSV column does not
   say where it was measured. If your sensor is at that location, enable the
   rule by including it in your site file with `"enabled": true`.
7. **Try it first** with synthetic data:
   `node scripts/make-sample-sensor-csv.mjs normal` (also `methane`,
   `low-oxygen`, `smoke`, `stale`, `heating`). These files are invented and
   say so.

## Limits of the built-in rules

- Checked against a reproduction of the Gazette and an independent copy, not
  the official DGMS copy; amendments after 27 Nov 2017 were not checked.
- Applies to Indian coal mines under CMR 2017. Other jurisdictions need their
  own `replace` file.
- No numeric limit is shipped for CO, H2, temperatures (other than wet-bulb),
  pressure, smoke obscuration, Trickett ratio or the Explosion Risk Index.
