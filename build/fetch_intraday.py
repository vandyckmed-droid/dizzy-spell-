#!/usr/bin/env python3
"""
Macro-ETF intraday + daily OHLC layer.

Pulls, for a small set of macro ETFs, 5-minute intraday bars (~2 weeks) and
daily OHLC history (for the daily chart + user-configurable EMAs), and merges
them into data/snapshot.json under snapshot["macro"]. Kept separate from
fetch_data.py so the intraday bars can be refreshed on their own (cheap: a
handful of symbols) without rebuilding the 500-name EOD snapshot.

Reads the FMP key from $API_KEY at build time only; the key is never shipped.

Endpoints (stable API):
  /stable/historical-chart/5min          (intraday OHLCV)
  /stable/historical-price-eod/full      (daily OHLCV)
"""
import os
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone

API_KEY = os.environ.get("API_KEY", "").strip()
if not API_KEY:
    sys.exit("API_KEY not set in environment")

BASE = "https://financialmodelingprep.com/stable/"
HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
SNAP = os.path.join(DATA_DIR, "snapshot.json")

DAILY_KEEP = 460        # daily bars retained (≈1y display + 200-EMA warmup)
INTRADAY_KEEP = 780     # 5-min bars retained (≈2 weeks of regular-hours sessions)

# The macro dashboard. Order defines display order. `group` clusters the list.
# `disp` overrides the shown ticker when the fetch symbol isn't display-friendly.
MACRO = [
    {"symbol": "SPY",  "label": "S&P 500",         "desc": "US large-cap equities",      "group": "Equities"},
    {"symbol": "TLT",  "label": "20+ Yr Treasuries", "desc": "Long-duration rates",       "group": "Rates"},
    {"symbol": "HYG",  "label": "High Yield",       "desc": "High-yield corporate credit", "group": "Credit"},
    {"symbol": "XLE",  "label": "Energy Select",    "desc": "US energy sector",           "group": "Energy"},
    {"symbol": "GLD",  "label": "Gold",             "desc": "Gold bullion",               "group": "Metals"},
    {"symbol": "UUP",  "label": "US Dollar",        "desc": "Dollar index (bullish)",     "group": "Dollar"},
    {"symbol": "^VIX", "disp": "VIX", "label": "Volatility", "desc": "CBOE VIX index",     "group": "Volatility"},
]


def _get(url, retries=4):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "screener-build/2.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read()[:200].decode("utf8", "ignore")
            if e.code in (429, 500, 502, 503) and i < retries - 1:
                time.sleep(2 ** i); continue
            last = f"HTTP {e.code}: {body}"; break
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            if i < retries - 1:
                time.sleep(2 ** i); continue
    raise RuntimeError(f"GET failed {url.split('?')[0]} :: {last}")


def api(path, **params):
    params["apikey"] = API_KEY
    return _get(BASE + path + "?" + urllib.parse.urlencode(params))


def r3(x):
    try:
        return round(float(x), 3)
    except (TypeError, ValueError):
        return None


def daily_bars(sym):
    """Oldest→newest daily OHLC, last DAILY_KEEP bars."""
    d = api("historical-price-eod/full", symbol=sym)
    if not isinstance(d, list) or not d:
        raise RuntimeError(f"no daily bars for {sym}")
    rows = [row for row in d if row.get("open") and row.get("close")]
    rows.sort(key=lambda r: r["date"])          # oldest → newest
    rows = rows[-DAILY_KEEP:]
    return {
        "d": [r["date"] for r in rows],
        "o": [r3(r["open"]) for r in rows],
        "h": [r3(r["high"]) for r in rows],
        "l": [r3(r["low"]) for r in rows],
        "c": [r3(r["close"]) for r in rows],
    }


def intraday_bars(sym):
    """Oldest→newest 5-min OHLC, last INTRADAY_KEEP bars. Timestamps 'YYYY-MM-DD HH:MM'."""
    d = api("historical-chart/5min", symbol=sym)
    if not isinstance(d, list) or not d:
        raise RuntimeError(f"no intraday bars for {sym}")
    rows = [row for row in d if row.get("open") and row.get("close")]
    rows.sort(key=lambda r: r["date"])          # oldest → newest
    rows = rows[-INTRADAY_KEEP:]
    return {
        "interval": "5min",
        "t": [r["date"][:16] for r in rows],     # drop seconds
        "o": [r3(r["open"]) for r in rows],
        "h": [r3(r["high"]) for r in rows],
        "l": [r3(r["low"]) for r in rows],
        "c": [r3(r["close"]) for r in rows],
    }


def main():
    if not os.path.exists(SNAP):
        sys.exit("data/snapshot.json not found — run fetch_data.py first")
    with open(SNAP) as f:
        snap = json.load(f)

    series = {}
    for m in MACRO:
        sym = m["symbol"]
        print(f"Fetching macro {sym} (daily + 5-min intraday) ...")
        daily = daily_bars(sym)
        intra = intraday_bars(sym)
        print(f"  {sym}: {len(daily['d'])} daily bars {daily['d'][0]}..{daily['d'][-1]} · "
              f"{len(intra['t'])} 5-min bars {intra['t'][0]}..{intra['t'][-1]}")
        series[sym] = {"daily": daily, "intraday": intra}

    snap["macro"] = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "symbols": MACRO,
        "series": series,
    }
    with open(SNAP, "w") as f:
        json.dump(snap, f, separators=(",", ":"))
    print(f"Merged macro layer into {SNAP} "
          f"({os.path.getsize(SNAP)/1e6:.2f} MB, {len(MACRO)} ETFs)")


if __name__ == "__main__":
    main()
