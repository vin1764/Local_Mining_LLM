# Local LLM Mining

**STRATA** is a mine-data dashboard. Upload a CSV and get trends,
correlations, outliers and an AI shift report written by Qwen 2.5 1.5B running
on your own device. No cloud AI is used.

It comes in two editions:

- **Web edition:** open the GitHub Pages link. The AI model runs inside your
  browser (Chrome or Edge with WebGPU); you approve a one-time download of about
  1 GB first. Deployed by `.github/workflows/pages.yml`.
- **Local app:** run it on your computer with Ollama. It works fully offline.

The app is in [`Mine Safety Monitoring/`](./Mine%20Safety%20Monitoring). See its
[README](./Mine%20Safety%20Monitoring/README.md) for setup (Windows PowerShell
first), configuration, changing the model, and test results.

Quick start:

```powershell
ollama pull qwen2.5:1.5b
cd "Mine Safety Monitoring"
npm ci
npm run build
npm start        # then open http://127.0.0.1:8080
```
