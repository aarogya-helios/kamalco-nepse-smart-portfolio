# Cloudflare deployment and integration checklist

The repository contains the dashboard, a Worker API, a D1 schema, scheduled market refresh and a first-pass technical-alert engine. These files are implementation work only; they are not live until the Cloudflare resources below are created and configured.

## 1. Create and configure D1
1. In Cloudflare Dashboard, open **Workers & Pages → D1 SQL Database → Create**.
2. Name the database `kamalco-nepse` and copy its database ID.
3. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.toml`.
4. Apply the migration from the repository: `npx wrangler d1 migrations apply kamalco-nepse --remote`.

## 2. Protect the app with Cloudflare Access before adding private data
The Worker verifies the Cloudflare Access JWT on every `/api/*` request. Create an Access self-hosted application for the exact app hostname and restrict it to your own email/identity. Set these Worker variables in `wrangler.toml`:
- `ACCESS_TEAM_DOMAIN`: your team domain, e.g. `your-team.cloudflareaccess.com` (without https://)
- `ACCESS_AUD`: the Access application's AUD tag
- `APP_ORIGIN`: your exact deployed HTTPS origin

Do not make the API public. If Access is not configured, API requests are intentionally rejected.

## 3. NEPSE market data provider
The adapter is written against ShareHub Nepal's documented API shape. It has not been verified with a licensed account. Contact ShareHub for a Data API licence covering live stock prices and historical OHLCV. Confirm the API's current authentication, endpoint schema, rate limits and a supported outbound IP allow-list solution for Cloudflare Workers before relying on it.

Add credentials only as Worker secrets, never to GitHub or browser JavaScript:
`npx wrangler secret put SHAREHUB_EMAIL`
`npx wrangler secret put SHAREHUB_PASSWORD`

Provider docs: https://sharehubnepal.com/data/nepse-data-documentation/

## 4. Deploy
Use Wrangler from a trusted local development environment:
`npx wrangler deploy`
Then verify `/api/health`, holdings save/load, market refresh and alert history while signed in through Cloudflare Access.

The Cron Trigger in `wrangler.toml` schedules quote sync during the Nepal market-day window. Historical OHLCV and indicator checks are scheduled once per Nepal day after market close. Cron is polling, not a guaranteed instant alert delivery channel.

## 5. Current technical alerts and limitations
The initial engine calculates RSI(14), SMA(20), SMA(50), and MACD line from daily closes. It creates informational watch/caution alerts, deduplicated for 24 hours. It does not place trades and does not yet include volume confirmation, support/resistance, WACC-based portfolio risk, push/email notifications, or user acknowledgement workflows. Validate calculations and provider response fields against real data before making investment decisions.

## Security and production caveats
- Do not use real portfolio data until Cloudflare Access is enabled and tested.
- The frontend retains a local browser backup for offline continuity; cloud holdings are loaded from D1 when API access is available.
- No Cloudflare database, Worker deployment, provider licence or API secret has been created by this repository commit.
- ShareHub provider API integration is unverified until tested with a valid licensed account.
