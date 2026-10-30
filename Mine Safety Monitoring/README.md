# STRATA — Offline Mine Data Intelligence

Upload a mine-site CSV log and get multi-parameter trends, correlations, outlier
flags and an AI shift report. **Everything runs on your computer.** The AI
report comes from a local model (Qwen 2.5 1.5B by default) served by
[Ollama](https://ollama.com). After the one-time setup, no internet connection
is needed.

```
Browser (React UI) ── http://127.0.0.1:8080 ──► Local app server (Node.js, TanStack Start)
   │  CSV parsing + statistics                      │  validates the request
   │  saved runs (IndexedDB)                        │  builds a facts sheet from the statistics
   ▼                                                ▼
 nothing leaves this computer          Ollama ── http://127.0.0.1:11434 ──► qwen2.5:1.5b
```

- **Frontend:** the original React + Vite + TypeScript app (TanStack Start).
  The design and features are unchanged.
- **Local backend:** the app's own TanStack Start server functions, built as a
  plain Node.js server. Frontend and backend run as **one process**, so one
  command starts both.
- **Inference:** Ollama on loopback, behind a small provider interface
  (`src/lib/ai/provider.ts`). Ollama is the first implementation.
- **Storage:** saved runs (CSV + AI report) are kept in the browser's IndexedDB
  on this computer. Reports can be exported as Markdown files.

---

## Two editions

| | **Local app** (`npm start`) | **Web edition** (GitHub Pages) |
| --- | --- | --- |
| Where the AI runs | Ollama on your computer | **Preferred:** the local app (Ollama) on the visitor's computer, if it is running and allows the site. **Optional:** inside the browser (WebLLM + WebGPU) after the visitor chooses it |
| Model | `qwen2.5:1.5b` via Ollama | Same via the local app; or Qwen 2.5 1.5B Instruct (MLC build) in the browser |
| Install needed | Node.js + Ollama | None to view the dashboard; the local app for local AI |
| Works offline | Yes, after setup | No, the page needs a connection to open |
| Browser support | Any modern browser | Chrome or Edge recommended (see "Local AI from GitHub Pages") |
| Without any AI | Charts, statistics and the rule-based safety status still work | Same |

Both editions use the same dashboard, statistics, safety rules, findings and
consistency checks (`src/lib/ai/analyst.ts`). Only the place the model runs differs.

### Web edition (GitHub Pages)

- **Build locally:** `npm run build:pages` writes a static site to `dist-pages/`.
  Preview it with `npm run preview:pages` (http://127.0.0.1:8081).
- **Deploy:** `.github/workflows/pages.yml` builds and publishes the site on
  every push to `main`. One-time setup: in the GitHub repo, open
  **Settings → Pages** and set **Source** to **GitHub Actions**.
- **AI source:** the page first looks for the local STRATA app at
  `http://127.0.0.1:8080` (change with `VITE_LOCAL_AI_URL` at build time). If it
  is not reachable, the AI Analyst shows **Local AI is not running** with the
  start command, and offers the in-browser model as an alternative. There is no
  cloud fallback.
- **In-browser model download:** nothing large downloads until the visitor clicks
  **USE IN-BROWSER MODEL INSTEAD**. The model comes from WebLLM's model hosts
  (Hugging Face and the `mlc-ai` GitHub repos) and is cached in that browser.
  The CSV and the statistics never leave the device.
- **GPUs without 16-bit shader support** automatically get the `q4f32` build of
  the same model (a little larger).
- **Changing the model:** set `VITE_WEBLLM_MODEL` to any id from WebLLM's
  prebuilt list when building, for example
  `VITE_WEBLLM_MODEL=Qwen2.5-3B-Instruct-q4f16_1-MLC npm run build:pages`.
- **Saved runs** are stored in the visitor's browser for the site's address.

### Local AI from GitHub Pages

GitHub Pages only serves static files. It cannot run Node.js or Ollama. To use
your local model from the hosted page:

1. Install and build the local app (section 1), with Ollama running.
2. Start it and allow the Pages site to call it:

   ```powershell
   npm run start:with-pages
   ```

   That is `npm start` plus `--allow-origin https://vin1764.github.io`. For a
   fork, or for `npm run dev`, set `CORS_ALLOWED_ORIGINS=https://<user>.github.io`
   in `.env` instead.
3. Open https://vin1764.github.io/Local_Mining_LLM/ in **Chrome or Edge**. If the
   browser asks to let the site access devices on your local network, allow it.
   The badge then shows `LOCAL AI · QWEN2.5:1.5B`.

How this stays safe:

- The app still listens on `127.0.0.1` only, so other computers cannot reach it.
- Only the exact origins you list may call `/api/local-ai/status` and
  `/api/local-ai/analyze`. There is no `*` wildcard, and requests addressed to any
  host other than localhost are refused.
- The analyze route only accepts `application/json`, so other websites cannot
  send it without a CORS preflight, which they fail. It answers Chrome's
  Private Network Access preflight only for allowed origins.
- The API only analyses a statistics profile. It is not a proxy and cannot read files.

Browser limits: an HTTPS page calling `http://127.0.0.1` relies on the browser
treating loopback as a secure address. Chrome and Edge do this. Firefox and
Safari were not tested and may block the request; if so, use the local app at
http://127.0.0.1:8080 directly.

## 1. One-time setup (needs internet)

### Windows (PowerShell) — primary

1. **Install Node.js 22 LTS or newer**: download it from <https://nodejs.org>, or run

   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

   Close and reopen PowerShell, then check: `node --version` (must be v22.12 or newer).

2. **Install Ollama**: download it from <https://ollama.com/download/windows> and
   run the installer, or run `winget install Ollama.Ollama`. Ollama starts in
   the background and listens on `127.0.0.1:11434`.

3. **Download the model** (about 1 GB):

   ```powershell
   ollama pull qwen2.5:1.5b
   ollama run qwen2.5:1.5b "Say hello in five words."
   ```

4. **Install the app's dependencies** (from this folder):

   ```powershell
   cd "Mine Safety Monitoring"
   npm ci
   ```

   `npm ci` uses the committed `package-lock.json`. Use it instead of a fresh
   `npm install`, which crashes on npm 10 because of an npm bug (see Troubleshooting).

5. **Optional:** copy the example settings and edit them:

   ```powershell
   Copy-Item .env.example .env
   ```

6. **Build the app and check everything:**

   ```powershell
   npm run build
   npm run doctor -- --infer
   ```

   All checks should say `PASS`. From here on, the internet can be off.

### macOS / Linux

```bash
# Node.js 22+: https://nodejs.org (or: brew install node@22)
# Ollama:      https://ollama.com/download  (Linux: curl -fsSL https://ollama.com/install.sh | sh)
ollama pull qwen2.5:1.5b
cd "Mine Safety Monitoring"
npm ci
cp .env.example .env      # optional
npm run build
npm run doctor -- --infer
```

## 2. Daily use (works offline)

1. Make sure Ollama is running: open the Ollama app, or run `ollama serve`.
2. Start STRATA:

   ```powershell
   npm start
   ```

3. Open **<http://127.0.0.1:8080>** in your browser. To also serve the GitHub
   Pages site, start with `npm run start:with-pages` instead (see above).
4. Drop a CSV file onto the intake box, or click **LOAD DEMO ORE SAMPLE**.
5. The AI analyst runs automatically. The header badge shows
   `LOCAL AI · QWEN2.5:1.5B` when the model is ready.
6. Click **SAVE CURRENT RUN** to keep the CSV and its report. Use **OPEN** to
   reload it later, even after a restart. **EXPORT REPORT** downloads a Markdown file.

Stop the app with `Ctrl+C`.

**Development mode** (hot reload, same address): `npm run dev`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on http://127.0.0.1:8080 |
| `npm run build` | Production build into `.output/` |
| `npm start` | Run the production build on http://127.0.0.1:8080 |
| `npm run start:with-pages` | Same, and let https://vin1764.github.io use this computer's local AI |
| `npm run build:pages` | Static GitHub Pages build into `dist-pages/` |
| `npm run doctor` | Check Node, dependencies, build, Ollama and the model (`-- --infer` also runs a test prompt) |
| `npm run setup:model` | `ollama pull qwen2.5:1.5b` |
| `npm test` | Unit tests (no Ollama needed) |

## 3. Configuration

All settings are optional environment variables. Put them in `.env` (see
`.env.example`), or set them in PowerShell before starting, for example
`$env:OLLAMA_MODEL="qwen2.5:3b"; npm start`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama address. Only loopback addresses are accepted. |
| `OLLAMA_MODEL` | `qwen2.5:1.5b` | Any model pulled into Ollama. |
| `OLLAMA_TIMEOUT_MS` | `180000` | Max time for one model call. |
| `OLLAMA_NUM_CTX` | `8192` | Context window passed to the model. |
| `OLLAMA_TEMPERATURE` | `0.2` | Lower is more literal. |
| `OLLAMA_ALLOW_NON_LOOPBACK` | unset | Set to `1` to allow Ollama on another machine on your own network. |
| `HOST` | `127.0.0.1` | App listen address. Keep loopback. |
| `PORT` | `8080` | App port. Saved runs belong to this exact address. |
| `ALLOWED_HOSTS` | unset | Extra host names the app accepts (comma-separated). |
| `CORS_ALLOWED_ORIGINS` | unset | Exact web origins allowed to call the local AI API, e.g. `https://vin1764.github.io` (comma-separated, no wildcard). |
| `VITE_LOCAL_AI_URL` | `http://127.0.0.1:8080` | Pages build only: where the hosted page looks for the local app. |

No API keys are needed. `LOVABLE_API_KEY` is no longer used.

## 4. Changing the model

1. Pull the model while online, for example `ollama pull qwen2.5:3b`.
2. Set `OLLAMA_MODEL=qwen2.5:3b` in `.env`.
3. Restart with `npm start` (or `npm run dev`). No code changes are needed.

Larger models (`qwen2.5:3b`, `qwen2.5:7b`, `llama3.2:3b`) write better prose and
pass the consistency checks more often, but they are slower and need more RAM.
The model must support Ollama's structured (JSON-schema) output, as current
Ollama models do.

To use a different runtime (llama.cpp server, LM Studio, …), implement
`LocalInferenceProvider` from `src/lib/ai/provider.ts` and return it from
`createProvider()` in `src/lib/ai/analyst.server.ts`.

## 5. How the AI analysis stays accurate

Small models misquote numbers, so the work is split:

1. **Statistics are computed by code** (`src/lib/dataset.ts`): min, max, mean,
   standard deviation, missing values, a trend (mean of the last quarter of rows
   vs the first quarter), 3-sigma outliers and Pearson correlations. Rows are
   sorted by the time column first.
2. **Each finding's facts and severity are written by code.** The severity is
   statistical, **not a safety rating**:
   - **critical:** a value at |z| ≥ 4, or a change of 50% or more
   - **watch:** any |z| ≥ 3 outlier, a change of 10% or more, or 10%+ missing values
   - **normal:** otherwise
3. **The model receives a compact facts sheet**, not the raw CSV. It writes the
   headline, the summary, a hedged "possible explanation" per finding, and the
   recommendations.
4. **Model text is checked.** Any sentence that names a parameter moving the
   wrong way ("temperature decreased" when it rose), calls a moving parameter
   "stable", or quotes a number not in the facts is rejected. The app retries
   once. If the summary is still wrong, the headline and summary are written from
   the statistics instead, and the panel says so.

The system prompt is in **`src/lib/ai/prompts.ts`** (`MINING_SYSTEM_PROMPT`).
`buildSystemPrompt()` adds this file's sensor names, units and configured
thresholds, and the facts sheet adds the safety assessment and each
parameter's latest value against its 1-hour moving average.

## 5a. Safety classification

Every analysis shows a safety status first, before the AI text. There are only
three statuses:

| Status | Meaning |
| --- | --- |
| **UNSAFE** (red, ✕ shield) | An enabled, **verified** rule's critical threshold is breached by a valid reading in the last 60 minutes (or flame/smoke is detected) |
| **CAUTION** (amber, ! shield) | A warning threshold or provisional rule is triggered, **or** the data is stale, missing, invalid or conflicting, **or** a required rule is unverified or could not be checked |
| **SAFE** (green, ✓ shield) | Current, valid data, every required rule verified and checked, every check passed. **Not a certification that the mine is safe.** |

Data-quality problems are listed separately under the status (marked
**PREVENTS SAFE** when they do). The panel also shows the newest timestamp,
its age (CURRENT or STALE), the sampling interval, how many rules are enabled
and checked with their verification status, and a table of every rule with
its result, latest value, 1-hour average, worst value, thresholds and source.

- **Deterministic.** The status comes from `assessSafety()` in
  `src/lib/safety/assess.ts`, never from the model, and works with no AI.
- **The model explains, it does not decide.** It receives the status, the
  measurements, the thresholds and their sources, the triggered rules, the
  newest timestamp and the data-quality warnings. If it reports a different
  status, calls conditions "safe", or reports a breach the rules did not find,
  the app retries once, then keeps the rule-based status and marks the AI text
  **needs review**.

### Built-in rules (Coal Mines Regulations, 2017)

`src/config/safety-rules.json` ships 23 rules covering all 18 sensor fields.
Sources and verbatim clauses are in [docs/safety-sources.md](docs/safety-sources.md).

| Checked by default | Threshold | Source |
| --- | --- | --- |
| `CH4_vol_pct` | warning > 0.8, critical > 1.25 %vol | CMR 2017 Reg. 153(2)(c), 169(1)(c)(i) |
| `O2_vol_pct` | critical < 19 %vol | Reg. 153(2)(b) |
| `CO2_vol_pct` | critical > 0.5 %vol | Reg. 153(2)(b) |
| `YOLO_Flame_Detected`, `YOLO_Smoke_Detected` | positive detection | Reg. 138(1) |
| `CH4_vol_pct` by degree of gassiness | ≥ 0.1 / 0.5 / 1.25 %vol | Reg. 166(1), only when `degreeOfGassiness` is set |

Verified but **off by default** because they depend on where the sensor is:
methane in return air (0.75 %vol), wet-bulb temperature (30.5 / 33.5 °C),
air velocity at the outbye ventilation connection (30 m/min).

**Provisional** (off by default; can only give CAUTION): Graham's ratio
0.5 / 1.0 % and its steady increase, ethylene and acetylene presence (CIMFR).

**No verified threshold** (shown, not checked): CO, H2, coal seam and
thermal IR temperature, barometric pressure, smoke obscuration, Trickett
ratio, Explosion Risk Index.

CMR 2017 has no numeric CO limit, so **the built-in rules alone always give
CAUTION** ("required check co-site-limit is not verified"). Add your site's
verified CO limit with a site thresholds file to make SAFE possible.

The regulation text was checked against a reproduction of the Gazette and an
independent copy. The official DGMS copy and later amendments could not be
checked; the panel says so under every assessment.

### Site thresholds (LOAD SITE THRESHOLDS (JSON))

A site file adds or replaces rules and sets the degree of gassiness, the
expected sampling interval and the stale timeout. It is validated and
previewed before it is applied, saved in that browser only, and an invalid file
never replaces the active rules. Format, merge policy and instructions for new
datasets: **[docs/site-thresholds.md](docs/site-thresholds.md)**.

To try it with invented data: `node scripts/make-sample-sensor-csv.mjs normal`
(or `methane`, `low-oxygen`, `smoke`, `stale`, `heating`).

## 5b. One-hour moving average

The Parameter Deck plots each parameter with a dashed **1-hour moving average**
(`src/lib/moving-average.ts`). It was previously a 7-row average labelled "7-DAY".

- **Rolling (trailing) mean by time.** For each reading at time *t*, it averages
  every valid reading of that parameter with a timestamp in (*t* − 60 min, *t*].
  A reading exactly 60 minutes earlier is outside the window.
- **Timestamps, not row counts,** decide the window, so irregular sampling and
  gaps are handled correctly. Rows are sorted by time first.
- **Missing or invalid values** are left out. The old version counted them as 0.
  A window with no valid readings has no average, which shows as a gap.
- **No time column:** there is no 1-hour window, so the chart says
  `1-HOUR MA N/A (NO TIME COLUMN)`.
- **Sparse data:** when readings are an hour or more apart (like the daily demo
  data), each window holds one reading, so the average equals the reading. The
  chart says `1-HOUR MA · ≤1 READING/HOUR`.

## 6. Privacy and security

- The app listens on `127.0.0.1` only (dev and production). It is not reachable
  from other computers.
- Requests whose `Host` header is not `localhost` / `127.0.0.1` / `[::1]` are
  refused (protection against DNS rebinding). Server functions keep TanStack's
  CSRF protection, and request bodies are capped at 1 MB.
- The server only calls fixed Ollama routes (`/api/version`, `/api/tags`,
  `/api/chat`) on the configured loopback URL. It is not a general proxy.
- The analysis input is schema-validated with size limits before it reaches the model.
- Server logs contain only metadata (model, duration, error code), never dataset
  contents or model text.
- There is no cloud fallback. If Ollama is down, the app shows an error with
  setup steps.

## 7. Saved runs

Saved runs live in your browser's IndexedDB for the address
`http://127.0.0.1:8080`. They survive app and computer restarts. Keep in mind:

- Clearing the browser's site data, or using a private window, removes them.
- A different port, or `localhost` instead of `127.0.0.1`, is a different
  address with a separate store.
- Each browser keeps its own store.
- The limit is 50 saved runs. Use **EXPORT REPORT** to keep reports as files.

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Badge says **LOCAL AI OFFLINE** | Start Ollama (open the app, or `ollama serve`). Run `npm run doctor`. |
| Badge says **MODEL NOT DOWNLOADED** | `ollama pull qwen2.5:1.5b` (or the model in `OLLAMA_MODEL`), while online. |
| "did not answer within 180 s" | The first run loads the model, which is slow on some PCs. Retry, or raise `OLLAMA_TIMEOUT_MS`. |
| Summary says it was "written from the statistics" | The model contradicted the data twice. Click **RE-RUN**, or use a larger model. |
| `npm install` fails with `Cannot read properties of null (reading 'edgesOut')` | npm 10 bug. Use `npm ci` (uses the lockfile), or `npm install --legacy-peer-deps`, or upgrade npm (`npm i -g npm@11`). |
| `Port 8080 is in use` | Close the other program, or set `PORT=8090`. Saved runs are per port. |
| `Forbidden: this app only accepts requests addressed to localhost` | Open `http://127.0.0.1:8080`, or add your host name to `ALLOWED_HOSTS`. |
| `No production build found` | Run `npm run build` before `npm start`. |
| Saved runs disappeared | The browser's site data was cleared, or you opened a different address or port (see section 7). |
| `node` is too old | Install Node.js 22.12 or newer. |

## 9. What changed in the migration

### Cloud dependencies removed

| Before | Now |
| --- | --- |
| Lovable AI Gateway (`ai.gateway.lovable.dev`), model `openai/gpt-6-astra`, `LOVABLE_API_KEY` | Ollama on `127.0.0.1:11434`, `qwen2.5:1.5b`, no key |
| `ai` and `@ai-sdk/openai` SDKs | Plain `fetch` to Ollama (`src/lib/ai/ollama.server.ts`) |
| Google Fonts (Bebas Neue, Barlow, IBM Plex Mono) from `fonts.googleapis.com` | The same fonts bundled locally via `@fontsource/*` (SIL OFL) |
| Lovable editor error-reporting hook | Removed. Errors are logged to the browser console only. |
| Build target: Cloudflare Workers | Build target: Node.js server (`nitro` preset `node-server`) |
| Dev server listening on all interfaces (`::`) | Listening on `127.0.0.1` only |

The app had no database, authentication, Supabase or Firebase, so none needed
replacing. `@lovable.dev/vite-tanstack-config` is still used, but only as
build tooling. Outside Lovable's sandbox it makes no network calls.

Install-time note: the original `bun.lock` resolves packages from Lovable's npm
mirror. The new `package-lock.json` (used by `npm ci`) resolves from the public
npm registry. Neither is used at runtime.

### Remaining limitations

- **Model quality:** Qwen 2.5 1.5B is small. Its summaries contradict the data
  often enough that the code-written fallback is common. Its "possible
  explanations" are generic, and it sometimes renames columns (e.g. calls
  `co_ppm` "CO2"). The code-written facts in each finding are the reliable part.
- **Speed:** on a 4-core CPU with no GPU, one analysis took 30–90 s (a retry
  doubles it). A GPU makes Ollama much faster.
- **Consistency checks are heuristic:** they catch wrong directions and invented
  numbers. They cannot catch every mistake, for example a real date attached to
  the wrong value.
- **Built-in thresholds are CMR 2017 only** and were not checked against the
  official DGMS copy or amendments. Without a site CO limit the status is never
  SAFE (see section 5a). Severities on the statistical findings are
  trend/outlier ratings, not safety limits.
- **AI wording can misattribute.** The safety checks catch a wrong status, "safe"
  claims, breach claims under a non-UNSAFE status, and a breach claimed for a
  parameter whose rules passed (e.g. "CO2 exceeded critical limits" when only
  methane did). They cannot catch every slip, such as a parameter referred to by
  an unusual name. The rule-based evidence table is authoritative.
- **Column typing quirk (existing):** a numeric column whose values are all
  negative (e.g. `-5`) is detected as a time column, so it is not assessed. For a
  required parameter this gives CAUTION, never SAFE.
- **Saved runs are per browser and address** (IndexedDB), not a shared database.
- **Lint:** `npm run lint` reported ~790 Prettier formatting errors in the original
  code before this migration. New files are formatted; old files were left as they
  were, to keep the diff readable.
- **Not tested on Windows:** see the test results below.

## 10. Test results

### Safety thresholds update (latest)

Tested in the same Linux container with Ollama 0.40.11 and `qwen2.5:1.5b`.
All readings were **synthetic** (`scripts/make-sample-sensor-csv.mjs` and test
fixtures); the site CO limit used in tests is a fixture, not a real limit.

**Passed**

- `tsc --noEmit`, `npm run build`, `npm run build:pages`.
- `npm test`: 157 unit tests in 10 files, including:
  - `safety.test.ts` (36): built-in config loads real rules (5 checked by
    default); no site file → CAUTION; every enabled rule at its boundaries
    (CH4 0.8 / 0.81 / 1.25 / 1.26 %vol, O2 19 / 18.99, CO2 0.5 / 0.51, site CO
    25 / 26 / 51 ppm); flame and smoke detections (1, "yes", unreadable);
    stale data → CAUTION, stale + critical → UNSAFE; unsorted rows; configured
    stale timeout and sampling interval; no time column; future timestamps;
    missing latest value, missing column, out-of-range value, conflicting
    duplicate timestamps, empty data, a sensor gone stale; disabled and
    unverified rules shown as NOT CHECKED; provisional critical → CAUTION only;
    degree-of-gassiness rules; ppm and m/min rules applied to %vol and m/s
    fields; Graham's ratio cross-check, fraction-vs-percent detection, the
    ΔO2 < 0.3 guard, steady increase; only SAFE/CAUTION/UNSAFE ever returned.
  - `config.test.ts` (37): the shipped JSON is valid and covers all 18
    fields; enabled rules are verified with sources; unverified thresholds
    are null and disabled; provisional rules ship disabled; merge and replace
    imports; 21 kinds of invalid file each rejected with its reason; unit
    conversions; CIMFR Table 2 (12 Sep) reproduced (Graham 8.0475,
    Trickett 0.97455); saved file applied, persisted, exported, cleared; an
    invalid file never replaces the active rules.
  - `ai-safety.test.ts` (21): the prompt carries thresholds, verification
    status, clauses, newest timestamp, data-quality warnings and unverified
    required rules; the model cannot change the status; misattributed
    breaches are flagged; no assessment → CAUTION.
- Synthetic scenarios with the built-in rules / with a site CO rule: normal →
  CAUTION / SAFE; methane → UNSAFE; low oxygen → UNSAFE; smoke → UNSAFE;
  stale → CAUTION; heating → CAUTION.
- Browser end-to-end (Chromium, production build, real local model): built-in
  rules shown with a non-zero count; no INSUFFICIENT text; invalid site file
  rejected in the preview with no APPLY button and rules unchanged; valid
  file previewed (merge, 1 replaced) then applied → SAFE; kept after reload;
  methane → UNSAFE with the clause, AI explanation and exported report
  agreeing; low oxygen and smoke → UNSAFE; stale → CAUTION with STALE and
  PREVENTS SAFE; removing the site file → CAUTION; no request left 127.0.0.1
  (25 checks). In one run the model wrote "CO2 exceeded critical limits" when
  only methane had; the misattribution check was added for that.
- The same browser test on the GitHub Pages build, served under
  `/Local_Mining_LLM/`, without AI: all 23 non-AI checks passed (the safety
  status, import, preview and persistence run entirely in the browser).

**Not verified**

- The official DGMS copy of CMR 2017 and any amendments (site unreachable).
- Real mine data or a real site thresholds file.
- Windows, and browsers other than Chromium.

### Mining safety update

Tested in the same Linux container with Ollama 0.40.11 and `qwen2.5:1.5b`.

**Passed**

- `npm test`: 94 unit tests, including 11 for the 1-hour moving average (a full
  hour, several hours, the 60-minute boundary, missing/invalid values, unsorted
  and irregular timestamps, empty data), 16 for the safety engine (each status,
  priority order, missing/stale/invalid/conflicting data, old data, no time
  column, thresholds file validation), 16 for the AI prompt and safety guard
  (mining prompt and sensor context sent, model cannot override the status,
  review flags, malformed output) and 8 for the local AI API (CORS allowlist,
  preflight, Host check, JSON-only, size limit).
- `npm run build` and `npm run build:pages` (relative `./assets/` paths for the
  `/Local_Mining_LLM/` sub-path; no server code in the Pages bundle).
- Local app in Chromium with real Ollama: demo data gives INSUFFICIENT DATA (a status since removed) before
  any AI runs, with 1-hour MA labels and no "7-DAY" text left. After loading a
  test thresholds file (fixture values, not real limits), a CSV with a critical
  reading gives UNSAFE, with the measurement table, AI explanation and exported
  report all showing it, and a CSV within limits gives SAFE with the
  "not a certification" note. No request left 127.0.0.1.
- Pages build served from a different origin under `/Local_Mining_LLM/`: assets
  and charts load. With the local app not allowing the origin, the badge says
  `LOCAL AI NOT RUNNING`, the panel shows the start command, and no analysis is
  invented. With `--allow-origin`, the analysis came from the local Ollama app.
- `npm run dev`: the local API answers the allowed origin (including the
  private-network preflight) and refuses others.

**Not verified**

- Windows, and browsers other than Chromium.
- Chrome's local-network permission prompt in a normal (non-headless) browser.
- Real site thresholds or real mine data.

### Earlier releases

Tested in a Linux container (4 CPU cores, no GPU) with Node.js 22.22, npm
10.9.4, Ollama 0.40.11 and `qwen2.5:1.5b` (986 MB, pulled from the official
Ollama library).

**Passed**

- `npm ci` from a clean copy (npm 10), `npm run build`, `tsc --noEmit`.
- `npm test`: 39 unit tests. They cover the Ollama provider (success, not
  running, model missing, bad JSON, HTTP error, cancel, timeout), status checks,
  config validation (loopback-only URL, model names), the host guard, the facts
  sheet, the severity rule, the consistency checks, the retry/fallback logic,
  input limits, time sorting and save/rebuild round-trips.
- The production server listens on `127.0.0.1:8080`. A request with
  `Host: evil.example.com` gets 403.
- The built client bundle has no references to Ollama, Lovable or remote assets.
  All fonts are served from `/assets`.
- Browser end-to-end (Chromium/Playwright), with every request recorded:
  status badge, bundled fonts, demo analysis by the local model, Markdown
  export, save → page reload → reopen (with no new model call), custom CSV
  upload with out-of-order timestamps (sorted correctly), and **zero requests
  to any host other than 127.0.0.1**.
- **Offline test:** Ollama, the app and the browser ran inside a Linux network
  namespace with only a loopback interface (DNS and internet unreachable,
  confirmed). Every step passed: `npm run doctor -- --infer`, the full browser
  test, then a restart of Ollama and the app, reopening the saved run (same
  report), and a fresh local analysis.
- Error states in the browser: Ollama not running ("Could not connect to
  Ollama…" plus start instructions), model not downloaded ("…run
  `ollama pull llama3.2:3b`").
- Dev mode (`npm run dev`): listens on 127.0.0.1, the local analysis works, no
  external requests.

**Not verified**

- Windows: the PowerShell commands and the Windows Ollama app were not run.
- Browsers other than Chromium (Edge is Chromium-based; Firefox and Safari were not tested).
- GPU acceleration, very large CSVs (close to the 12 MB limit), and speed on your hardware.
- Real mine-site data, and judging whether the model's explanations are useful.

## 11. Files changed

### Safety thresholds update

Added: `src/config/safety-rules.json` (replaces `src/config/safety-rules.ts`),
`src/lib/safety/config.ts` (schema, validation, merge),
`src/lib/safety/units.ts`, `src/lib/safety/derived.ts` (Graham's and
Trickett ratios), `src/lib/safety/format.ts`, `docs/safety-sources.md`,
`docs/site-thresholds.md`, `scripts/make-sample-sensor-csv.mjs`, tests
`config` and `fixtures`.

Rewritten: `src/lib/safety/assess.ts` (three statuses, freshness, data
quality), `src/lib/safety/store.ts`, `src/components/safety-panel.tsx`
(import preview, rule table, freshness). Removed: `src/lib/safety/rules.ts`.

Changed: `src/lib/ai/prompts.ts` and `src/lib/ai/insights.ts` (new facts,
misattribution check), `src/lib/ai/analyst.ts`, `src/lib/dataset.ts` (shared
timestamp parser, units for `%vol`, `m/s`, `kPa`; unreadable text in a numeric
column is kept so it can be flagged), `src/lib/report.ts`,
`src/routes/index.tsx`, `src/components/charts.tsx`, `tsconfig.json`
(`resolveJsonModule`), tests `safety`, `ai-safety`, `analysis`,
`browser-client`.

### Mining safety update

Added: `src/lib/moving-average.ts`, `src/lib/safety/assess.ts`,
`src/lib/safety/rules.ts`, `src/lib/safety/store.ts`,
`src/config/safety-rules.ts`, `src/lib/ai/prompts.ts`,
`src/lib/local-api.server.ts`, `src/components/safety-panel.tsx`, and tests
`moving-average`, `safety`, `ai-safety`, `local-api`.

Changed: `src/components/charts.tsx` (1-hour MA), `src/lib/dataset.ts` (chart
order helper, MA and safety in the profile, safety in insights),
`src/lib/ai/insights.ts` (facts, schema, safety checks), `src/lib/ai/analyst.ts`
(mining prompt, retry on safety conflict), `src/lib/ai/client.browser.ts` (local
app first), `src/lib/ai/provider.ts`, `src/lib/report.ts`, `src/routes/index.tsx`,
`src/server.ts`, `scripts/start.mjs` (`--allow-origin`), `vite.config.ts`
(`cors: false`), `package.json`, tests `analysis` and `browser-client`.

### Earlier releases

Added:

- `src/lib/ai/provider.ts` — provider-neutral interface and error codes
- `src/lib/ai/config.server.ts` — environment configuration and validation
- `src/lib/ai/ollama.server.ts` — Ollama provider (chat, structured output, status, timeouts, cancel)
- `src/lib/ai/insights.ts` — input schema, facts sheet, severity rule, consistency checks
- `src/lib/ai/analyst.server.ts` — analysis flow (validate → prompt → check → retry/fallback)
- `src/lib/local-guard.ts` — Host-header check and body-size limit
- `src/lib/storage/runs.ts` — IndexedDB saved runs
- `src/lib/report.ts` — Markdown report export
- `src/components/saved-runs.tsx` — saved-runs panel
- `src/test/ollama-provider.test.ts`, `src/test/config-and-guard.test.ts`, `src/test/analysis.test.ts`
- `scripts/start.mjs`, `scripts/doctor.mjs`
- `.env.example`, `.gitignore`, `package-lock.json`

Changed:

- `src/lib/ai/analyze.functions.ts` — server functions now call the local analyst, plus a status endpoint
- `src/lib/dataset.ts` — sort rows by time, time range, max |z|, ppm and m³/s units, keep source CSV
- `src/routes/index.tsx` — local AI badge, analyst panel (cancel, re-run, export, explanations, disclaimer), saved runs
- `src/routes/__root.tsx` — removed Google Fonts and the Lovable error hook
- `src/styles.css` — local font imports
- `src/start.ts` — local guard middleware
- `src/test/setup.ts` — browser shims skipped in node-environment tests
- `vite.config.ts` — Node build target, loopback host, fixed port, `.env` loading
- `package.json`, `bun.lock` — removed `ai` and `@ai-sdk/openai`, added `@fontsource/*`, new scripts, `engines`

Removed:

- `src/lib/ai/gateway.server.ts`, `src/lib/ai/run-id.server.ts` (Lovable AI Gateway client)
- `src/lib/lovable-error-reporting.ts`
