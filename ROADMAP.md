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
- 🟢 Sort & filter (market-cap band, exchange); selection persisted **by date** (survives rebuilds).
- 🟢 **Tap-to-select** rows (tap anywhere → adds/removes with a light haptic; a trailing **›**
  opens the detail; selected shown by an accent bar + row tint) — replaced the checkmark button
  (and the earlier swipe gesture). Dual windows render as **two clean color-coded scores** (separate)
  or one blended score (blend), with a color legend at the top instead of per-row labels.

### Portfolio & weighting
- 🟡 Long-only **HRP** (stabilized corr → √((1−ρ)/2) → average linkage → quasi-diagonalization →
  recursive inverse-variance, latest 252d).
- 🟡 Per-stock / per-sector **caps** + a per-stock **minimum weight** (0.5% steps, default off),
  redistributed to exactly 100% with correct **joint feasibility** (caps + floor solved together)
  and guidance when infeasible.
- 🟢 Sector allocation bar; **Clear basket** (moved to the bottom).
- 🟡 **Selection guidance** — a Guidance card with **effective bets** (`1/wʹRw`, correlation-adjusted
  count of independent positions), a **suggested add** (top-ranked name that diversifies the basket),
  and a **trim candidate** (weaker half of the most redundant pair), each one-tap actionable.
- 🟢 Explanatory text tucked behind an **ⓘ** (HRP + effective-bets + "how many names" in a sheet).

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
- 🟢 Seven macro symbols across assets — **SPY · TLT · HYG · XLE · GLD · UUP · VIX** (equities,
  rates, credit, energy, metals, dollar, volatility).

### Design & reliability
- 🟡 Robinhood-inspired dark theme (near-black, vivid green/red, tabular numerals, soft geometry).
- 🟢 Static HTML artifact twin shares the validated engine.
- 🟡 Numerics cross-checked vs a NumPy reference — `validate_js.mjs` (1007) + `verify_edge.mjs` (1317).
- 🟢 Headless react-native-web render harness (Screener / Portfolio / Markets / detail, zero errors).
- 🟡 **Fast first paint** — the app loads a **light snapshot** (recent ~300 days, `snapshot.lite.json`,
  ~557 KB gzipped vs 1.25 MB full) for instant render, then background-fetches the full 800-day
  history and hot-swaps it in (as-of persists by date, so the swap is seamless). Residual momentum
  shows "loading" until the full history lands.
- 🟢 Delivery as a **single stable, auto-updating Snack** (external raw refs on `main`, gzipped from
  GitHub's CDN, cached across opens) instead of a fresh frozen inline Snack per change.

---

## ⬜ Candidate — next

### 🎯 Next up — multiple saved books (2nd portfolio / watchlist)
Feasible, **🟡 medium** (~150–200 lines, no engine changes). Design:
- Persist a `books` array — each `{ id, name, kind: 'portfolio' | 'watchlist', selected: [...] }` —
  plus an `activeBook` id. Migration: the current single `selected` becomes book #1.
- A **book switcher** (pills + "＋ New") on the Portfolio (and a compact active-book chip on the
  Screener). Add / rename / delete / switch; long-press for rename/kind.
- **Portfolio** books get HRP + caps + floor (today's view). **Watchlist** books are an unweighted
  tracked list (momentum score + day change, no HRP) — lighter, for names you're eyeing.
- Everything that reads `selected` (screener add/remove, basket cue, tab badge, HRP) routes through
  the active book via two helpers (`activeSelected` / `setSelected`) to keep the change surface small.
- Ranking window / score / chart settings stay **global**; only holdings are per-book. (Per-book caps
  are a later nicety.)

### Ranking
- 🟡 Sector-relative ranking (rank within sector)
- 🟡 Adjustable A/B blend weight (instead of 50/50); value / quality as a third input

### Weighting & risk
- 🟡 Compare weighting schemes (HRP vs equal / inverse-vol / min-variance)
- 🟡 Portfolio backtest line (weighted-basket cumulative return, vol, max drawdown)
- 🟡 Correlation heatmap (effective bets already shipped on the Portfolio)
- 🟢 Swipe-to-hide rows on the Screener (with a reset) — deferred; tap-to-select shipped
- 🟢 More constraints (max holdings / cardinality, per-sector minimums)

### Macro
- 🟡 More symbols (USO oil, BTC, DXY when available)
- 🟢 Multi-range / benchmark compare on the chart

### Workflow & data
- 🟢 Export weights (CSV / shareable card)
- 🟡 Scheduled auto-refresh (GitHub Action on a cron, FMP key as a repo secret)
- 🟡 Fundamentals (P/E, margins, growth) as filters/columns; custom / larger universes
- 🔴 ⚙️ Standalone EAS build — home-screen icon, widgets, push (rebalance alerts)

---

## Notes
- Data refresh (key-free, build-time): `fetch_data.py` → `fetch_intraday.py` → **`make_light.py`**
  (regenerates the light snapshot from the full). Intraday isn't baked for all 600 (size).
- The HTML artifact twin keeps the pre-Robinhood theme; the app is the primary surface.
