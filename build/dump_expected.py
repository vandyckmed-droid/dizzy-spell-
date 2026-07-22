#!/usr/bin/env python3
"""Dump reference numeric outputs to build/expected.json for the JS cross-check."""
import json, numpy as np
import reference_numerics as ref

snap = json.load(open("data/snapshot.json"))
tk = {t["symbol"]: t for t in snap["tickers"]}
N = len(snap["dates"])
asof = N - 1

# deterministic symbol sample (first 20 by market cap that exist)
syms = [t["symbol"] for t in snap["tickers"][:20]]

sm = {}
for s in syms:
    r = ref.sharpe_momentum(tk[s]["closes"], asof, 252, 21)
    sm[s] = None if r is None else {k: r[k] for k in ("sharpe", "ann_ret", "ann_vol", "cum", "n")}

# cap-weighted market daily returns over the full history (us_top500 pool)
pool = [t for t in snap["tickers"] if "us_top500" in t["universes"]]
total_cap = sum(t["marketCap"] for t in pool) or 1.0
mret_all = np.zeros(N - 1)
for t in pool:
    c = np.asarray(t["closes"], float)
    mret_all += (t["marketCap"] / total_cap) * (c[1:] / c[:-1] - 1.0)
mret_list = [float(x) for x in mret_all]

# momentum_score across several configs for the sample
CONFIGS = {
    "default": dict(retStart=252, retEnd=21, volStart=252, volEnd=21, matchVol=True, mode="sharpe", removeMkt=False),
    "return_only": dict(retStart=252, retEnd=21, volStart=252, volEnd=21, matchVol=True, mode="return", removeMkt=False),
    "vol_only": dict(retStart=252, retEnd=21, volStart=252, volEnd=21, matchVol=True, mode="vol", removeMkt=False),
    "split_vol": dict(retStart=252, retEnd=21, volStart=63, volEnd=1, matchVol=False, mode="sharpe", removeMkt=False),
    "residual_sharpe": dict(retStart=252, retEnd=21, volStart=252, volEnd=21, matchVol=True, mode="sharpe", removeMkt=True),
    "residual_return": dict(retStart=126, retEnd=21, volStart=126, volEnd=21, matchVol=True, mode="return", removeMkt=True),
}
scores = {}
for name, cfg in CONFIGS.items():
    scores[name] = {}
    for s in syms:
        r = ref.momentum_score(tk[s]["closes"], mret_all, asof, cfg)
        scores[name][s] = None if r is None else {k: r[k] for k in ("annRet", "annVol", "score", "cum", "beta")}

# HRP + caps on a diversified 12-name selection across sectors
by_sec = {}
rows = sorted(((s, ref.sharpe_momentum(tk[s]["closes"], asof, 252, 21)) for s in tk),
             key=lambda x: -(x[1]["sharpe"] if x[1] else -9))
for s, r in rows:
    if r:
        by_sec.setdefault(tk[s]["sector"], []).append(s)
sel = []
for sec in sorted(by_sec):
    sel.extend(by_sec[sec][:2])
sel = sel[:12]

hist = np.column_stack([np.asarray(tk[s]["closes"][asof-252:asof+1]) for s in sel])
R = hist[1:] / hist[:-1] - 1
w = ref.hrp_weights(R)
secs = [tk[s]["sector"] for s in sel]
wc, ok, _ = ref.apply_caps(w, secs, max_stock=0.15, max_sector=0.45)

out = {
    "asof": asof,
    "sharpe": sm,
    "configs": CONFIGS,
    "scores": scores,
    "market": mret_list,
    "hrp_selection": sel,
    "hrp_weights": [float(x) for x in w],
    "caps": {"maxStock": 0.15, "maxSector": 0.45,
             "weights": [float(x) for x in wc], "feasible": bool(ok)},
}
json.dump(out, open("build/expected.json", "w"), indent=0)
print(f"dumped expected.json: {len(sm)} sharpe rows, {len(CONFIGS)} score configs, HRP on {len(sel)} names")
