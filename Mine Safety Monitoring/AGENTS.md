# Notes for coding agents

This app is **offline-first**. Keep it that way:

- AI analysis goes through `src/lib/ai/analyst.server.ts` → `LocalInferenceProvider`
  (Ollama on loopback). Do not add cloud AI SDKs, gateways or API keys, and never
  add a silent cloud fallback.
- Do not load fonts, scripts, styles or images from a CDN. Bundle them (see the
  `@fontsource/*` imports in `src/styles.css`).
- The model must only explain statistics computed in `src/lib/dataset.ts`.
  Finding facts and severities are written by code (`src/lib/ai/insights.ts`).
- Servers bind to `127.0.0.1` (see `vite.config.ts` and `scripts/start.mjs`).
- Saved runs live in IndexedDB (`src/lib/storage/runs.ts`). Nothing is sent to a server.
- Run `npm test` and `npm run build` after changes. See README.md for setup.
- Safety status comes only from `assessSafety()` (`src/lib/safety/assess.ts`)
  and is only ever SAFE, CAUTION or UNSAFE. Never let model output set or change it.
- Thresholds live in `src/config/safety-rules.json` (validated by
  `src/lib/safety/config.ts`). Never add or enable a number without checking it
  against the original document; record the clause and verification in
  `source`, and add the evidence to `docs/safety-sources.md`. Unverified values
  stay `null` with `requires_verification`. Provisional rules stay disabled.
- A missing reading or an empty rule set must never produce SAFE. Tests in
  `src/test/safety.test.ts` and `src/test/config.test.ts` guard this.
- The AI system prompt lives in `src/lib/ai/prompts.ts`.
- The local AI API (`src/lib/local-api.server.ts`) must keep its exact-origin
  CORS allowlist; never use `*`.
