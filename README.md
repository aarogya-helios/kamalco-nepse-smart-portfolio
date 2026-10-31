# AarogyaSoftware

A static portfolio dashboard with a Cloudflare Worker/D1 backend scaffold.

## Dashboard
- Add, edit and delete share holdings
- Portfolio investment and gain/loss calculations
- CSV import/export and local browser backup
- Cloud API integration for holdings, saved quotes and technical alerts

## Cloud integration status
The repository includes:
- `worker/index.js`: API, ShareHub adapter, scheduled quote/history sync, and basic technical alert engine
- `migrations/0001_portfolio.sql`: D1 tables for holdings, quotes, price history, alerts and settings
- `wrangler.toml`: Worker/static assets, D1 binding and Cron Trigger placeholders
- `CLOUDFLARE_SETUP.md`: required Cloudflare configuration and security checklist

**These integrations are not live merely because the code is in GitHub.** You must create the Cloudflare D1 database, configure its ID, configure Cloudflare Access and its JWT variables, deploy the Worker, and add licensed ShareHub credentials as Worker secrets. The ShareHub adapter has not yet been verified against a live licensed account.

## Deploy
Follow [CLOUDFLARE_SETUP.md](./CLOUDFLARE_SETUP.md). The app is not ready for public use with real portfolio data until Cloudflare Access is enabled and verified.

## Data and investment disclaimer
Technical flags are informational only. Initial indicators are RSI(14), SMA(20), SMA(50) and MACD line; no automatic trades are placed. Provider data, calculations and alert quality must be validated before investment decisions.

<!-- Cloudflare deployment sync: latest main includes the corrected weekday cron schedule in wrangler.toml. -->
