#!/usr/bin/env python3
"""
Build-time data layer for the iPhone Portfolio Screener.

Runs in the Claude coding environment (NOT the browser). Reads the FMP API key
from $API_KEY, pulls candidates from FMP's *stable* API, applies the Top-500
eligibility rules, and writes a compact, key-free JSON snapshot that is embedded
into the HTML artifact and the Expo Snack. The delivered app makes no network
calls and contains no API key.

Top-500 universe filter:
  1. Actively traded common stocks on NYSE / Nasdaq / AMEX.
  2. ADRs and foreign companies listed on those exchanges are allowed.
  3. Exclude ETFs, funds, preferred/warrant/right/unit/debt securities, OTC,
     SPACs and shell companies.
  4. Require valid positive price and market capitalization.
  5. Require sufficient price history for the ranking window.
  6. Exclude stale, severely incomplete, or clearly erroneous price data.
  7. Deduplicate share classes by issuer (CIK), retaining the most liquid class.
  8. Pull ~750-1000 candidates, clean, rank by market cap, retain the largest
     500 eligible companies.

Endpoints (stable API; legacy /api/v3 is retired for this key):
  /stable/company-screener
  /stable/profile
  /stable/historical-price-eod/dividend-adjusted
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

HISTORY_TRADING_DAYS = 520          # embedded trailing window per ticker
TARGET = 500                        # retained eligible companies
CANDIDATE_HEADROOM = 850            # profiles fetched before history trim
MAJOR_EXCHANGES = {"NASDAQ", "NYSE", "AMEX"}
MIN_SECTOR_FOR_UNIVERSE = 14        # a sector becomes a sub-universe at this count
MAX_DAILY_MOVE = 0.80               # a larger single-day move ⇒ erroneous data

# Ordinary common shares: a plain 1-5 letter root, or a "-A"/"-B" share class
# (BRK-B, BF-B). Everything else (warrants -WS, units -U/-UN, rights -R/-RT,
# preferreds -P*, foreign dot-listings) is excluded, which also keeps a single
# primary class per issuer before the CIK dedup below.
COMMON_SYMBOL = re.compile(r"^[A-Z]{1,5}$|^[A-Z]{1,4}-[AB]$")
SPAC_HINTS = re.compile(r"acquisition corp|blank check|\bspac\b|holding trust", re.I)

SECTOR_SLUG = {
    "Technology": "tech", "Financial Services": "financials",
    "Healthcare": "healthcare", "Consumer Cyclical": "consumer_cyc",
    "Consumer Defensive": "consumer_def", "Industrials": "industrials",
    "Communication Services": "communications", "Energy": "energy",
    "Basic Materials": "materials", "Real Estate": "real_estate",
    "Utilities": "utilities",
}


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


def discover_candidates():
    """Screener across the three major exchanges → dict symbol -> screener row,
    deduped by symbol, ranked by market cap descending."""
    rows_by_symbol = {}
    for ex in ("NYSE", "NASDAQ", "AMEX"):
        rows = api("company-screener", exchange=ex, isEtf="false", isFund="false",
                   isActivelyTrading="true", marketCapMoreThan=2_000_000_000, limit=1500)
        if not isinstance(rows, list):
            raise RuntimeError(f"screener {ex} returned: {rows}")
        for r in rows:
            sym = r.get("symbol", "")
            if r.get("exchangeShortName") not in MAJOR_EXCHANGES:
                continue
            prev = rows_by_symbol.get(sym)
            if not prev or (r.get("marketCap") or 0) > (prev.get("marketCap") or 0):
                rows_by_symbol[sym] = r
    ordered = sorted(rows_by_symbol.values(),
                     key=lambda r: r.get("marketCap") or 0, reverse=True)
    return ordered


def main():
    print("Discovering candidates across NYSE / NASDAQ / AMEX ...")
    candidates = discover_candidates()
    print(f"  {len(candidates)} unique symbols ≥ $2B on major exchanges")

    exclusions = []

    # ---- symbol / name / price pre-filter (cheap, from screener rows) ----
    prefiltered = []
    for r in candidates:
        sym = r.get("symbol", "")
        name = r.get("companyName") or ""
        if not COMMON_SYMBOL.match(sym):
            exclusions.append({"symbol": sym, "reason": "non_common_share_class"}); continue
        if SPAC_HINTS.search(name):
            exclusions.append({"symbol": sym, "reason": "spac_or_shell", "name": name}); continue
        if (r.get("price") or 0) <= 0:
            exclusions.append({"symbol": sym, "reason": "invalid_price"}); continue
        if (r.get("marketCap") or 0) <= 0:
            exclusions.append({"symbol": sym, "reason": "invalid_market_cap"}); continue
        prefiltered.append(r)
        if len(prefiltered) >= CANDIDATE_HEADROOM:
            break
    print(f"  {len(prefiltered)} passed symbol/price pre-filter")

    # ---- profiles (CIK for dedup, confirm not fund/etf) ----
    print("Fetching profiles ...")
    profiles = {}

    def fetch_profile(sym):
        try:
            d = api("profile", symbol=sym)
            return sym, (d[0] if isinstance(d, list) and d else None)
        except Exception as e:
            return sym, {"__error__": str(e)}

    with ThreadPoolExecutor(max_workers=12) as ex:
        for fut in as_completed([ex.submit(fetch_profile, r["symbol"]) for r in prefiltered]):
            sym, prof = fut.result()
            profiles[sym] = prof

    # ---- dedup share classes by issuer (CIK), keep most liquid ----
    def liquidity(r, prof):
        # dollar-volume proxy; fall back to raw volume
        vol = (prof or {}).get("averageVolume") or (prof or {}).get("volume") \
            or r.get("volume") or 0
        return vol * (r.get("price") or 1)

    by_cik = {}       # cik -> chosen symbol
    kept_rows = {}    # symbol -> screener row
    for r in prefiltered:
        sym = r["symbol"]
        prof = profiles.get(sym)
        if prof and prof.get("__error__"):
            exclusions.append({"symbol": sym, "reason": "profile_error"}); continue
        if (prof or {}).get("isEtf"):
            exclusions.append({"symbol": sym, "reason": "etf"}); continue
        if (prof or {}).get("isFund"):
            exclusions.append({"symbol": sym, "reason": "fund"}); continue
        cik = (prof or {}).get("cik") or f"__{sym}"
        prev = by_cik.get(cik)
        if prev is None:
            by_cik[cik] = sym; kept_rows[sym] = r
        else:
            # keep the more liquid class
            if liquidity(r, prof) > liquidity(kept_rows[prev], profiles.get(prev)):
                exclusions.append({"symbol": prev, "reason": "duplicate_share_class", "kept": sym})
                del kept_rows[prev]; by_cik[cik] = sym; kept_rows[sym] = r
            else:
                exclusions.append({"symbol": sym, "reason": "duplicate_share_class", "kept": prev})
    survivors = sorted(kept_rows.values(), key=lambda r: r.get("marketCap") or 0, reverse=True)
    print(f"  {len(survivors)} after fund/dedup filter")

    # ---- price history (validate, then rank & keep top 500) ----
    print("Fetching adjusted price histories ...")
    prices = {}

    def fetch_prices(sym):
        try:
            d = api("historical-price-eod/dividend-adjusted", symbol=sym)
            return sym, d if isinstance(d, list) else None
        except Exception as e:
            return sym, {"__error__": str(e)}

    with ThreadPoolExecutor(max_workers=12) as ex:
        for fut in as_completed([ex.submit(fetch_prices, r["symbol"]) for r in survivors]):
            sym, d = fut.result()
            prices[sym] = d

    # Build a reference trading calendar from a strong majority of tickers.
    date_counts, parsed = {}, {}
    for r in survivors:
        d = prices.get(r["symbol"])
        if not isinstance(d, list) or len(d) < HISTORY_TRADING_DAYS:
            continue
        series = {row["date"]: row.get("adjClose") for row in d
                  if row.get("adjClose") and row["adjClose"] > 0}
        parsed[r["symbol"]] = series
        for dt in list(series)[:HISTORY_TRADING_DAYS + 40]:
            date_counts[dt] = date_counts.get(dt, 0) + 1
    if not date_counts:
        raise RuntimeError("no usable price histories fetched")
    quorum = max(3, int(0.6 * len(parsed)))
    common_dates = sorted([dt for dt, c in date_counts.items() if c >= quorum],
                          reverse=True)[:HISTORY_TRADING_DAYS]
    common_dates.sort()
    if len(common_dates) < 260:
        raise RuntimeError(f"insufficient common calendar: {len(common_dates)}")
    latest = common_dates[-1]
    print(f"  reference calendar: {len(common_dates)} days {common_dates[0]}..{latest}")

    eligible = []
    for r in survivors:
        sym = r["symbol"]
        series = parsed.get(sym)
        if not series:
            exclusions.append({"symbol": sym, "reason": "invalid_price_history"}); continue
        # staleness: must have traded on (near) the latest common date
        if sym not in parsed or latest not in series:
            # tolerate a 1-2 day gap only
            recent = [d for d in common_dates[-3:] if d in series]
            if not recent:
                exclusions.append({"symbol": sym, "reason": "stale_price_data"}); continue
        closes = [series.get(dt) for dt in common_dates]
        missing = sum(1 for c in closes if not c)
        if missing > 5:
            exclusions.append({"symbol": sym, "reason": "insufficient_history", "missing": missing}); continue
        if missing:
            last = None
            for i in range(len(closes)):
                if closes[i]: last = closes[i]
                elif last: closes[i] = last
            nxt = None
            for i in range(len(closes) - 1, -1, -1):
                if closes[i]: nxt = closes[i]
                elif nxt: closes[i] = nxt
        if any(not c or c <= 0 for c in closes):
            exclusions.append({"symbol": sym, "reason": "invalid_price_history"}); continue
        # erroneous data: an implausible single-day move
        bad = max(abs(closes[i] / closes[i - 1] - 1) for i in range(1, len(closes)))
        if bad > MAX_DAILY_MOVE:
            exclusions.append({"symbol": sym, "reason": "erroneous_price_move",
                               "maxMove": round(bad, 3)}); continue
        prof = profiles.get(sym) or {}
        eligible.append({
            "symbol": sym,
            "name": r.get("companyName") or prof.get("companyName") or sym,
            "sector": r.get("sector") or prof.get("sector") or "Unknown",
            "industry": r.get("industry") or prof.get("industry") or "Unknown",
            "marketCap": r.get("marketCap") or 0,
            "exchange": r.get("exchangeShortName") or "",
            "adr": bool(prof.get("isAdr")),
            "closes": [round(c, 3) for c in closes],
        })
        if len(eligible) >= TARGET:
            break

    eligible.sort(key=lambda t: t["marketCap"], reverse=True)
    print(f"  {len(eligible)} eligible companies retained (target {TARGET})")

    # ---- universes: Top 500 + dynamic sector sub-universes ----
    sector_counts = {}
    for t in eligible:
        sector_counts[t["sector"]] = sector_counts.get(t["sector"], 0) + 1
    universes = {"us_top500": {"label": "US Top 500",
                               "note": "Largest 500 eligible common stocks & ADRs on NYSE/Nasdaq/AMEX."}}
    for sec, cnt in sorted(sector_counts.items(), key=lambda kv: -kv[1]):
        slug = SECTOR_SLUG.get(sec)
        if slug and cnt >= MIN_SECTOR_FOR_UNIVERSE:
            universes[slug] = {"label": sec, "note": f"{sec} names within the US Top 500 ({cnt})."}
    for t in eligible:
        tags = ["us_top500"]
        slug = SECTOR_SLUG.get(t["sector"])
        if slug in universes:
            tags.append(slug)
        t["universes"] = tags

    snapshot = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Financial Modeling Prep (stable API), split+dividend adjusted closes",
        "dates": common_dates,
        "universes": universes,
        "tickers": eligible,
        "exclusions": exclusions,
        "counts": {"eligible": len(eligible), "excluded": len(exclusions),
                   "tradingDays": len(common_dates)},
    }
    out = os.path.join(DATA_DIR, "snapshot.json")
    with open(out, "w") as f:
        json.dump(snapshot, f, separators=(",", ":"))
    print(f"Wrote {out} ({os.path.getsize(out)/1e6:.2f} MB), "
          f"{len(eligible)} tickers, {len(universes)} universes, {len(exclusions)} exclusions")


if __name__ == "__main__":
    main()
