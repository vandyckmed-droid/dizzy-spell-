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

### V3 batch — ranking factors
- ✅ 🟡 **Rank-by factor selector** — the chosen factor sets both the rank order and the
  highlighted card number. Factors: **Sharpe momentum**, **12–1 raw momentum**,
  **6–1 raw momentum**, **market-residual return** (return net of market beta),
  window return, annualized vol (low-vol), market cap, A–Z. Tap to flip direction.
  All factor math validated against the NumPy reference (222 checks).
- ❌ Declined: composite multi-factor blend, Sortino, trend-vs-200d (prefer raw-return factors)

---

## ⬜ Candidate — deeper ranking (the "rank" half)
- ⬜ 🟢 Risk-free rate input (true Sharpe)
- ⬜ 🟡 Sector-relative ranking (rank within sector)
- ⬜ 🟡 Configurable momentum lookbacks (e.g. 3–1, 9–1) beyond the fixed 12–1 / 6–1

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
