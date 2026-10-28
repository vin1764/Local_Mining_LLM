// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { existsSync } from "node:fs";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Load .env into process.env so the dev server's server functions see
// OLLAMA_* settings (Vite itself only exposes VITE_* variables).
if (existsSync(".env")) process.loadEnvFile(".env");

const host = process.env["HOST"] || "127.0.0.1";
const port = Number(process.env["PORT"] || 8080);

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Build a plain Node.js server (instead of the Cloudflare default) so the
  // app runs on this computer with `npm start`.
  nitro: { preset: "node-server" },
  vite: {
    // Listen on loopback only: the app is not reachable from other machines.
    // cors: false — Vite's built-in CORS must not answer for the app; the
    // local AI API applies its own strict allowlist (CORS_ALLOWED_ORIGINS).
    server: { host, port, strictPort: true, cors: false },
    preview: { host, port, strictPort: true },
  },
});
