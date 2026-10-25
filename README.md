# Local LLM Mining

**STRATA** is an offline mine-data dashboard. Upload a CSV and get trends,
correlations, outliers and an AI shift report written by a local model
(Qwen 2.5 1.5B via Ollama). After setup, no internet or cloud service is needed.

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
