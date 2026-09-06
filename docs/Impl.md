# Implementation Plan: Vice Is Nice Investment SPA

## Goal
A static single-page application (vanilla JS, no frameworks) that:
1. Constructs a portfolio of exactly 15 stocks from a hard-coded universe (>=30 stocks), selected via technical criteria, and persists the choice in the browser.
2. Optimizes the weights of those 15 stocks using the Markowitz model, computed in the frontend from the latest available data.

Data source: Twelve Data REST API (`https://api.twelvedata.com`), authenticated with a user-supplied API key.

## Source documents
- `Implementation.md` — high-level requirements (SPA, vanilla JS, two tabs, API key settings, 15 stocks, Markowitz).
- `FunctionalRequirements.md` — strategy context (morally controversial sectors), exchanges (NYSE, LSE, Euronext), technical signals, example tickers.
- `AGENTS.md` — git constraints (no `git add`/`commit`/`reset`/`checkout`).

## Key technical decisions (resolved from the docs + API research)

### Data fetching strategy
Use the `time_series` endpoint with `interval=1day` and `outputsize` large enough to compute all four screening metrics locally from one fetch per stock. This keeps us on the Basic/free tier (1 credit/symbol) and avoids premium endpoints (`statistics`, `profile`, etc.).

For each stock we need, from daily closes:
- RSI(14) — latest value, must be < 70 (not overbought).
- 50-day SMA and 200-day SMA — 50d > 200d (upward momentum).
- 30-day annualized volatility (std of daily log returns over last 30 bars * sqrt(252)) — must be < 20%.
- 30-day average volume (mean of last 30 daily `volume` values) — must be > 1,000,000 shares.

Required daily history depth: 200 trading days for the 200-day SMA, plus 14 for RSI warmup is already inside the 200 window. Fetch `outputsize=250` (about 1 year) to be safe and cheap. One request per stock.

For Markowitz optimization we need a price-history matrix for the 15 chosen stocks. Reuse the same daily time series (fetch ~1 year, e.g. 252 bars) to compute the covariance matrix of log returns. No extra endpoints needed.

### Symbol format for non-US exchanges
Twelve Data uses exchange suffixes for disambiguation:
- NYSE/NASDAQ US stocks: plain ticker, e.g. `LMT`, `PM`, `XOM`.
- LSE: `.L` suffix, e.g. `SHEL.L`.
- Euronext Paris: `.PA` suffix, e.g. `HO.PA`, `BN.PA`, `TTE.PA`.
The hard-coded universe will store each stock with its full Twelve Data symbol string and a display name, so no exchange mapping logic is needed at runtime.

### Equity universe (hard-coded, >=30 stocks, morally controversial sectors)
Build a JS array of `{symbol, name, sector}` covering defence, tobacco, alcohol, gambling, oil, agrifood/petrochemical across NYSE/NASDAQ/LSE/Euronext. Use the examples from `FunctionalRequirements.md` plus additional well-known names to reach at least 30. Example sectors and tickers (final list to be finalized during implementation, all must be validated against Twelve Data coverage):

- Defence: LMT, RTX, NOC, GD (US), HO.PA (Thales, Euronext), BAE.L (BAE Systems, LSE)
- Tobacco: PM, BTI (US ADRs), IMB.L (Imperial Brands, LSE)
- Alcohol: BUD, DEO, STZ, TAP (US), HEIA.AS (Heineken, Euronext Amsterdam)
- Gambling: MGM, LVS, WYNN, CZR (US)
- Oil: XOM, CVX, COP (US), SHEL.L (Shell, LSE), TTE.PA (TotalEnergies, Euronext)
- Agrifood/petrochemical: ADM, BG (US), BN.PA (Danone, Euronext), LYB (US)

Total ~30. Each entry hard-coded in `js/universe.js`.

### Markowitz optimization
- Inputs: matrix of daily log returns for the 15 selected stocks over the fetched window (e.g. last 252 trading days).
- Compute annualized mean-return vector `mu` (252 * mean daily log return) and annualized covariance matrix `Sigma` (252 * covariance of daily log returns).
- Objective: minimize portfolio variance `wᵀ Σ w` subject to `Σw = 1`, `w >= 0` (long-only), and a target return constraint `μᵀw = target` (user-adjustable; default = mean of `mu`).
- Solver: implement a simple quadratic programming routine in vanilla JS. Options:
  1. Analytical solution for the unconstrained minimum-variance portfolio with the equality constraints (Lagrange multipliers) — fast and exact, but may produce negative weights.
  2. If negative weights appear, fall back to a projected-gradient-descent / iterative numerical solver with `w >= 0` and `Σw = 1` projection.
- Also compute the efficient frontier (sweep target returns) and display it as a small chart (canvas) so the user can pick a point. Default to the minimum-variance portfolio.
- Output: weights per stock, expected return, volatility, Sharpe ratio (using a risk-free rate input, default 0).

### Persistence
- API key: `localStorage` key `vin_apikey`.
- Selected 15 stocks: `localStorage` key `vin_portfolio` (array of symbols). Loaded on startup so the construction tab shows the saved selection.
- Last optimization inputs/outputs optionally cached: `localStorage` key `vin_optimization` (weights + stats + timestamp), so the optimization tab shows stale results while refetching.

### UI layout (single `index.html`)
```
┌─────────────────────────────────────────────┐
│ Settings bar (top, shared)                  │
│  API key input [________]  [Save]  [Test]   │
│  Status: ✓ valid / ✗ error message          │
├─────────────────────────────────────────────┤
│ Tabs: [Portfolio Construction] [Optimization]│
├─────────────────────────────────────────────┤
│ Tab content (swapped by JS)                 │
└─────────────────────────────────────────────┘
```

**Tab 1 — Portfolio Construction**
- Button "Screen universe" → fetches time_series for all universe stocks (with a small concurrency limit, e.g. 5 in flight), shows progress.
- Results table: symbol, name, sector, RSI, 50d MA, 200d MA, 30d vol %, 30d avg volume, and a pass/fail chip per criterion, plus an overall "eligible" flag.
- Sort by priority order of criteria (RSI pass > momentum pass > volatility pass > liquidity pass), then by volatility ascending.
- User selects exactly 15 (checkboxes; enforce count; pre-check the top 15 eligible by default).
- "Save portfolio" button → writes to `localStorage`.
- Shows currently saved portfolio above/below the table.

**Tab 2 — Portfolio Optimization**
- Reads the 15 saved stocks (disabled if fewer than 15 saved, with a hint to go to Tab 1).
- Inputs: target return slider (range from min to max of `mu`), risk-free rate input, "Fetch data & optimize" button.
- On optimize: fetch daily time series for the 15 stocks, compute `mu`/`Sigma`, solve QP for the chosen target, render:
  - Weights table (symbol, weight %, contribution to return/vol).
  - Portfolio stats: expected return, volatility, Sharpe.
  - Efficient frontier canvas chart with the current portfolio marked.
- "Save weights" optional (cache to `localStorage`).

### File structure (all static, no build step)
```
index.html
css/style.css
js/
  app.js          # bootstrap, tab switching, settings bar, glue
  api.js          # Twelve Data fetch helpers, rate limiting, error handling
  universe.js     # hard-coded stock universe array
  indicators.js   # RSI, SMA, volatility, volume helpers (pure functions)
  screening.js    # apply criteria to a stock's series, produce pass/fail + sort
  markowitz.js    # mu/Sigma, QP solver, efficient frontier
  storage.js      # localStorage get/set helpers
  ui.js           # DOM rendering helpers for both tabs
```
No external libraries. Canvas used for the efficient-frontier chart (hand-drawn). All fetches via `fetch()`.

### Error / rate-limit handling
- Twelve Data returns `{code, message, status:"error"}` on failure. `api.js` checks `status` and surfaces messages.
- Free tier has rate limits (e.g. 8 req/min on the free plan). Implement a simple token-bucket / sequential-with-delay queue in `api.js` (configurable requests-per-minute; default conservative). Show a progress indicator and retry on 429 with backoff.
- Handle `null` values in time series (defensive: skip nulls, require at least 200 valid bars; mark stock as ineligible if insufficient data).

## Step-by-step implementation plan

1. **Scaffold** — create `index.html`, `css/style.css`, and the `js/` files with stubs. Wire up the settings bar (API key input + save to localStorage + a "Test" button that calls `/price?symbol=AAPL` to validate). Implement tab switching.

2. **`js/universe.js`** — define the >=30-stock universe array with `{symbol, name, sector}`. Add a comment noting each symbol's exchange suffix convention.

3. **`js/api.js`** — implement `fetchTimeSeries(symbol, outputsize)` returning parsed `values` (array of `{datetime, open, high, low, close, volume}`), with rate-limiting queue and error handling. Add `testApiKey()`.

4. **`js/indicators.js`** — pure functions: `sma(closes, period)`, `rsi(closes, period=14)`, `annualizedVolatility(closes, window=30)`, `avgVolume(volumes, window=30)`. Unit-testable in isolation.

5. **`js/screening.js`** — `screenStock(symbol, series)` returns `{symbol, name, sector, rsi, ma50, ma200, vol30, avgVol30, passes: {rsi, momentum, vol, liquidity}, eligible, score}`. `screenUniverse(apiKey, onProgress)` iterates the universe with the rate limiter and returns sorted results.

6. **Tab 1 UI** — render the screening table, checkboxes (enforce exactly 15), "Screen" and "Save portfolio" buttons, saved-portfolio display. Wire to `storage.js`.

7. **`js/markowitz.js`** — `computeReturns(priceMatrix)`, `annualize(mu, Sigma)`, `minVariancePortfolio(mu, Sigma, targetReturn)` (analytical + long-only fallback), `efficientFrontier(mu, Sigma, nPoints)`, `portfolioStats(weights, mu, Sigma, rf)`.

8. **Tab 2 UI** — fetch data for the 15 saved stocks, compute `mu`/`Sigma`, render target-return slider + risk-free rate input, optimize button, weights table, stats, and the efficient-frontier canvas chart.

9. **`js/storage.js`** — small helpers for `get/set/remove` with JSON and a versioned schema (`{v:1, ...}`).

10. **Polish & verify** — manual end-to-end check: enter a demo API key, screen the universe, select 15, save, switch to optimization, fetch, optimize, view weights + frontier. Confirm persistence across reloads. Confirm error states (bad key, rate limit, insufficient data for a stock).

## Verification (how we know it works)
- Settings bar accepts and persists an API key; "Test" shows success/failure.
- Tab 1 screens the universe, shows per-criterion pass/fail, enforces exactly 15 selections, saves to localStorage, restores on reload.
- Tab 2 loads the saved 15, fetches data, computes and displays weights summing to 100%, portfolio stats, and an efficient frontier chart.
- All calculations run client-side; the only network calls are to `api.twelvedata.com`.
- No build step: opening `index.html` directly in a browser works (or via a simple static server if CORS/local-file restrictions require it — note this to the user).

## Open questions / assumptions
- **Twelve Data plan tier**: assumed Basic/free. If the user has a paid plan, the `statistics` endpoint could replace local indicator computation, but the plan above does not depend on it.
- **Long-only constraint**: assumed (no shorting). If shorting is allowed, the analytical solver suffices and the fallback is unnecessary.
- **Risk-free rate**: default 0; user-editable.
- **Target return**: default = minimum-variance portfolio's return (no target constraint); user can drag the slider to impose a target.
- **Universe tickers**: must be validated against Twelve Data coverage during implementation; any unsupported symbol will be flagged in the screening table as "no data".
