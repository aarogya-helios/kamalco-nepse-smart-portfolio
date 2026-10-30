# Kamalco NEPSE Smart Portfolio

A lightweight static portfolio dashboard. Plain HTML, CSS and JavaScript; no npm install or build step is required.

## Current features
- Add, edit and delete holdings
- Calculate investment, current value and unrealized gain/loss from quantity, WACC and manually entered LTP
- Search holdings
- Import/export holdings as CSV
- Save data in this browser using localStorage

## Deploy to Cloudflare Pages
1. Open Workers & Pages and choose Create application.
2. Choose Pages and Connect to Git.
3. Select aarogya-helios/kamalco-nepse-smart-portfolio.
4. Framework preset: None.
5. Build command: leave blank.
6. Build output directory: / (repository root).
7. Deploy.

No API keys or secrets are required for this starter.

## Important limitations
- No verified NEPSE live market-data provider is connected.
- LTP values are manually entered; no live price or technical signal is claimed.
- Browser localStorage is not cloud backup or multi-device sync.
- Cloudflare D1, authentication, scheduled alerts and verified OHLCV-based technical indicators are future integration steps.
- No automatic buy/sell orders are placed.

CSV columns: symbol,quantity,wacc,ltp.
