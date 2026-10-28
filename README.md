# Local LLM Mining

**STRATA** is a mine-data dashboard. Upload a CSV and get trends,
correlations, outliers and an AI shift report written by Qwen 2.5 1.5B running
on your own device. No cloud AI is used.

It comes in two editions:

- **Local app:** run it on your computer with Ollama. It works fully offline.
- **Web edition:** https://vin1764.github.io/Local_Mining_LLM/ (deployed by
  `.github/workflows/pages.yml`). Its AI uses the local app on your computer
  when you start it with `npm run start:with-pages`. Otherwise you can choose
  the in-browser model (about 1 GB download, Chrome or Edge with WebGPU).

Every analysis starts with a rule-based safety status (SAFE, CAUTION, UNSAFE or
INSUFFICIENT DATA). No safety thresholds are shipped: add your site's verified
limits first, or every analysis is INSUFFICIENT DATA. Charts show a 1-hour
moving average.

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
