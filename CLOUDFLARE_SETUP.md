# Cloudflare backend setup

This repository now includes a Worker API, a D1 schema, scheduled market refresh and a basic technical-alert engine.

## Required Cloudflare resources
1. Create a D1 database named kamalco-nepse.
2. Copy its database ID into wrangler.toml.
3. Apply migrations: `npx wrangler d1 migrations apply kamalco-nepse --remote`.
4. Deploy the Worker with Static Assets using Wrangler.
5. Set secrets: `npx wrangler secret put SHAREHUB_EMAIL` and `npx wrangler secret put SHAREHUB_PASSWORD`.

## Market data provider
The adapter is written for ShareHub's NEPSE Data API. It requires an active API licence/account and server IP allow-listing. The provider documents live stock prices and daily OHLCV history; live data refreshes about every 20 seconds during market hours and every 5 minutes while closed. API credentials must remain Worker secrets and must never be placed in browser JavaScript.

Provider documentation: https://sharehubnepal.com/data/nepse-data-documentation/

## API routes
- GET /api/health
- GET /api/holdings
- PUT /api/holdings
- GET /api/market
- GET /api/alerts
- POST /api/refresh

## Technical alerts
The first pass calculates RSI(14), SMA(20), SMA(50) and a MACD line from daily closes. Alerts are informational watch/caution flags only; they are not guaranteed sell signals or investment advice. They are deduplicated per symbol/type for 24 hours. Volume confirmation, support/resistance, WACC-based position risk, user notification delivery and authenticated sessions remain to be implemented before public production use.

## Important security note
The current starter UI is a local-first prototype. Do not expose write API routes publicly until authentication and per-user authorization are enabled. Configure Cloudflare Access or add a proper authenticated session layer before using real personal portfolio data.

## Before enabling production access
- The provider account is not included. Contact ShareHub Nepal for a Data API licence with stock-prices and price-history services. Their documentation says API calls require an allow-listed server IP. Cloudflare Workers do not provide a normal fixed outbound IP on the standard Free/Paid plans; confirm an approved egress/allow-list solution with ShareHub before expecting live sync to work.
- Do not paste API passwords or tokens into GitHub or ChatGPT. Add them only as Cloudflare Worker secrets.
- Protect the whole application hostname with Cloudflare Access before putting real portfolio holdings in D1. The prototype API does not yet implement per-user authentication/authorization; do not expose it publicly with personal data.
- The Cron Trigger is a scheduled polling mechanism, not a guaranteed real-time alert channel. Provider rate limits and market hours apply.
