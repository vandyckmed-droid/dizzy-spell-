#!/usr/bin/env python3
"""
Build-time data layer for the iPhone Portfolio Screener artifact.

Runs in the Claude coding environment (NOT in the browser). It reads the FMP
API key from the environment, fetches adjusted daily prices + company metadata
from Financial Modeling Prep's *stable* API, applies security-eligibility
filtering (recording every exclusion reason), and writes a compact JSON
snapshot that is embedded into a fully self-contained HTML artifact.

The delivered artifact contains NO API key and makes NO network calls: all
ranking / HRP / constraint math runs client-side on the embedded snapshot.

Endpoints used (stable API — the legacy v3 endpoints are deprecated for this key):
  - /stable/company-screener               (universe candidate discovery)
  - /stable/profile                         (metadata + eligibility flags)
  - /stable/historical-price-eod/dividend-adjusted  (split+dividend adjusted closes)
"""
import os
import re
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

API_KEY = os.environ.get("API_KEY", "").strip()
if not API_KEY:
    sys.exit("API_KEY not set in environment")

BASE = "https://financialmodelingprep.com/stable/"
HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
os.makedirs(DATA_DIR, exist_ok=True)

# How many trailing trading days of adjusted closes to embed per ticker.
# Needs to cover: default ranking lookback (252) with room to slide the as-of
# date back, the HRP risk window (latest 252), and the 1-year detail return.
HISTORY_TRADING_DAYS = 520
MAJOR_EXCHANGES = {"NASDAQ", "NYSE", "AMEX"}
# Symbols that are a plain 1-5 letter root are ordinary common shares. Anything
# with a suffix (.NE foreign listing, -WS warrant, -U unit, -R right, -P/-PR
# preferred, .WS etc.) is filtered out -- this also keeps exactly one primary
# share class per company.
CLEAN_SYMBOL = re.compile(r"^[A-Z]{1,5}$")
SPAC_HINTS = re.compile(r"acquisition corp|blank check|spac\b", re.I)


def _get(url, retries=4):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "screener-build/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read()[:200].decode("utf8", "ignore")
            if e.code in (429, 500, 502, 503) and i < retries - 1:
                time.sleep(2 ** i)
                continue
            last = f"HTTP {e.code}: {body}"
            break
        except Exception as e:  # network / timeout
            last = f"{type(e).__name__}: {e}"
            if i < retries - 1:
                time.sleep(2 ** i)
                continue
    raise RuntimeError(f"GET failed {url.split('?')[0]} :: {last}")


def api(path, **params):
    params["apikey"] = API_KEY
    return _get(BASE + path + "?" + urllib.parse.urlencode(params))


# --------------------------------------------------------------------------
# Universe candidate discovery (rule-based screener queries).
# Universe *definitions* are kept separate from ranking / portfolio logic.
# --------------------------------------------------------------------------
UNIVERSES = {
    "tech_large": {
        "label": "US Technology (Large-Cap)",
        "note": "Technology-sector companies among the largest U.S.-traded firms.",
        "screen": dict(sector="Technology", marketCapMoreThan=15_000_000_000,
                       isEtf="false", isFund="false", isActivelyTrading="true",
                       country="US", limit=400),
        "target": 120,
    },
    "midcap": {
        "label": "US Mid-Cap Core",
        "note": "Rule-based mid-cap subset (~$2B-$20B), a stand-in for S&P MidCap 400.",
        "screen": dict(marketCapMoreThan=2_000_000_000, marketCapLowerThan=20_000_000_000,
                       isEtf="false", isFund="false", isActivelyTrading="true",
                       country="US", limit=800),
        "target": 160,
    },
}


def discover_candidates():
    """Return dict symbol -> {row, universes:set} from screener queries."""
    cand = {}
    for uid, cfg in UNIVERSES.items():
        rows = api("company-screener", **cfg["screen"])
        if not isinstance(rows, list):
            raise RuntimeError(f"screener for {uid} returned: {rows}")
        # rank by market cap desc, take generous headroom before eligibility trim
        rows.sort(key=lambda r: r.get("marketCap") or 0, reverse=True)
        kept = 0
        for r in rows:
            sym = r.get("symbol", "")
            ex = r.get("exchangeShortName", "")
            if ex not in MAJOR_EXCHANGES or not CLEAN_SYMBOL.match(sym):
                continue
            entry = cand.setdefault(sym, {"row": r, "universes": set()})
            entry["universes"].add(uid)
            kept += 1
            if kept >= cfg["target"] * 2:  # headroom for eligibility/history drops
                break
    return cand


# --------------------------------------------------------------------------
# Eligibility filtering with recorded exclusion reasons.
# --------------------------------------------------------------------------
def eligible(sym, prof):
    """Return (ok:bool, reason:str|None) from a profile record."""
    if not prof:
        return False, "no_profile"
    if prof.get("isEtf"):
        return False, "etf"
    if prof.get("isFund"):
        return False, "fund"
    if not prof.get("isActivelyTrading", True):
        return False, "inactive_listing"
    ex = prof.get("exchangeShortName") or prof.get("exchange") or ""
    if ex not in MAJOR_EXCHANGES:
        return False, f"non_major_exchange:{ex}"
    if not CLEAN_SYMBOL.match(sym):
        return False, "non_common_share_class"  # warrant/right/unit/preferred/foreign
    name = prof.get("companyName") or ""
    if SPAC_HINTS.search(name):
        return False, "spac_shell"
    price = prof.get("price") or 0
    if price <= 0:
        return False, "invalid_price"
    return True, None


def main():
    print("Discovering universe candidates ...")
    cand = discover_candidates()
    print(f"  {len(cand)} unique clean-symbol candidates")

    # Fetch profiles concurrently
    print("Fetching profiles ...")
    profiles = {}

    def fetch_profile(sym):
        try:
            d = api("profile", symbol=sym)
            return sym, (d[0] if isinstance(d, list) and d else None)
        except Exception as e:
            return sym, {"__error__": str(e)}

    with ThreadPoolExecutor(max_workers=12) as ex:
        for fut in as_completed([ex.submit(fetch_profile, s) for s in cand]):
            sym, prof = fut.result()
            profiles[sym] = prof

    # Eligibility pass + dedup by CIK (keep largest market cap per company)
    exclusions = []
    by_cik = {}
    eligible_syms = []
    for sym, entry in cand.items():
        prof = profiles.get(sym)
        if prof and prof.get("__error__"):
            exclusions.append({"symbol": sym, "reason": "profile_error"})
            continue
        ok, reason = eligible(sym, prof)
        if not ok:
            exclusions.append({"symbol": sym, "reason": reason,
                               "name": (prof or {}).get("companyName")})
            continue
        cik = prof.get("cik") or sym
        prev = by_cik.get(cik)
        mc = prof.get("marketCap") or 0
        if prev and (profiles[prev].get("marketCap") or 0) >= mc:
            exclusions.append({"symbol": sym, "reason": "duplicate_security",
                               "name": prof.get("companyName"), "kept": prev})
            continue
        if prev:
            exclusions.append({"symbol": prev, "reason": "duplicate_security",
                               "name": profiles[prev].get("companyName"), "kept": sym})
            eligible_syms.remove(prev)
        by_cik[cik] = sym
        eligible_syms.append(sym)

    print(f"  {len(eligible_syms)} eligible after profile/dedup; "
          f"{len(exclusions)} excluded")

    # Fetch adjusted price history concurrently
    print("Fetching adjusted price histories ...")
    prices = {}

    def fetch_prices(sym):
        try:
            d = api("historical-price-eod/dividend-adjusted", symbol=sym)
            return sym, d if isinstance(d, list) else None
        except Exception as e:
            return sym, {"__error__": str(e)}

    with ThreadPoolExecutor(max_workers=12) as ex:
        for fut in as_completed([ex.submit(fetch_prices, s) for s in eligible_syms]):
            sym, d = fut.result()
            prices[sym] = d

    # Build a common trading-day calendar from the most complete history, then
    # require each ticker to have a valid, gap-free series on that calendar.
    # Determine the union of the most recent HISTORY_TRADING_DAYS dates that a
    # broad set of tickers share.
    date_counts = {}
    parsed = {}
    for sym in eligible_syms:
        d = prices.get(sym)
        if not isinstance(d, list) or len(d) < HISTORY_TRADING_DAYS:
            continue
        series = {row["date"]: row.get("adjClose") for row in d
                  if row.get("adjClose") and row["adjClose"] > 0}
        parsed[sym] = series
        for dt in list(series)[:HISTORY_TRADING_DAYS + 40]:
            date_counts[dt] = date_counts.get(dt, 0) + 1

    if not date_counts:
        raise RuntimeError("no usable price histories fetched")
    # Reference calendar = most recent HISTORY_TRADING_DAYS dates present in a
    # strong majority of tickers.
    quorum = max(3, int(0.6 * len(parsed)))
    common_dates = sorted([dt for dt, c in date_counts.items() if c >= quorum],
                          reverse=True)[:HISTORY_TRADING_DAYS]
    common_dates.sort()  # ascending
    if len(common_dates) < 260:
        raise RuntimeError(f"insufficient common calendar: {len(common_dates)} days")
    print(f"  reference calendar: {len(common_dates)} trading days "
          f"{common_dates[0]}..{common_dates[-1]}")

    # Assemble final tickers with a clean series on the common calendar.
    tickers = []
    for sym in eligible_syms:
        series = parsed.get(sym)
        if not series:
            exclusions.append({"symbol": sym, "reason": "invalid_price_history"})
            continue
        closes = [series.get(dt) for dt in common_dates]
        missing = sum(1 for c in closes if not c)
        if missing > 0:
            # tolerate tiny gaps by forward/back fill; too many => exclude
            if missing > 5:
                exclusions.append({"symbol": sym, "reason": "insufficient_history",
                                   "missing": missing})
                continue
            # forward fill then back fill
            last = None
            for i in range(len(closes)):
                if closes[i]:
                    last = closes[i]
                elif last:
                    closes[i] = last
            nxt = None
            for i in range(len(closes) - 1, -1, -1):
                if closes[i]:
                    nxt = closes[i]
                elif nxt:
                    closes[i] = nxt
        if any(not c or c <= 0 for c in closes):
            exclusions.append({"symbol": sym, "reason": "invalid_price_history"})
            continue
        prof = profiles[sym]
        tickers.append({
            "symbol": sym,
            "name": prof.get("companyName") or sym,
            "sector": prof.get("sector") or "Unknown",
            "industry": prof.get("industry") or "Unknown",
            "marketCap": prof.get("marketCap") or 0,
            "exchange": prof.get("exchangeShortName") or prof.get("exchange") or "",
            "universes": sorted(cand[sym]["universes"]),
            "closes": [round(c, 3) for c in closes],
        })

    tickers.sort(key=lambda t: t["marketCap"], reverse=True)
    print(f"  {len(tickers)} final tickers with valid history")

    snapshot = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Financial Modeling Prep (stable API), split+dividend adjusted closes",
        "dates": common_dates,
        "universes": {uid: {"label": c["label"], "note": c["note"]}
                      for uid, c in UNIVERSES.items()},
        "tickers": tickers,
        "exclusions": exclusions,
        "counts": {
            "eligible": len(tickers),
            "excluded": len(exclusions),
            "tradingDays": len(common_dates),
        },
    }
    out = os.path.join(DATA_DIR, "snapshot.json")
    with open(out, "w") as f:
        json.dump(snapshot, f, separators=(",", ":"))
    print(f"Wrote {out} ({os.path.getsize(out)/1e6:.2f} MB), "
          f"{len(tickers)} tickers, {len(exclusions)} exclusions")


if __name__ == "__main__":
    main()
