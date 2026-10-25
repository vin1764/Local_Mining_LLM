// Static build for GitHub Pages: `npm run build:pages` → dist-pages/
// Same dashboard as the local app, but the AI analyst runs in the visitor's
// browser (WebLLM + WebGPU) instead of calling Ollama through the Node server.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(root, "pages"),
  publicDir: path.join(root, "public"),
  // Relative asset paths work at https://<user>.github.io/<repo>/
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // Swap the server (Ollama) client for the in-browser one.
      {
        find: /^@\/lib\/ai\/client$/,
        replacement: path.join(root, "src/lib/ai/client.browser.ts"),
      },
      { find: /^@\//, replacement: `${path.join(root, "src")}/` },
    ],
  },
  worker: { format: "es" },
  build: {
    outDir: path.join(root, "dist-pages"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
  },
});
