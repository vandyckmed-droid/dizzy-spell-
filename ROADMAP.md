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
- 🟡 **Second return window** (default **6–1**) — when on, it **blends 50/50** with the primary
  window into one ranking score. Both windows are annualized first, so a shorter and a longer window
  sit on the same per-year scale and combine fairly. Dynamic month labels (e.g. 12–1 / 6–1).
- 🟡 **Residual momentum** — OLS α, β over the trailing 756 days vs a fixed ETF (VTI); true residuals
  `e = r − α − β·m` over the chosen window; short-history names marked n/a.
- 🟡 **Correlation-to-basket cue** — as you scroll, redundant names (high ρ vs a held name) fade and
  get a **red dot + ≈ twin + red add button**; diversifiers (low ρ) get the complementary **teal dot +
  add button**. Thresholds are **user-configurable** (default: diversify < 0.45, redundant ≥ 0.60).
- 🟢 **Normalized 0–100 score** (optional) — a **logistic curve calibrated to the universe's own
  distribution**: the median name lands at **50**, and the scale is set from the deciles so the
  10th/90th-percentile scores map to 10/90 (top & bottom deciles then occupy 90–100 / 0–10, with the
  extremes at 0/100). Asymmetric scale handles skew. Raw score stays as a subscript; any mode.
- 🟢 Sort & filter (market-cap band, exchange); selection persisted **by date** (survives rebuilds).
- 🟢 **Checkmark select** — a round ＋ / ✓ button toggles a name into the basket (with a little
  bounce and a haptic); tapping the row body opens the detail. The button picks up the basket cue
  (teal when the name diversifies, filled green once held). Dual windows render as **two clean
  color-coded scores** (separate) or one blended score (blend), with a color legend at the top
  instead of per-row labels. (Tried swipe- and tap-to-select; the checkmark won.)
- 🟡 **Saved books** — holdings live in named books, each a **portfolio** (HRP-weighted) or a
  **watchlist** (unweighted, momentum-ranked). Switcher + ＋New + a manage sheet (rename / switch
  type / delete) on the Portfolio; an "Adding to … · Switch" chip on the Screener. Ranking settings
  stay global; only holdings are per-book. Old single basket migrates into book #1.

### Portfolio & weighting
- 🟡 Long-only **HRP** (stabilized corr → √((1−ρ)/2) → average linkage → quasi-diagonalization →
  recursive inverse-variance, latest 252d).
- 🟡 Per-stock / per-sector **caps** + a per-stock **minimum weight** (0.5% steps, default off),
  redistributed to exactly 100% with correct **joint feasibility** (caps + floor solved together)
  and guidance when infeasible.
- 🟡 **Weighting compare** — HRP next to **equal-weight, inverse-vol, and long-only min-variance**
  for the same book, each shown with annualized vol, effective bets and top weight (post-caps). Tap
  to weight the book by any scheme. All four cross-checked against the NumPy reference (shared
  Gauss-Jordan inverse; long-only min-var by iterative negative-name pruning).
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
- 🟢 **Configurable EMAs** — EMA-50 / EMA-200 on the daily views (on/off + period in **steps of 5**,
  with a **↺ 50 / 200 reset**).
- 🟢 **Golden / death cross effect** — the **fast EMA is bi-colored** (green above the slow EMA, red
  below) with a matching **translucent fill** between the two lines, a thin base regime strip, and a
  **soft round glow** at each crossover; toggleable.
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

### 🎯 Next up — portfolio backtest line
Plot the current book's cumulative return, vol and max drawdown over the trailing 1–2y (vs SPY),
periodically rebalanced to the chosen weighting scheme. Closes the loop: shows whether the
momentum + weighting pipeline would actually have paid off. Needs care on rebalancing + no lookahead;
be explicit that it's in-sample.

### Ranking
- 🟡 Sector-relative ranking (rank within sector)
- 🟡 Adjustable A/B blend weight (instead of 50/50); value / quality as a third input

### Weighting & risk
- 🟡 Correlation heatmap (effective bets already shipped on the Portfolio)
- 🟢 Swipe-to-hide rows on the Screener (with a reset) — deferred; checkmark select shipped
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
