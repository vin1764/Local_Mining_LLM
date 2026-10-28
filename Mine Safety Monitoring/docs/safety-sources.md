# Safety threshold sources

Evidence behind every numeric threshold in `src/config/safety-rules.json`.
The app never fetches these documents at run time; this file keeps the
relevant wording so the configuration can be reviewed offline.

Checked on **2026-10-28**.

## How the regulation text was verified

| Source | What it is | How it was used |
| --- | --- | --- |
| **Coal Mines Regulations, 2017** — Gazette of India: Extraordinary, Part II Sec. 3(i), Ministry of Labour and Employment notification **G.S.R. 1449(E)**, New Delhi, 27 November 2017, made under s.57 of the Mines Act, 1952. | The governing regulation for every coal mine in India (Reg. 1(3)). | Primary source for all *verified regulatory* thresholds. |
| Reproduction of the Gazette pages: <https://www.ielrc.org/content/e1712.pdf> (122 pages, Gazette page headers 160–…; SHA-256 `e47e47e08517570afc1ebd4a0844b873f732685a592b50911d5ba10c7cb32c1e`). IELRC states it is *not* an official version. | Full text with Gazette page headers. | Clause text extracted from here. |
| Indian Kanoon, regulation-by-regulation text: Reg 137 <https://indiankanoon.org/doc/41752756/>, Reg 138 <https://indiankanoon.org/doc/81632965/>, Reg 153 <https://indiankanoon.org/doc/103528955/>, Reg 160 <https://indiankanoon.org/doc/155835856/>, Reg 166 <https://indiankanoon.org/doc/114611967/>, Reg 169 <https://indiankanoon.org/doc/24390345/>. | Independent copy. | Every phrase quoted below was found **identically in both copies** (automated phrase check). |
| DGMS (<https://dgms.gov.in/UserView/index?mid=1654>) and e-Gazette (<https://egazette.gov.in>). | Official publishers. | **Could not be reached** from the verification environment (connection reset). The official copy and any later amendments were therefore **not** checked. |

**Before relying on these rules at a mine:** confirm each clause against the
official DGMS / e-Gazette copy and check for amendments to Regulations 137,
138, 153, 160, 166 and 169 after 27 November 2017, plus any DGMS circular or
Chief Inspector order that applies to your mine (e.g. a ventilation scheme
approved under the proviso to Reg. 153(2), or an exemption under Reg. 160).
Each rule records this in `source.verification.officialCopyChecked: false`.

## Verbatim excerpts (CMR 2017)

**Reg. 153(2)(b)** — "at every place in the mine where persons are required to
work or pass, the air does not contain less than 19 per cent. of oxygen or more
than 0.5 per cent. of carbon dioxide or any noxious gas in quantity likely to
affect the health of any person;"

**Reg. 153(2)(c)** — "the percentage of inflammable gas does not exceed 0.75 in
the general body of the return air of any ventilating district and 1.25 in any
place in the mine;"

**Reg. 153(2)(d)** — "the wet bulb temperature in any working place does not
exceed 33.5 degrees centigrade, and where the wet bulb temperature exceeds 30.5
degrees centigrade, arrangements are made to ventilate the same with a current
of air moving at a speed of not less than one meter per second;"

**Reg. 160 (Velocity of air current)** — "The velocity of air current measured in
meters per minute at the place shown in column (2) shall be not less than that
shown in column (3)…". Table: *First, second or third degree — Immediate outbye
ventilation connection from the face — 30.* First or second degree: 4.5 m from
any face on the intake side of the brattice — 30; 7.5 m outbye of the discharge
end of an air pipe — 15; maximum span of a longwall face — 60. Third degree:
45 / 25 / 75 respectively.

**Reg. 166(1)** — inflammable gas is deemed found or detected when it is
indicated "(i) by a methane detector to be 0.1 per cent. or more in case of mine
having degree one gassy seams; (ii) by a methane detector to be 0.5 per cent. or
more in case of mine having degree two seams; (iii) … one and a quarter per
cent. or more of inflammable gas in case of mine having degree three gassy
seams." **Reg. 166(3)** — where gas is detected "(a) all persons shall be
withdrawn from the place".

**Reg. 169(1)(c)(i)** — "if any determination shows the percentage of
inflammable gas to exceed 0.8, determination shall be made or samples of air
taken at intervals not exceeding twenty-four hours…". **Reg. 169(1)(e)** — "if
any determination in any ventilating district shows the percentage of
inflammable gas to exceed one and a quarter, the supply of electric energy
shall be cut off immediately from all cables and apparatus in the district".

**Reg. 137(12)** — "In order to detect spontaneous heating in early stages, the
air in the return airway of every depillaring district and, of every goaf which
has not been isolated, shall be (a) tested for percentage of carbon monoxide
once at least in every seven days with an automatic detector …; and (b)
completely analysed once at least in every thirty days with a view to
determining the ratio CO-formed/O2-absorbed: Provided that if successive tests
show any steady increase in the CO-formed/O2 absorbed ratio, suitable measures
shall be taken to determine the site of the heating and to deal with it."

**Reg. 138(1)** — "On the appearance in any part of a mine, of smoke or other
signs indicating that a fire or spontaneous heating has or may have broken out,
effective steps shall be taken, without delay, to deal with the fire or heating
and all persons other than those whose presence in the mine is deemed necessary
for dealing with the fire or heating shall be immediately withdrawn from the
mine."

**Reg. 46(1)(o)** (ventilation officer) — "regularly check the barometer provided
at the mine and report any unusual change in barometric pressure to the
manager for appropriate actions;" (no numeric limit).

**Carbon monoxide:** CMR 2017 sets **no numeric CO limit** for mine air.
Reg. 153(2)(b) only prohibits "any noxious gas in quantity likely to affect the
health of any person". A CO threshold must come from a DGMS circular, Chief
Inspector order or approved site standard.

## Technical guidance (not regulation)

**S K Ray, R P Singh, N Sahay, N K Varma, "Assessing the status of sealed fire in
underground coal mines", *J. Sci. Ind. Res.* 63 (2004) 579–591, Central Mining
Research Institute (now CSIR-CIMFR), Dhanbad.**
<https://cimfr.csircentral.net/103/1/JSIR_63(7)_579-591.pdf>
(SHA-256 `11c562920b8dc65a3fa1ae3727dd9cfb888b7197797bf0cb8e26b0f791eca5b2`)

- **Graham's ratio** — "generally expressed as a percentage, represents the
  fraction of the oxygen absorbed … which appears as carbon monoxide." "As a
  thumb rule … 0.4 per cent or less indicates normal value; 0.5 per cent
  indicates necessity for a thorough check-up; 1 per cent indicates existence
  of heating; 2 per cent indicates serious heating approaches active fire;
  3 per cent and above indicate active fire with certainty." Unreliable "if the
  oxygen deficiency is less than 0.3 per cent."
- **Jones and Trickett ratio** — "{[CO2] + 0.75[CO] − 0.25[H2]}/∆O2 serves as an
  indicator of the type of fuel involved in any fire or explosion … 0.4 to 0.5
  if methane is involved; 0.5 to 1 for coal, oil or conveyor belt and 0.9 to 1.6
  for timber." A fuel-type indicator, **not** a hazard level.
- **Fire gases** — "The progression of gas liberation is normally: carbon
  monoxide, carbon dioxide, hydrogen, ethylene, propylene, and acetylene …
  if gases above hydrogen are detected, an active fire is indicated."
- **Formula check** — the paper's Table 2 uses ∆O2 = 0.265 × N2 − O2 (all in
  % vol). For 12-Sep (O2 4.7, CO 1.25, CO2 14.2, H2 0, N2 76.35): Graham's
  ratio = 100 × 1.25 / (0.265 × 76.35 − 4.7) = 8.0475 (paper: 8.047513);
  Jones & Trickett = (14.2 + 0.75 × 1.25) / 15.5328 = 0.97455 (paper:
  0.974554). These rows are used as test fixtures.

These values are the basis for **provisional** rules only, which are
disabled by default and can never produce UNSAFE.

## Parameters with no verified threshold

CO_ppm, H2_ppm, Coal_Seam_Temp_C, Thermal_IR_Max_C, Barometric_Pressure_kPa
(Reg 46(1)(o) asks only for "unusual change"), Smoke_Obscuration_pct (Reg 138
covers the *appearance* of smoke; the alarm level of an obscuration sensor is
site-specific), Trickett_Ratio, Explosion_Risk_Index (application-specific;
its formula is not defined in this repository). These stay visible as
monitoring parameters with `verificationStatus: "requires_verification"`.
