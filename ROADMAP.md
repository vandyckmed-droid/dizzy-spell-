# Roadmap

Personal iPhone tool to **rank, select, and weight** stocks, with a **macro markets** dashboard.
Effort tags: 🟢 small · 🟡 medium · 🔴 large.  ⚙️ = needs a standalone EAS build (not Expo Go).

---

## ✅ Shipped

### Data & universe
- 🟡 **US Top 600** — `fetch_data.py` pulls ~2,100 candidates (≥ $2B) on NYSE/Nasdaq/AMEX and keeps
  the largest 600 eligible common stocks & ADRs; excludes ETFs/funds/non-common/SPACs/bad data;
  share classes deduped by issuer CIK (most liquid). 800 trading days of split+dividend-adjusted closes.
- 🟢 Per-sector sub-universes as tags (horizontal pill selector).
- 🟡 **Build-time data layer** — the FMP key is read only at build time (`$API_KEY`); it never ships
  in the artifact, the app, or the Snack. Refreshed on request; pull-to-refresh pulls the latest from
  the public repo (`main`).
- 🟡 **Macro intraday layer** (`fetch_intraday.py`) — 5-min bars + daily OHLC for SPY/TLT/XLE/GLD,
  merged into the snapshot; refreshable on its own.

### Screener & ranking
- 🟡 **Configurable score** — return window (as-of / start / end), rank by **Return / Volatility /
  Sharpe**, optional separate volatility window.
- 🟢 **Default 12–1 window = 250 → 20** (rounded; absorbs EOD lag) with a one-tap **↺ 12–1 reset** chip.
- 🟡 **Second return window** (default **6–1**) — **Blend** the two into one score, or show them
  **Separate** side-by-side. Dynamic month labels (e.g. 12–1 / 6–1).
- 🟡 **Residual momentum** — OLS α, β over the trailing 756 days vs a fixed ETF (VTI); true residuals
  `e = r − α − β·m` over the chosen window; short-history names marked n/a.
- 🟡 **Correlation-to-basket cue** — as you scroll, redundant names (high ρ vs a held name) fade and
  show their nearest twin; diversifiers (low ρ) get a teal dot & add button. Thresholds are
  **user-configurable** (default: diversify < 0.45, redundant ≥ 0.60) via the cue sheet.
- 🟢 Sort & filter (market-cap band, exchange); one-tap selection persisted **by date**
  (survives snapshot rebuilds).

### Portfolio & weighting
- 🟡 Long-only **HRP** (stabilized corr → √((1−ρ)/2) → average linkage → quasi-diagonalization →
  recursive inverse-variance, latest 252d).
- 🟡 Per-stock / per-sector **caps** redistributed to exactly 100%, with correct **joint feasibility**
  (stock + sector caps checked together) and guidance when infeasible.
- 🟢 Sector allocation bar; **Clear basket**.

### Ticker detail
- 🟢 Company logo, sector tag (tappable → that sector's universe).
- 🟢 Interactive scrub chart with the **ranking window shaded** (dated), performance card
  (5d/10d/1m/3m/6m/1y), per-name β and annualized α.
- 🟡 **Top-3 correlated peers** (latest 252d), tappable.

### Markets (macro dashboard)
- 🟡 **Markets tab** — 2×2 tiles (last · day change · session sparkline) for SPY / TLT / XLE / GLD.
- 🟡 **Rich chart** — timeframe **1D (5-min) · 6M · 1Y**, chart type **Line / OHLC bars**, crosshair
  scrub, prev-close reference on 1D.
- 🟢 **Configurable EMAs** — EMA-50 / EMA-200 on the daily views (on/off + adjustable period).
- 🟢 **Golden / death cross effect** — regime ribbon (green fast>slow, red fast<slow) + diamond
  markers at each crossover; toggleable.

### Design & reliability
- 🟡 Robinhood-inspired dark theme (near-black, vivid green/red, tabular numerals, soft geometry).
- 🟢 Static HTML artifact twin shares the validated engine.
- 🟡 Numerics cross-checked vs a NumPy reference — `validate_js.mjs` (991) + `verify_edge.mjs` (1147).
- 🟢 Headless react-native-web render harness (Screener / Portfolio / Markets / detail, zero errors).

---

## ⬜ Candidate — next

### Ranking
- 🟢 Risk-free rate input (true Sharpe numerator)
- 🟡 Sector-relative ranking (rank within sector)
- 🟡 Weighted blend (adjustable A/B weight instead of 50/50); value / quality as a third input

### Weighting & risk
- 🟡 Compare weighting schemes (HRP vs equal / inverse-vol / min-variance)
- 🟡 Portfolio backtest line (weighted-basket cumulative return, vol, max drawdown)
- 🟡 Correlation heatmap + diversification stats (effective number of bets)
- 🟢 More constraints (max holdings, min weight, per-sector minimums)

### Macro
- 🟡 More symbols (DXY/UUP dollar, HYG credit, USO oil, BTC)
- 🟢 Multi-range / benchmark compare on the chart

### Workflow & data
- 🟡 Named portfolios + watchlist; export weights (CSV / card)
- 🟡 Scheduled auto-refresh (GitHub Action on a cron, FMP key as a repo secret)
- 🟡 Fundamentals (P/E, margins, growth) as filters/columns; custom / larger universes
- 🔴 ⚙️ Standalone EAS build — home-screen icon, widgets, push (rebalance alerts)

---

## Notes
- Intraday is a **build-time** layer (the app is key-free) — refreshed by re-running
  `fetch_data.py` + `fetch_intraday.py`. Intraday isn't baked for all 600 (size).
- The HTML artifact twin keeps the pre-Robinhood theme; the app is the primary surface.
