# Roadmap

Personal iPhone **stock screener + portfolio analysis** tool — rank, select, and weight names.
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
- 🟢 **Normalized 0–100 score** (optional) — a **linear rank percentile** over the universe: 100 =
  rank 1, 0 = last, 50 = median, each decile spans 10 points. Says where in the ranked order a name
  sits. Raw score stays as a subscript; any mode.
- 🟢 Sort & filter — a **log-scale market-cap range slider** with two thumbs, a live **count of names
  in range**, and a mini histogram of the universe's cap distribution; exchange chips. Selection
  persisted **by date** (survives rebuilds).
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

### Ticker detail (numbers-focused)
- 🟢 Company logo, sector tag (tappable → that sector's universe), industry / exchange / market-cap tags.
- 🟢 Score stat cards — Sharpe / return / vol (or residual α, idio vol, β and annualized α when
  market influence is removed) — plus a **performance table** (5d/10d/1m/3m/6m/1y).
- 🟡 **Top-3 correlated peers** (latest 252d), tappable.

### Design & reliability
- 🟡 Robinhood-inspired dark theme (near-black, vivid green/red, tabular numerals, soft geometry).
- 🟢 Static HTML artifact twin shares the validated engine.
- 🟡 Numerics cross-checked vs a NumPy reference — `validate_js.mjs` (1007) + `verify_edge.mjs` (1317).
- 🟢 Headless react-native-web render harness (Screener / Portfolio / detail, zero errors).
- 🟡 **Fast first paint** — the app loads a **light snapshot** (recent ~300 days, `snapshot.lite.json`,
  ~557 KB gzipped vs 1.25 MB full) for instant render, then background-fetches the full 800-day
  history and hot-swaps it in (as-of persists by date, so the swap is seamless). Residual momentum
  shows "loading" until the full history lands.
- 🟢 Delivery as a **single stable, auto-updating Snack** (external raw refs on `main`, gzipped from
  GitHub's CDN, cached across opens) instead of a fresh frozen inline Snack per change.

---

## ⬜ Candidate — next

### 🎯 Next up — portfolio backtest metrics
The current book's **cumulative return, annualized vol, and max drawdown** over the trailing 1–2y
(vs SPY), periodically rebalanced to the chosen weighting scheme — shown as a **numbers readout**
(in keeping with the numbers-focused redesign). Closes the loop: does the momentum + weighting
pipeline actually pay off? Needs care on rebalancing + no lookahead; be explicit that it's in-sample.

### Ranking
- 🟡 Sector-relative ranking (rank within sector)
- 🟡 Adjustable A/B blend weight (instead of 50/50); value / quality as a third input

### Weighting & risk
- 🟡 Correlation heatmap (effective bets already shipped on the Portfolio)
- 🟢 Swipe-to-hide rows on the Screener (with a reset) — deferred; checkmark select shipped
- 🟢 More constraints (max holdings / cardinality, per-sector minimums)

### Workflow & data
- 🟢 Export weights (CSV / shareable card)
- 🟡 Scheduled auto-refresh (GitHub Action on a cron, FMP key as a repo secret)
- 🟡 Fundamentals (P/E, margins, growth) as filters/columns; custom / larger universes
- 🔴 ⚙️ Standalone EAS build — home-screen icon, widgets, push (rebalance alerts)

---

## Notes
- Data refresh (key-free, build-time): `fetch_data.py` → **`make_light.py`** (regenerates the light
  snapshot from the full). The macro/intraday layer was removed in the screener + portfolio redesign.
- The HTML artifact twin keeps the pre-Robinhood theme; the app is the primary surface.
