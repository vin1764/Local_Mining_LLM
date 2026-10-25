// Checks that everything needed for offline use is in place.
// Usage: npm run doctor            (quick checks)
//        npm run doctor -- --infer (also runs a short test prompt on the model)
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (existsSync(".env")) process.loadEnvFile(".env");

const baseUrl = (
  process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
).replace(/\/+$/, "");
const model = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";
const infer = process.argv.includes("--infer");

let failed = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg, hint) => {
  failed++;
  console.log(`  FAIL  ${msg}`);
  if (hint) console.log(`        → ${hint}`);
};

console.log("STRATA offline readiness check\n");

const [major] = process.versions.node.split(".").map(Number);
if (major >= 22) pass(`Node.js ${process.versions.node}`);
else
  fail(
    `Node.js ${process.versions.node} is too old`,
    "Install Node.js 22 LTS or newer.",
  );

if (existsSync("node_modules")) pass("Dependencies installed");
else fail("Dependencies not installed", "Run `npm install` while online.");

if (existsSync(".output/server/index.mjs"))
  pass("Production build present (.output/)");
else
  console.log(
    "  INFO  No production build yet — `npm run build` (needed for `npm start`, not for `npm run dev`).",
  );

const host = new URL(baseUrl).hostname;
if (["127.0.0.1", "localhost", "::1", "[::1]"].includes(host))
  pass(`Ollama URL is local (${baseUrl})`);
else console.log(`  WARN  Ollama URL is not on this computer: ${baseUrl}`);

let version = null;
try {
  const res = await fetch(`${baseUrl}/api/version`, {
    signal: AbortSignal.timeout(4000),
  });
  version = (await res.json()).version;
  pass(`Ollama is running (version ${version})`);
} catch {
  fail(
    `Ollama is not reachable at ${baseUrl}`,
    "Start the Ollama app (or run `ollama serve`). Install from https://ollama.com/download.",
  );
}

if (version) {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    });
    const names = ((await res.json()).models || []).map((m) => m.name);
    const ok = names.some((n) => n === model || n === `${model}:latest`);
    if (ok) pass(`Model ${model} is downloaded`);
    else
      fail(
        `Model ${model} is not downloaded (installed: ${names.join(", ") || "none"})`,
        `Run \`ollama pull ${model}\` while online.`,
      );

    if (ok && infer) {
      const started = Date.now();
      const r = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(300_000),
        body: JSON.stringify({
          model,
          stream: false,
          format: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
          },
          messages: [
            {
              role: "user",
              content:
                "In one short sentence, what does a mine ventilation fan do?",
            },
          ],
        }),
      });
      const body = await r.json();
      const answer = JSON.parse(body.message.content).answer;
      pass(
        `Test inference OK in ${((Date.now() - started) / 1000).toFixed(1)} s — "${String(answer).slice(0, 100)}"`,
      );
    }
  } catch (e) {
    fail(`Model check failed: ${e instanceof Error ? e.message : e}`);
  }
}

console.log(
  failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);
