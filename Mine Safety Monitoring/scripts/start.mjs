// Start the built app (frontend + local backend in one Node process).
// Usage: npm start   (run `npm run build` first)
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

if (existsSync(".env")) process.loadEnvFile(".env");

// Loopback by default so nothing outside this computer can reach the app.
const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || "8080";
process.env.NITRO_HOST = host;
process.env.NITRO_PORT = port;

const entry = path.join(root, ".output", "server", "index.mjs");
if (!existsSync(entry)) {
  console.error(
    "No production build found. Run `npm run build` first, then `npm start`.",
  );
  process.exit(1);
}

console.log(
  `STRATA starting on http://${host.includes(":") ? `[${host}]` : host}:${port}`,
);
console.log(
  `Local AI: ${process.env.OLLAMA_MODEL || "qwen2.5:1.5b"} via ${process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"}`,
);
await import(pathToFileURL(entry).href);
