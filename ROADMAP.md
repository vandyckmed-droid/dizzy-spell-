# Roadmap

Running list of features — shipped and candidate. Effort tags: 🟢 small · 🟡 medium · 🔴 large.
⚙️ = needs a standalone EAS build (won't run in Expo Go / Snack).

Status: ✅ done · 🚧 in progress · ⬜ planned/candidate.

---

## ✅ Shipped

### Foundation (v1)
- ✅ 🟢 iPhone-first app: Screener · Portfolio · Ticker Detail, vertical, no horizontal tables
- ✅ 🟡 Build-time data layer (FMP *stable* API); key read only at build time, never shipped
- ✅ 🟡 Sharpe-momentum ranking — user window (default 252→21), sample σ, rf=0, ×252
- ✅ 🟡 Long-only HRP weighting (stabilized corr → √((1−ρ)/2) → average linkage → quasi-diag → recursive IVP)
- ✅ 🟡 Per-stock / per-sector caps, redistributed to exactly 100% with infeasibility guidance
- ✅ 🟢 One-tap selection, persisted locally
- ✅ 🟢 Ticker detail performance card (5d/10d/1m/3m/6m/1y, green/red)
- ✅ 🟡 Numerics cross-checked vs NumPy reference (142) + edge/perf suite (1058)
- ✅ 🟢 Static HTML artifact twin (shares the validated engine)
- ✅ 🟡 Delivery as an Expo Snack link (auto-updating via public raw, or `--inline` frozen)

### Universe (v1.1)
- ✅ 🟡 **US Top 500** build — ~2,100 candidates → largest 500 eligible; ADRs/foreign allowed;
  excludes ETFs/funds/non-common/SPACs/bad data; share-class dedup by CIK (most liquid)
- ✅ 🟢 Per-sector sub-universes as tags + horizontal pill selector

### V2 batch
- ✅ 🟢 **Interactive price chart** in detail — touch & drag to scrub, ranking window shaded,
  live price/date/return readout, crosshair, haptic ticks
- ✅ 🟢 **Pull-to-refresh** (pulls latest snapshot from public raw), **skeleton loader** on launch,
  **richer haptics & animations** (select-button pop, animated weight bars, tab/list fades)
- ✅ 🟢 **Sort & filter the screener** — filter by market-cap band and exchange

### V3 batch — configurable score
- ✅ 🟡 **Configurable ranking score** (replaced the earlier factor popup, which was reverted):
  - Set the **return window** (as-of / start / end offsets) — unchanged from before.
  - Rank by **Return**, **Volatility**, or **Sharpe** (return ÷ σ) — division by σ is optional.
  - Separate **volatility window** with a *Match return window* toggle (default on).
  - **Remove market influence** — residualizes both the return and the volatility against a
    cap-weighted Top-500 market (β removed).
  - Annualized throughout (mean·252, σ·√252). Default = 12–1 return ÷ 12–1 vol = the original
    Sharpe momentum (verified identical). All configs validated vs NumPy (631 checks).
- ❌ Reverted: the fixed 12–1 / 6–1 / residual "factor" popup (superseded by the configurable score)
- ❌ Declined: composite multi-factor blend, Sortino, trend-vs-200d

### V5 — Robinhood-inspired visual redesign
- ✅ 🟡 Near-black surfaces (#000 ground), crisp white type, vivid green (#00C805) / red (#FF5000)
- ✅ 🟢 Borderless cards & controls (separation via surface lift + hairline dividers), generous spacing, softer/larger radii
- ✅ 🟢 Screener as clean list rows with dividers; green-tinted selected rows
- ✅ 🟢 Bold **tabular numerals** throughout; green pills/segments/switches; RH-orange "Clear basket"
- ✅ 🟢 Dark-friendly categorical sector palette (distinct from semantic green/red)
- (HTML artifact twin keeps the prior theme for now — app-only redesign)

### V4 — research-standard residual momentum (external review)
- ✅ 🟡 **Fixed ETF market proxy (VTI)** — replaces the cap-weighted-current-constituents proxy;
  no membership/weight bias, no self-inclusion. Stored in the snapshot as a daily-return series.
- ✅ 🟡 **756-day (36-month) OLS β + intercept**, estimated separately from the momentum signal
  window (was: β from the same short window — the review's main finding).
- ✅ 🟢 True regression residuals **e = r − α − β·m** over the user's selected return/vol windows.
- ✅ 🟢 **Cumulative residual** computed from the residual series (fixes the bug where a raw
  cumulative return was shown with an α label).
- ✅ 🟢 Short-history names **marked n/a** in residual mode (count shown), not silently computed;
  history extended 520→800 trading days (~1.8→2.7 MB) so the 756-day window fits.
- ✅ 🟢 Detail shows **β and annualized α (vs VTI, 756d OLS)** per name.
- All 7 scoring configs cross-checked against the NumPy reference (**991 checks**).

### V3.1 polish
- ✅ 🟢 Count line shows selections **within the current ranked list** ("N selected here")
- ✅ 🟢 **Clear basket** button (with confirm) on the Portfolio view
- ✅ 🟢 Ticker detail rebalanced — taller price chart, more compact performance card
- ✅ 🟡 **Most-correlated peers** on the ticker detail — top 3 by daily-return correlation
  (latest 252d), tappable to navigate (e.g. NVDA → TSM/AVGO/VRT, JPM → BAC/WFC/C)
- ✅ 🟢 Performance card inset to match the other detail cards
- ✅ 🟢 **Company logo** in the ticker-detail header (FMP public image CDN; initials fallback)
- ✅ 🟢 **Tappable sector tag** — jumps to that sector's universe on the Screener
- ⬜ 🟡 Tappable **industry** tag → industry-filtered list (needs a new industry filter)
- ⬜ 🟢 Logos in the rank list rows (lazy-loaded) — optional follow-up
- ⬜ 🟡 Ticker-detail tabs — split into sub-tabs as more per-name info is added (deferred until the view grows)

---

## ⬜ Candidate — deeper ranking (the "rank" half)
- ⬜ 🟢 Risk-free rate input (true Sharpe numerator)
- ⬜ 🟡 Sector-relative ranking (rank within sector)
- ⬜ 🟡 Weighted second score component — another window, or value / quality measures — blended in

## ⬜ Candidate — smarter weighting & risk (the "weight" half)
- ⬜ 🟡 Compare weighting schemes (HRP vs equal / inverse-vol / min-variance)
- ⬜ 🟡 Portfolio backtest line — weighted-basket cumulative return, vol, max drawdown over the window
- ⬜ 🟡 Correlation heatmap + diversification stats (effective number of bets)
- ⬜ 🟢 More constraints — max holdings (cardinality), min weight, per-sector minimums

## ⬜ Candidate — workflow & persistence
- ⬜ 🟡 Named portfolios + separate watchlist
- ⬜ 🟢 Export weights (CSV / shareable card)
- ⬜ 🟡 Per-ticker notes

## ⬜ Candidate — data & freshness
- ⬜ 🟡 Scheduled auto-refresh — GitHub Action rebuilds the snapshot on a cron (FMP key as repo secret)
- ⬜ 🟡 Fundamentals (P/E, margins, growth) as filters/columns
- ⬜ 🟡 Custom / larger universes (type your own list; add S&P 500)

## ⬜ Candidate — native polish
- ⬜ 🟢 Deeper chart interactions (multi-range toggles, compare a benchmark)
- ⬜ 🔴 ⚙️ Standalone EAS build — home-screen icon, widgets (top movers), push notifications (rebalance alerts)
