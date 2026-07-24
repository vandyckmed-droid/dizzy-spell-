#!/usr/bin/env python3
"""
Derive a LIGHT snapshot (recent history only) from the full snapshot, for fast
first paint. The app bundles/loads `snapshot.lite.json` for the initial render,
then background-fetches the full `snapshot.json` and hot-swaps it in.

The light snapshot keeps the most recent LITE_DAYS of the calendar — enough for
the default ranking window (250→20), the correlation cue, HRP, and 6-month detail
charts. Residual momentum (756-day beta) needs the full history, so it stays n/a
in light mode and populates the moment the full snapshot arrives. Marked
`partial: true` so the app knows to hydrate.
"""
import os
import sys
import json

LITE_DAYS = 300

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
FULL = os.path.join(DATA_DIR, "snapshot.json")
LITE = os.path.join(DATA_DIR, "snapshot.lite.json")


def main():
    if not os.path.exists(FULL):
        sys.exit("data/snapshot.json not found — run fetch_data.py first")
    snap = json.load(open(FULL))
    dates = snap["dates"]
    n = len(dates)
    k = min(LITE_DAYS, n)
    start = n - k

    lite_tickers = []
    for t in snap["tickers"]:
        closes = t["closes"][start:]
        first_valid = next((i for i, c in enumerate(closes) if c), 0)
        lt = dict(t)
        lt["closes"] = closes
        lt["histStart"] = first_valid
        lite_tickers.append(lt)

    market = snap.get("market") or []
    lite_market = market[-(k - 1):] if len(market) >= k - 1 else market

    lite = dict(snap)
    lite["dates"] = dates[start:]
    lite["tickers"] = lite_tickers
    lite["market"] = lite_market
    lite["partial"] = True
    lite["liteDays"] = k
    lite.pop("macro", None)   # macro dashboard removed; drop the intraday/OHLC blob
    # universes, marketSymbol, betaWindow, counts, generatedAt carry over as-is

    with open(LITE, "w") as f:
        json.dump(lite, f, separators=(",", ":"))
    full_mb = os.path.getsize(FULL) / 1e6
    lite_mb = os.path.getsize(LITE) / 1e6
    print(f"Wrote {LITE} ({lite_mb:.2f} MB, {k} days) from full ({full_mb:.2f} MB) "
          f"— {100*lite_mb/full_mb:.0f}% of full")


if __name__ == "__main__":
    main()
