"""Builds data/holdings.json (+ holdings.js): scheme details, top-3 concentration and cash %.

Sources, in order of preference:
  1. Zerodha Coin   - one bulk download with every fund: minimum investment,
                      base expense ratio, AUM (exit load and manager only as backup).
  2. Groww          - per-fund call, used for what Coin does not have (portfolio holdings,
                      min SIP, benchmark, objective, total expense ratio) and as a fallback
                      for any field Coin is missing.
Funds are matched by ISIN and keyed by their mfapi.in scheme code.

Usage:  python scripts/fetch_holdings.py [--limit N]
"""
import json, re, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "holdings.json"
UA = {"User-Agent": "Mozilla/5.0"}
COIN = "https://coin.zerodha.com"
EXCLUDE = re.compile(r"idcw|dividend(?! yield)|payout|bonus|reinvest|regular|liquid|overnight|debt|gilt|bond|money market|duration|credit|fmp|fixed|series|\betf\b|exchange traded|interval|floater|treasury|(?<!equity )savings|income|ultra|target maturity|segregated|arbitrage|capital protection|year plus|plan [ivx]+\b|gold|silver", re.I)
BS = chr(92)


STOP = False   # set when a site asks us to back off for a long time; remaining funds keep their previous data
PORT_FILE = OUT.with_name("portfolio.js")     # full holdings per fund, lazy-loaded by the app
IDS_FILE = OUT.with_name("groww_ids.json")   # cache: mfapi scheme code -> Groww search id (halves Groww calls on later runs)


def get(url, tries=3, raw=False):
    global STOP
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = r.read()
                return data.decode("utf-8", "replace") if raw else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:
                wait = int(e.headers.get("Retry-After", 60) or 60)
                if wait > 120:
                    if not STOP:
                        print(f"Rate limited by {urllib.parse.urlparse(url).netloc} (retry after {wait}s) - keeping previous data for the rest", flush=True)
                    STOP = True
                    return None
                time.sleep(wait + 1)
                continue
        except Exception:
            pass
        time.sleep(0.8 * (i + 1))
    return None


# ---------------------------------------------------------------- Zerodha Coin
def _records(js):
    """Yield every ["INF...", ...] array literal in a minified JS bundle."""
    for m in re.finditer(r'\["INF[0-9A-Z]{8}\d"', js):
        i, d, ins, j = m.start(), 0, False, m.start()
        while True:
            c = js[j]
            if ins:
                if c == BS:
                    j += 1
                elif c == '"':
                    ins = False
            elif c == '"':
                ins = True
            elif c == "[":
                d += 1
            elif c == "]":
                d -= 1
                if d == 0:
                    break
            j += 1
        t = js[i:j + 1]
        try:
            yield json.loads(t)
        except Exception:
            try:
                yield json.loads(t.replace("!0", "1").replace("!1", "0").replace("void 0", "null"))
            except Exception:
                pass


def coin_tables():
    """Return (details, nav) dicts keyed by ISIN, or ({}, {}) if Coin's site layout changed.

    details row: [isin, amc, name, min_lumpsum, _, min_additional, _, _, plan, _, type, category,
                  _, settlement, launch, _, exit_load, expense_ratio_base, _, manager, ...]
    nav row:     [isin, _, _, _, _, nav, date, 1d, 1y, 2y, 3y, 4y, 5y, aum_cr, ...]
    """
    try:
        page = get(COIN + "/mf/fund/INF879O01027", raw=True) or ""
        app = re.search(r'src="(/static/js/app\.[^"]+\.js)"', page)
        appjs = get(COIN + app.group(1), raw=True)
        pairs = set(re.findall(r'[{,](\d+):"([0-9a-f]{8})"', appjs))
        for cid, h in sorted(pairs):
            js = get(f"{COIN}/static/js/{cid}.{h}.js", tries=2, raw=True)
            if not js or '"PPFAS_MF"' not in js:
                continue
            details, nav = {}, {}
            for r in _records(js):
                if len(r) >= 20 and isinstance(r[1], str):
                    details[r[0]] = r
                elif len(r) >= 14:
                    nav[r[0]] = r
            if len(details) > 1000:
                return details, nav
    except Exception as e:
        print("Coin lookup failed:", e)
    print("WARNING: could not read Zerodha Coin data; falling back to Groww only")
    return {}, {}


def from_coin(isin, details, nav):
    d, n = details.get(isin), nav.get(isin)
    out = {}
    if d:
        out["min"] = d[3]
        out["exit"] = re.sub(r"\s+", " ", d[16] or "").strip() or None
        out["base"] = d[17]
        out["mgr"] = d[19] or None
        out["launch"] = d[14]
    if n and len(n) > 13:
        out["aum"] = n[13]
    return out


# ----------------------------------------------------------------------- Groww
def analyse(rows):
    """Groww rows: [code, date, name, kind, sector, instrument, _, value, pct, ...].
    top-3 = three largest non-derivative, non-cash positions; cash = sum of cash-type rows
    (reverse repo / TREPS / net current assets / margin)."""
    pos = sorted(([r[2], float(r[8])] for r in rows
                  if r[3] != "CASH" and r[5] != "Futures" and r[8] and float(r[8]) > 0),
                 key=lambda x: -x[1])
    top = pos[:5]
    cash = sum(float(r[8] or 0) for r in rows if r[3] == "CASH")
    # every position (equity, debt, cash, derivatives) for the "show all" page, largest first
    full = sorted(([r[2], round(float(r[8]), 2), r[5] or r[3] or ""] for r in rows if r[8] not in (None, "") and float(r[8]) != 0),
                  key=lambda x: -x[1])
    return {"d": rows[0][1], "t3": round(sum(x[1] for x in pos[:3]), 2), "top": top, "n": len(full),
            "cash": round(max(0, cash), 2), "_full": full}


def from_groww(code, name, ids):
    if STOP:
        return None
    sid = ids.get(code)
    if not sid:
        clean = re.sub(r"\s*-?\s*(direct plan|growth option|growth|direct)\b", "", name, flags=re.I).strip(" -")
        time.sleep(0.2)
        s = get("https://groww.in/v1/api/search/v1/entity?app=false&entity_type=scheme&page=0&size=5&q=" + urllib.parse.quote(clean))
        hit = next((x for x in (s or {}).get("content", []) if str(x.get("scheme_code")) == str(code)), None)
        if not hit:
            return None
        sid = ids[code] = hit["search_id"]
    time.sleep(0.2)
    d = get("https://groww.in/v1/api/data/mf/web/v1/scheme/search/" + sid)
    if not d or not d.get("holdings"):
        return None
    a = analyse(d["holdings"])
    base = next((x.get("analysis_data") for x in d.get("analysis") or [] if x.get("analysis_subject") == "base_expense_analysis"), None)
    a.update({
        "er": float(d["expense_ratio"]) if d.get("expense_ratio") is not None else None,   # total (TER)
        "base": float(base) if base not in (None, "") else None,
        "aum": round(d["aum"], 2) if d.get("aum") is not None else None,                   # Rs crore
        "exit": d.get("exit_load"), "min": d.get("min_investment_amount"),
        "sip": d.get("min_sip_investment"), "bench": d.get("benchmark_name"),
        "mgr": d.get("fund_manager"), "obj": d.get("description"),
    })
    return a


def main():
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 0
    allf = get("https://api.mfapi.in/mf")
    seen, funds = set(), []
    for x in allf:
        n = x["schemeName"]
        if not (re.search("direct", n, re.I) and re.search("growth", n, re.I)) or EXCLUDE.search(n):
            continue
        k = x.get("isinGrowth") or x["schemeCode"]
        if k not in seen:
            seen.add(k)
            funds.append(x)
    if limit:
        funds = funds[:limit]

    details, nav = coin_tables()
    print(f"Coin: {len(details)} funds · universe: {len(funds)} funds", flush=True)

    try:
        prev = json.loads(OUT.read_text("utf-8")).get("funds", {})
    except Exception:
        prev = {}

    try:
        ids = json.loads(IDS_FILE.read_text("utf-8"))
    except Exception:
        ids = {}

    def one(f):
        code = str(f["schemeCode"])
        g = from_groww(code, f["schemeName"], ids)
        c = from_coin(f.get("isinGrowth"), details, nav)
        if not g:
            return code, None, bool(c)
        # Coin wins for the fields it has, except exit load and managers: Groww's text is cleaner
        # and lists every manager, so Coin only backs those two up when Groww has nothing.
        for k, v in c.items():
            if v in (None, ""):
                continue
            if k in ("exit", "mgr") and g.get(k) not in (None, ""):
                continue
            g[k] = v
        g["src"] = "coin+groww" if c else "groww"
        return code, g, bool(c)

    try:   # previous full portfolios, kept for funds Groww fails to return this time
        prev_port = json.loads(PORT_FILE.read_text("utf-8").split("=", 1)[1].rstrip().rstrip(";"))
    except Exception:
        prev_port = {}

    out, port, done, with_coin = {}, {}, 0, 0
    with ThreadPoolExecutor(4) as ex:
        for code, a, hc in ex.map(one, funds):
            done += 1
            with_coin += hc
            if a:
                port[code] = a.pop("_full", [])
                out[code] = a
            elif code in prev:
                out[code] = prev[code]  # keep stale data rather than lose it
                if code in prev_port:
                    port[code] = prev_port[code]
            if done % 50 == 0:
                print(f"{done}/{len(funds)} ({len(out)} with holdings)", flush=True)
    OUT.parent.mkdir(exist_ok=True)
    IDS_FILE.write_text(json.dumps(ids, separators=(",", ":")), "utf-8")
    blob = json.dumps({"updated": datetime.now(timezone.utc).isoformat(), "funds": out}, separators=(",", ":"))
    OUT.write_text(blob, "utf-8")
    # same data as a script so index.html works when opened straight from disk (file:// blocks fetch)
    OUT.with_suffix(".js").write_text("window.HOLDINGS=" + blob + ";", "utf-8")
    # full position lists for the "show all" page; loaded on demand, so it is kept out of holdings.js
    PORT_FILE.write_text("window.PORTFOLIO=" + json.dumps(port, separators=(",", ":"), ensure_ascii=False) + ";", "utf-8")
    print(f"Done: {len(out)} of {len(funds)} funds written ({with_coin} matched on Coin)")


if __name__ == "__main__":
    main()
