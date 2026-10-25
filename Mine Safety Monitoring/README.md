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
| Where the AI runs | Ollama on your computer | Inside the visitor's browser (WebLLM + WebGPU) |
| Model | `qwen2.5:1.5b` via Ollama | Qwen 2.5 1.5B Instruct (MLC build) |
| Install needed | Node.js + Ollama | None, just open the link |
| Works offline | Yes, after setup | The model works offline once downloaded; the page itself needs a connection to open |
| Browser support | Any modern browser | Recent Chrome or Edge on a desktop/laptop with a GPU |
| First run | `ollama pull` (~1 GB) | One-time model download (~1 GB) after the visitor clicks **Download** |

Both editions use the same dashboard, statistics, findings, severity rule and
consistency checks (`src/lib/ai/analyst.ts`). Only the place the model runs differs.

### Web edition (GitHub Pages)

- **Build locally:** `npm run build:pages` writes a static site to `dist-pages/`.
  Preview it with `npm run preview:pages` (http://127.0.0.1:8081).
- **Deploy:** `.github/workflows/pages.yml` builds and publishes the site on
  every push to `main`. One-time setup: in the GitHub repo, open
  **Settings → Pages** and set **Source** to **GitHub Actions**.
- **Model download:** nothing large downloads until the visitor clicks
  **DOWNLOAD MODEL & RUN ANALYSIS**. The model comes from WebLLM's model hosts
  (Hugging Face and the `mlc-ai` GitHub repos) and is cached in that browser.
  The CSV and the statistics never leave the device.
- **GPUs without 16-bit shader support** automatically get the `q4f32` build of
  the same model (a little larger).
- **Changing the model:** set `VITE_WEBLLM_MODEL` to any id from WebLLM's
  prebuilt list when building, for example
  `VITE_WEBLLM_MODEL=Qwen2.5-3B-Instruct-q4f16_1-MLC npm run build:pages`.
- **Saved runs** are stored in the visitor's browser for the site's address.

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

3. Open **<http://127.0.0.1:8080>** in your browser.
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

No safety thresholds are configured in this app, and the model is told not to
invent any. The report is a statistical read of the uploaded file, not a
certified safety determination.

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
- **No safety thresholds:** severities are statistical only. Adding verified
  site limits would need a configuration file and code changes.
- **Saved runs are per browser and address** (IndexedDB), not a shared database.
- **Lint:** `npm run lint` reported ~790 Prettier formatting errors in the original
  code before this migration. New files are formatted; old files were left as they
  were, to keep the diff readable.
- **Not tested on Windows:** see the test results below.

## 10. Test results

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
