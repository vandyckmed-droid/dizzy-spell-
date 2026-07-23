#!/usr/bin/env python3
"""
Reference implementation of the ranking + HRP + constraint math, used to
validate the JavaScript port that ships in the artifact. Pure Python/NumPy;
must produce the same numbers as the JS to within float tolerance.
"""
import json
import numpy as np

TD = 252  # trading days per year


# ---- Returns & Sharpe momentum -------------------------------------------
def simple_returns(closes):
    c = np.asarray(closes, float)
    return c[1:] / c[:-1] - 1.0


def window_slice(closes, as_of_idx, start_off, end_off):
    """Prices from `start_off` trading days before as_of through `end_off`
    before as_of (inclusive), i.e. closes[as_of-start_off .. as_of-end_off]."""
    lo = as_of_idx - start_off
    hi = as_of_idx - end_off
    return closes[lo:hi + 1]


def momentum_daily(closes, asof, start_off, end_off):
    lo = asof - start_off
    hi = asof - end_off
    if lo < 0 or hi >= len(closes) or hi <= lo:
        return None
    seg = closes[lo:hi + 1]
    if any(v is None or not (v > 0) for v in seg):
        return None
    seg = np.asarray(seg, float)
    r = seg[1:] / seg[:-1] - 1.0
    return dict(r=r, lo=lo, hi=hi, cum=float(seg[-1] / seg[0] - 1.0))


def annualize_stats(r):
    if r is None or len(r) < 2:
        return None
    r = np.asarray(r, float)
    return dict(annRet=float(r.mean() * TD), annVol=float(r.std(ddof=1) * np.sqrt(TD)))


def ols_fit(y, x):
    y = np.asarray(y, float); x = np.asarray(x, float)
    n = min(len(y), len(x))
    if n < 60:
        return None
    y, x = y[:n], x[:n]
    mx, my = x.mean(), y.mean()
    vx = ((x - mx) ** 2).sum()
    beta = float(((y - my) * (x - mx)).sum() / vx) if vx > 0 else 0.0
    return dict(alpha=float(my - beta * mx), beta=beta, n=n)


def momentum_score(closes, market, asof, cfg):
    rw = momentum_daily(closes, asof, cfg["retStart"], cfg["retEnd"])
    if rw is None:
        return None
    v_start = cfg["retStart"] if cfg["matchVol"] else cfg["volStart"]
    v_end = cfg["retEnd"] if cfg["matchVol"] else cfg["volEnd"]
    vw = momentum_daily(closes, asof, v_start, v_end)
    if cfg["mode"] != "return" and vw is None:
        return None
    r_ret, v_ret, beta, alpha, cum = rw["r"], (vw["r"] if vw else None), None, None, rw["cum"]
    if cfg["removeMkt"]:
        bw = cfg.get("betaWindow", 756)
        b_lo, b_hi = asof - bw, asof
        if b_lo < 0:
            return None
        bseg = closes[b_lo:b_hi + 1]
        if any(v is None or not (v > 0) for v in bseg):
            return None
        bseg = np.asarray(bseg, float)
        m = np.asarray(market, float)
        fit = ols_fit(bseg[1:] / bseg[:-1] - 1.0, m[b_lo:b_hi])
        if fit is None:
            return None
        alpha, beta = fit["alpha"], fit["beta"]
        r_ret = rw["r"] - alpha - beta * m[rw["lo"]:rw["lo"] + len(rw["r"])]
        if vw is not None:
            v_ret = vw["r"] - alpha - beta * m[vw["lo"]:vw["lo"] + len(vw["r"])]
        cr = 1.0
        for e in r_ret:
            cr *= (1 + e)
        cum = float(cr - 1)
    ra = annualize_stats(r_ret)
    if ra is None:
        return None
    va = annualize_stats(v_ret) if vw is not None else None
    ann_ret = ra["annRet"]
    ann_vol = va["annVol"] if va else None
    if cfg["mode"] == "return":
        score = ann_ret
    elif cfg["mode"] == "vol":
        score = ann_vol
    else:
        score = ann_ret / ann_vol if (ann_vol and ann_vol > 0) else 0.0
    return dict(annRet=ann_ret, annVol=ann_vol, score=score, cum=cum, beta=beta, alpha=alpha)


def sharpe_momentum(closes, as_of_idx, start_off, end_off):
    seg = window_slice(closes, as_of_idx, start_off, end_off)
    r = simple_returns(seg)
    if len(r) < 2:
        return None
    mean = r.mean()
    sd = r.std(ddof=1)  # sample std
    ann_ret = mean * TD
    ann_vol = sd * np.sqrt(TD)
    sharpe = ann_ret / ann_vol if ann_vol > 0 else 0.0
    cum = float(seg[-1] / seg[0] - 1.0)
    return dict(sharpe=sharpe, ann_ret=ann_ret, ann_vol=ann_vol, cum=cum, n=len(r))


# ---- HRP ------------------------------------------------------------------
def hrp_weights(returns_matrix):
    """returns_matrix: (T, N) simple returns. Long-only HRP weights (sum=1)."""
    R = np.asarray(returns_matrix, float)
    cov = np.cov(R, rowvar=False, ddof=1)
    std = np.sqrt(np.diag(cov))
    corr = cov / np.outer(std, std)
    corr = np.clip(corr, -1, 1)
    np.fill_diagonal(corr, 1.0)
    dist = np.sqrt(np.clip((1 - corr) / 2.0, 0, None))
    order = _quasi_diag(_average_linkage(dist))
    w = _recursive_bisection(cov, order)
    return w


def _average_linkage(dist):
    """Agglomerative average-linkage; returns SciPy-style linkage rows
    [a, b, height, size]."""
    n = dist.shape[0]
    # active cluster ids -> member index lists
    clusters = {i: [i] for i in range(n)}
    D = {(i, j): dist[i, j] for i in range(n) for j in range(i + 1, n)}
    next_id = n
    Z = []
    active = set(range(n))
    while len(active) > 1:
        # find min pair
        best = None
        for i in active:
            for j in active:
                if i < j:
                    d = D[(i, j)]
                    if best is None or d < best[0]:
                        best = (d, i, j)
        d, a, b = best
        na, nb = len(clusters[a]), len(clusters[b])
        Z.append([a, b, d, na + nb])
        new = next_id
        clusters[new] = clusters[a] + clusters[b]
        # average-linkage distance to remaining clusters (weighted by size)
        for k in active:
            if k == a or k == b:
                continue
            da = D[(min(a, k), max(a, k))]
            db = D[(min(b, k), max(b, k))]
            D[(min(new, k), max(new, k))] = (na * da + nb * db) / (na + nb)
        active.discard(a)
        active.discard(b)
        active.add(new)
        next_id += 1
    return Z, n


def _quasi_diag(link):
    """Return leaf order from linkage (recursively expand the last merge)."""
    Z, n = link
    if not Z:
        return [0]
    root = len(Z) - 1 + n

    def expand(node):
        if node < n:
            return [node]
        a, b = int(Z[node - n][0]), int(Z[node - n][1])
        return expand(a) + expand(b)

    return expand(root)


def _recursive_bisection(cov, order):
    n = cov.shape[0]
    w = np.ones(n)
    clusters = [order]
    while clusters:
        new = []
        for cl in clusters:
            if len(cl) <= 1:
                continue
            half = len(cl) // 2
            left, right = cl[:half], cl[half:]
            var_l = _cluster_var(cov, left)
            var_r = _cluster_var(cov, right)
            alpha = 1 - var_l / (var_l + var_r)
            for i in left:
                w[i] *= alpha
            for i in right:
                w[i] *= (1 - alpha)
            new.append(left)
            new.append(right)
        clusters = new
    return w / w.sum()


def _cluster_var(cov, idx):
    sub = cov[np.ix_(idx, idx)]
    ivp = 1.0 / np.diag(sub)
    ivp = ivp / ivp.sum()
    return float(ivp @ sub @ ivp)


# ---- Constraint redistribution -------------------------------------------
def apply_caps(weights, sectors, max_stock=None, max_sector=None,
               min_stock=None, tol=1e-9, max_iter=2000):
    """Iteratively cap individual & sector weights and floor individual weights,
    redistributing proportionally across free names until total == 1.

    Returns (weights, feasible, message).
    """
    w = np.asarray(weights, float).copy()
    w = w / w.sum()
    n = len(w)
    ms = min_stock if (min_stock and min_stock > 0) else 0.0
    sectors = list(sectors)
    uniq_sectors = sorted(set(sectors))

    if max_stock is not None and max_stock * n < 1 - tol:
        return w, False, (f"Infeasible: {n} names capped at {max_stock:.0%} "
                          f"can hold at most {max_stock*n:.0%}. Raise the stock "
                          f"cap to ≥ {1.0/n:.1%} or add names.")
    if ms > 0 and ms * n > 1 + tol:
        return w, False, (f"Infeasible: {n} names at a {ms:.1%} minimum need "
                          f"{ms*n:.0%}. Lower the minimum or trim names.")
    if ms > 0 and max_stock is not None and ms > max_stock + tol:
        return w, False, "Infeasible: minimum exceeds the stock cap."
    if ms > 0 and max_sector is not None:
        for s in uniq_sectors:
            cnt = sum(1 for x in sectors if x == s)
            if cnt * ms > max_sector + tol:
                return w, False, (f"Infeasible: {cnt} {s} names at {ms:.1%} need "
                                  f"{cnt*ms:.0%}, over the {max_sector:.0%} sector cap.")
    if max_sector is not None:
        # joint capacity: each sector holds at most min(sector_cap, its_names*stock_cap)
        capacity = 0.0
        for s in uniq_sectors:
            cnt = sum(1 for x in sectors if x == s)
            capacity += (min(max_sector, cnt * max_stock)
                         if max_stock is not None else max_sector)
        if capacity < 1 - tol:
            return w, False, (f"Infeasible: capped sectors hold at most "
                              f"{capacity:.0%}. Loosen a cap, add names, or "
                              f"spread across more sectors.")

    for _ in range(max_iter):
        changed = False
        # ---- stock caps ----
        if max_stock is not None:
            over = w > max_stock + tol
            if over.any():
                excess = (w[over] - max_stock).sum()
                w[over] = max_stock
                free = ~over & (w < max_stock - tol)
                if not free.any():
                    return w, False, "Infeasible: stock cap leaves no capacity."
                w[free] += excess * (w[free] / w[free].sum())
                changed = True
        # ---- stock floor ----
        if ms > 0:
            under = w < ms - tol
            if under.any():
                deficit = (ms - w[under]).sum()
                w[under] = ms
                donors = (~under) & (w > ms + tol)
                head = (w[donors] - ms)
                if head.sum() < deficit - tol:
                    return w, False, ("Infeasible: minimum weight leaves no "
                                      "capacity to redistribute.")
                w[donors] -= deficit * (head / head.sum())
                changed = True
        # ---- sector caps (min-aware scaling) ----
        if max_sector is not None:
            for s in uniq_sectors:
                mask = np.array([sc == s for sc in sectors])
                tot = w[mask].sum()
                if tot > max_sector + tol:
                    excess = tot - max_sector
                    cnt = int(mask.sum())
                    floor_tot = cnt * ms
                    scalable = tot - floor_tot
                    scale = max(0.0, max_sector - floor_tot) / scalable if scalable > tol else 0.0
                    w[mask] = ms + (w[mask] - ms) * scale
                    free = ~mask
                    if max_stock is not None:
                        free = free & (w < max_stock - tol)
                    if not free.any():
                        return w, False, ("Infeasible: sector cap cannot be "
                                          "redistributed within other caps.")
                    w[free] += excess * (w[free] / w[free].sum())
                    changed = True
        if not changed:
            break
    w = w / w.sum()
    return w, True, "ok"


# ---- self-test ------------------------------------------------------------
if __name__ == "__main__":
    snap = json.load(open("data/snapshot.json"))
    tk = {t["symbol"]: t for t in snap["tickers"]}
    dates = snap["dates"]
    N = len(dates)
    as_of = N - 1

    # Sharpe momentum for a few names, default window 252 -> 21
    print("== Sharpe momentum (as_of=latest, 252->21) ==")
    rows = []
    for sym, t in tk.items():
        r = sharpe_momentum(t["closes"], as_of, 252, 21)
        if r:
            rows.append((sym, r))
    rows.sort(key=lambda x: -x[1]["sharpe"])
    for sym, r in rows[:8]:
        print(f"  {sym:5s} sharpe={r['sharpe']:+.3f} annRet={r['ann_ret']:+.2%} "
              f"annVol={r['ann_vol']:.2%} cum={r['cum']:+.2%} n={r['n']}")
    print(f"  (returns count for default window should be ~231): n={rows[0][1]['n']}")

    # Build a diversified selection: top Sharpe name from each of several
    # sectors so caps are actually feasible.
    by_sector = {}
    for sym, r in rows:
        s = tk[sym]["sector"]
        by_sector.setdefault(s, []).append(sym)
    sel = []
    for s in sorted(by_sector):
        sel.extend(by_sector[s][:3])   # up to 3 names per sector
    sel = sel[:14]
    hist = np.column_stack([np.asarray(tk[s]["closes"][-253:]) for s in sel])
    R = hist[1:] / hist[:-1] - 1
    w = hrp_weights(R)
    print(f"\n== HRP weights ({len(sel)} names across sectors, latest 252d) ==  sum={w.sum():.6f}")
    for s, wi in zip(sel, w):
        print(f"  {s:5s} {wi:6.2%}  [{tk[s]['sector']}]")

    # Feasible constraints
    secs = [tk[s]["sector"] for s in sel]
    nsec = len(set(secs))
    wc, ok, msg = apply_caps(w, secs, max_stock=0.15, max_sector=0.40)
    print(f"\n== Capped (stock<=15pct, sector<=40pct, {nsec} sectors) ==  feasible={ok} sum={wc.sum():.8f}")
    for s, wi in zip(sel, wc):
        print(f"  {s:5s} {wi:6.2%}  [{tk[s]['sector']}]")
    assert ok, msg
    assert abs(wc.sum() - 1) < 1e-9, wc.sum()
    assert wc.max() <= 0.15 + 1e-6, wc.max()
    # sector caps respected
    for s in set(secs):
        tot = sum(wi for wi, sc in zip(wc, secs) if sc == s)
        assert tot <= 0.40 + 1e-6, (s, tot)

    # infeasible example (stock cap too tight)
    _, ok2, msg2 = apply_caps(w, secs, max_stock=1.0 / (len(sel) + 2))
    print(f"\n== Infeasible stock cap on {len(sel)} names ==")
    print(f"  feasible={ok2} : {msg2}")
    assert not ok2

    # HRP determinism: same input -> identical output
    w2 = hrp_weights(R)
    assert np.allclose(w, w2)
    print("\nALL REFERENCE CHECKS PASSED")
