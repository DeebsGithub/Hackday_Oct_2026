#!/usr/bin/env python3
"""Local API for the flight-risk prototype frontend (web/live.js).

Run:  python backend/api.py     -> http://localhost:8787   (PORT env overrides)

Endpoints (all GET, JSON, CORS open — the frontend is a static page):
  /api/health   -> {ok, mode, data_through, markets}              live.js init()/badge
  /api/markets  -> {markets: [...]}                               replaces sample markets
  /api/score    -> {causes, total, markets}                       base rates + intervals
                   ?carrier&flight&origin&dest&date&time
  /api/route    -> {flights, markets}                             schedule + route rates
                   ?origin&dest&date
  /api/database -> {ok, origin, dest, date, delayed_or_cancelled}
                   ?origin&dest&date            load_rows.load_database() on submit

Markets are applied client-side (score.js), so /api/score returns historical
base rates per cause plus the markets that match the flight, and the frontend
mixes them in. That keeps market toggles / Trip Watch scrubbing round-trip free.

Two stores, chosen automatically:
  * SnowflakeStore — real data via the SNOWFLAKE_* vars from envexample (.env).
    Queries the Cirium OTP view (CIRIUM_FLIGHT_DATA.PUBLIC.FLIGHTS, unqualified
    "FLIGHTS" over the connection context). Cirium has no cancellation-cause
    codes, so the overall rate is split by the global cause mix until BTS is
    loaded; prediction markets come from SNOWFLAKE_MARKETS_TABLE when it exists.
  * SampleStore — a Python port of the sample model in web/data.js + web/score.js
    (same constants, same nested-shrinkage math), so the whole stack runs with
    zero setup. Snowflake errors fall back here per-request.
"""

import ast
import json
import math
import os
import re
import sys
import threading
import time
import traceback
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    from dotenv import load_dotenv
except ImportError:  # .env support is optional
    load_dotenv = None

ROOT = Path(__file__).resolve().parent.parent
if load_dotenv:
    load_dotenv(ROOT / ".env")

try:
    from snowflake import connector as sf_connector
except ImportError:
    sf_connector = None

# load_rows.py sits at the repo root (one level above backend/); it brings its
# own Snowflake connection and needs snowflake-connector-python + python-dotenv.
sys.path.insert(0, str(ROOT))
try:
    from load_rows import FlightRequest, load_database
except Exception as _e:  # optional: /api/database answers 503 without it
    FlightRequest, load_database = None, None
    print(f"[warn] load_rows.load_database unavailable: {_e}", file=sys.stderr)

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8787"))
FLIGHTS_TABLE = os.environ.get("SNOWFLAKE_FLIGHTS_TABLE", "FLIGHTS")  # CIRIUM_FLIGHT_DATA.PUBLIC.FLIGHTS via .env
MARKETS_TABLE = os.environ.get("SNOWFLAKE_MARKETS_TABLE", "")  # optional, e.g. FLIGHT_RISK.SCORE.MARKET_LATEST
WEB_DIR = ROOT / "web"

CAUSE_CODES = ["B", "A", "C", "D"]  # weather, carrier, air traffic, security (BTS codes)


class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class StoreUnavailable(Exception):
    pass


# ---------------------------------------------------------------------------
# JS-compatible math (ports of web/score.js) so sample numbers line up
# ---------------------------------------------------------------------------

def js_hash(s):
    """FNV-1a as in score.js: 32-bit mix, normalized to [0, 1)."""
    h = 2166136261
    for ch in s.encode("utf-8"):
        h ^= ch
        h = (h * 16777619) & 0xFFFFFFFF
    return h / 4294967295


def js_round(x):
    """JS Math.round (half away from zero); all values here are positive."""
    return math.floor(x + 0.5)


def jitter(key, spread):
    return math.exp((js_hash(key) - 0.5) * 2 * spread)


def beta_interval(a, b):
    """Beta(a, b) 5%/95% bounds, ported from betaInterval in score.js."""
    if a + b <= 0:
        return 0.0, 0.0
    m = a / (a + b)
    if m <= 0:
        return 0.0, 0.0
    if a < 3:
        n = a + b
        return m * max(0.05, a / 6), min(1.0, (a + 1.645 * math.sqrt(a) + 1.2) / n)
    sd = math.sqrt(1 / a + 1 / b)
    lg = math.log(m / (1 - m))
    return _logistic(lg - 1.645 * sd), _logistic(lg + 1.645 * sd)


def _logistic(x):
    return 1 / (1 + math.exp(-x))


def season_of(month):
    if month in (12, 1, 2):
        return "winter"
    if month in (6, 7, 8, 9):
        return "summer"
    return "shoulder"


def band_of(hour):
    return "AM" if hour < 10 else "MID" if hour < 16 else "PM"


# ---------------------------------------------------------------------------
# Sample data (ported from web/data.js)
# ---------------------------------------------------------------------------

GLOBAL_RATE = {"A": 0.0062, "B": 0.0058, "C": 0.0024, "D": 0.00008}

# code -> (name, {cause: multiplier}, volume)
CARRIERS = {
    "UA": ("United", {"A": 1.05, "B": 1.0, "C": 1.15, "D": 1}, 1.0),
    "DL": ("Delta", {"A": 0.55, "B": 0.85, "C": 0.9, "D": 1}, 1.0),
    "AA": ("American", {"A": 1.1, "B": 1.05, "C": 1.0, "D": 1}, 1.0),
    "WN": ("Southwest", {"A": 1.25, "B": 1.1, "C": 0.85, "D": 1}, 1.1),
    "B6": ("JetBlue", {"A": 1.4, "B": 1.2, "C": 1.35, "D": 1}, 0.45),
    "AS": ("Alaska", {"A": 0.8, "B": 0.9, "C": 0.8, "D": 1}, 0.4),
    "NK": ("Spirit", {"A": 1.7, "B": 1.1, "C": 1.1, "D": 1}, 0.3),
    "F9": ("Frontier", {"A": 1.6, "B": 1.15, "C": 1.0, "D": 1}, 0.25),
    "OO": ("SkyWest", {"A": 1.3, "B": 1.35, "C": 1.2, "D": 1}, 0.6),
    "HA": ("Hawaiian", {"A": 0.6, "B": 0.6, "C": 0.5, "D": 1}, 0.25),
    "G4": ("Allegiant", {"A": 1.9, "B": 1.1, "C": 0.9, "D": 1}, 0.25),
    "SY": ("Sun Country", {"A": 1.3, "B": 1.2, "C": 0.9, "D": 1}, 0.1),
    "MX": ("Breeze", {"A": 1.8, "B": 1.1, "C": 1.0, "D": 1}, 0.1),
    "MQ": ("Envoy (American Eagle)", {"A": 1.5, "B": 1.4, "C": 1.3, "D": 1}, 0.35),
    "YX": ("Republic", {"A": 1.35, "B": 1.35, "C": 1.4, "D": 1}, 0.35),
    "9E": ("Endeavor (Delta Connection)", {"A": 1.1, "B": 1.3, "C": 1.2, "D": 1}, 0.3),
    "OH": ("PSA (American Eagle)", {"A": 1.6, "B": 1.3, "C": 1.2, "D": 1}, 0.3),
    "QX": ("Horizon (Alaska)", {"A": 1.0, "B": 1.3, "C": 0.8, "D": 1}, 0.15),
}

# Hand-tuned airports in data.js; the rest are derived from lat/lon/hub as in data.js
_TUNED = {
    "ORD": (2.4, 1.3, 1.3), "LGA": (1.9, 1.6, 1.8), "EWR": (1.8, 1.7, 2.0),
    "JFK": (1.7, 1.4, 1.5), "BOS": (2.2, 1.0, 1.2), "DEN": (2.0, 1.1, 1.0),
    "ATL": (1.0, 1.3, 1.1), "DFW": (1.3, 1.4, 1.0), "MIA": (0.5, 1.6, 0.9),
    "MCO": (0.5, 1.5, 0.9), "SFO": (1.1, 0.6, 1.4), "LAX": (0.6, 0.5, 1.0),
    "SEA": (1.2, 0.5, 0.9),
}

KAPPA = {"carrier": 1000, "carrier_origin": 300, "carrier_route": 200,
         "route_season": 150, "flight": 300}
LEVELS = ["carrier", "carrier_origin", "carrier_route", "route_season", "flight"]

# API-shaped market rows (what toMarket in live.js consumes)
MARKETS = [
    {"market_id": "ord-snow", "title": "Snow ≥ 6″ at O’Hare", "venue": "kalshi",
     "cause": "B", "q": 0.34, "q_market": 0.34, "q_hist": 0.06, "lift": 4.2,
     "liquidity": 182000, "window_start": "2026-12-13", "window_end": "2026-12-15",
     "scope_type": "airport", "scope_value": "ORD",
     "history": [0.08, 0.09, 0.09, 0.12, 0.12, 0.13, 0.15, 0.14, 0.18, 0.21, 0.24, 0.29, 0.31, 0.34, 0.34]},
    {"market_id": "nyc-tstorm", "title": "NYC ground stop for thunderstorms", "venue": "polymarket",
     "cause": "B", "q": 0.07, "q_market": 0.07, "q_hist": 0.04, "lift": 3.1,
     "liquidity": 54000, "window_start": "2026-12-13", "window_end": "2026-12-15",
     "scope_type": "airport", "scope_value": "LGA EWR JFK",
     "history": [0.04, 0.04, 0.05, 0.05, 0.04, 0.05, 0.06, 0.06, 0.05, 0.06, 0.07, 0.07, 0.07, 0.07, 0.07]},
    {"market_id": "den-wind", "title": "Denver gusts over 50 mph", "venue": "kalshi",
     "cause": "B", "q": 0.41, "q_market": 0.41, "q_hist": 0.12, "lift": 2.3,
     "liquidity": 97000, "window_start": "2026-11-02", "window_end": "2026-11-04",
     "scope_type": "airport", "scope_value": "DEN",
     "history": [0.14, 0.15, 0.13, 0.17, 0.2, 0.22, 0.25, 0.24, 0.28, 0.33, 0.35, 0.38, 0.4, 0.41, 0.41]},
    {"market_id": "fl-storm", "title": "Named storm landfall in Florida", "venue": "polymarket",
     "cause": "B", "q": 0.22, "q_market": 0.22, "q_hist": 0.05, "lift": 7.5,
     "liquidity": 410000, "window_start": "2026-10-08", "window_end": "2026-10-12",
     "scope_type": "airport", "scope_value": "MIA MCO",
     "history": [0.05, 0.06, 0.06, 0.08, 0.11, 0.1, 0.12, 0.15, 0.17, 0.19, 0.18, 0.2, 0.21, 0.22, 0.22]},
    {"market_id": "bos-noreaster", "title": "Nor’easter closes Logan", "venue": "kalshi",
     "cause": "B", "q": 0.11, "q_market": 0.11, "q_hist": 0.04, "lift": 9.0,
     "liquidity": 38000, "window_start": "2027-01-06", "window_end": "2027-01-08",
     "scope_type": "airport", "scope_value": "BOS",
     "history": [0.03, 0.04, 0.04, 0.05, 0.05, 0.06, 0.07, 0.07, 0.08, 0.09, 0.1, 0.1, 0.11, 0.11, 0.11]},
    {"market_id": "shutdown", "title": "Federal shutdown in effect", "venue": "kalshi",
     "cause": "C", "q": 0.18, "q_market": 0.18, "q_hist": 0.03, "lift": 1.6,
     "liquidity": 900000, "window_start": "2026-10-15", "window_end": "2026-12-31",
     "scope_type": "national", "scope_value": None,
     "history": [0.3, 0.28, 0.27, 0.25, 0.26, 0.24, 0.22, 0.21, 0.2, 0.2, 0.19, 0.18, 0.18, 0.18, 0.18]},
]


def _load_airports():
    """Airport weather/congestion factors, mirroring web/data.js's derivation.

    web/airports.js is a plain array-of-arrays, valid as a Python literal.
    """
    out = {}
    try:
        text = (WEB_DIR / "airports.js").read_text()
        start = text.index("[", text.index("FP_AIRPORTS"))
        rows = ast.literal_eval(text[start:text.rindex("]") + 1])
    except Exception as e:
        print(f"[warn] could not read {WEB_DIR / 'airports.js'}: {e}", file=sys.stderr)
        return out
    for code, _city, _state, _name, lat, lon, hub in rows:
        if code in _TUNED:
            winter, summer, nas = _TUNED[code]
        else:
            island = lon < -150 or lat < 20
            winter = 0.4 if island else min(2.4, max(0.35, 0.35 + (lat - 27) * 0.11))
            summer = 0.5 if island else (1.5 if (lon > -103 and lat < 35) else 1.25 if lon > -103 else 0.6)
            nas = (0.85, 0.95, 1.15)[int(hub)]
        out[code] = {"winter": winter, "summer": summer, "nas": nas, "hub": int(hub)}
    return out


AIRPORTS = _load_airports()
_NEUTRAL_AIRPORT = {"winter": 1.0, "summer": 1.0, "nas": 1.0, "hub": 1}


def airport(code):
    return AIRPORTS.get(code, _NEUTRAL_AIRPORT)


def markets_matching(markets, origin, dest, date):
    """marketsFor() from score.js: date inside the window, scope hits origin/dest or national."""
    out = []
    for m in markets:
        if not (m["window_start"] <= date <= m["window_end"]):
            continue
        if m["scope_type"] == "national":
            out.append(m)
            continue
        aps = str(m["scope_value"] or "").split()
        if origin in aps or dest in aps:
            out.append(m)
    return out


# ---------------------------------------------------------------------------
# Sample store: the web/score.js model, server-side
# ---------------------------------------------------------------------------

class SampleStore:
    name = "sample"
    _score_cache = {}
    _route_cache = {}

    def health(self):
        # BTS lands ~2 months behind (design doc); show the same horizon in sample mode
        through = (date.today() - timedelta(days=60)).strftime("%b %Y")
        return {"ok": True, "mode": self.name, "data_through": through, "markets": len(MARKETS)}

    def markets(self):
        return MARKETS

    def score(self, carrier, flight, origin, dest, date, time):
        key = (carrier, flight, origin, dest, date, time)
        if key in self._score_cache:
            return self._score_cache[key]
        parent, last, total = self._walk(carrier, flight, origin, dest, date, time)
        result = {
            "causes": [{"cause": k, "base": parent[k], "lo": lo, "hi": hi, "level": "flight"}
                       for k, (lo, hi) in ((k, beta_interval(*last[k])) for k in CAUSE_CODES)],
            "total": {"lo": total[0], "hi": total[1]},
            "markets": markets_matching(MARKETS, origin, dest, date),
        }
        self._score_cache[key] = result
        return result

    def route(self, origin, dest, date):
        key = (origin, dest, date)
        if key in self._route_cache:
            return self._route_cache[key]
        oa, da = airport(origin), airport(dest)
        flights = []
        for code, (_name, _mult, volume) in CARRIERS.items():
            k = f"{code}-{origin}-{dest}"
            reach = min(0.95, 0.12 + 0.18 * (oa["hub"] + da["hub"]) * volume)
            if js_hash(k + "serves") > reach:
                continue
            n = max(1, js_round((0.6 + oa["hub"] + da["hub"]) * volume * (0.6 + js_hash(k + "freq"))))
            first = 360 + js_round(js_hash(k + "first") * 60)
            gap = (1290 - first) // max(n, 1)
            wide = len(code) == 2 and any(c.isdigit() for c in code)
            for i in range(n):
                dep = js_round((first + i * gap + js_hash(f"{k}{i}") * min(gap, 60) * 0.6) / 5) * 5
                num = str(math.floor(100 + js_hash(f"{k}no{i}") * (5800 if wide else 2800)))
                t = f"{dep // 60:02d}:{dep % 60:02d}"
                rates, _last, _total = self._walk(code, num, origin, dest, date, t)
                flights.append({"carrier": code, "flight": num, "time": t, "rates": rates})
        result = {"flights": flights, "markets": markets_matching(MARKETS, origin, dest, date)}
        self._route_cache[key] = result
        return result

    # -- the nested-shrinkage walk from score.js ------------------------------

    def _walk(self, carrier, flight, origin, dest, date, time):
        """Walk global -> carrier -> ... -> flight.

        Returns (posterior rate per cause, (alpha, beta) per cause at the
        deepest level, (lo, hi) interval for the total).
        """
        month, hour = int(date[5:7]), int(time[:2])
        season, band = season_of(month), band_of(hour)
        band_mult = {"AM": 0.8, "MID": 1.0, "PM": 1.3}[band]
        _name, mult, volume = CARRIERS.get(carrier, (carrier, {k: 1 for k in CAUSE_CODES}, 0.5))
        o, d = airport(origin), airport(dest)

        def wx(a):
            return ((a["winter"] + a["summer"]) / 2) * 0.7 if season == "shoulder" else a[season]

        route = f"{carrier}-{origin}-{dest}"
        flight_key = f"{route}-{flight}"

        def truth(lvl, k):
            r = GLOBAL_RATE[k] * mult[k]
            if lvl == "carrier":
                return r
            if k == "B":
                r *= math.sqrt(wx(o) * 1.2)
            if k == "C":
                r *= o["nas"]
            if lvl == "carrier_origin":
                return r
            if k == "B":
                r *= math.sqrt(wx(d) / 1.2)
            if k == "C":
                r *= math.sqrt(d["nas"])
            r *= jitter(route + k, 0.25)
            if lvl == "carrier_route":
                return r
            r *= math.sqrt(wx(o)) * band_mult if k == "B" else band_mult
            if lvl == "route_season":
                return r
            return r * jitter(flight_key + k, 0.5)

        n_flights = {
            "carrier": js_round(620000 * volume),
            "carrier_origin": js_round(48000 * volume * (0.6 + js_hash(origin))),
            "carrier_route": js_round(2400 + 6000 * js_hash(route)),
            "route_season": js_round(140 + 260 * js_hash(f"{route}{month}{band}")),
            "flight": js_round(18 + 70 * js_hash(flight_key)),
        }

        parent = dict(GLOBAL_RATE)
        last = {}
        for lvl in LEVELS:
            n, kappa = n_flights[lvl], KAPPA[lvl]
            post = {}
            for k in CAUSE_CODES:
                c = js_round(n * truth(lvl, k) * jitter(lvl + flight_key + k + "obs", 0.15))
                alpha = c + kappa * parent[k]
                beta = (n - c) + kappa * (1 - parent[k])
                post[k] = alpha / (n + kappa)
                last[k] = (alpha, beta)
            parent = post

        a_tot = sum(last[k][0] for k in CAUSE_CODES)
        b_tot = last["A"][0] + last["A"][1] - a_tot
        return parent, last, beta_interval(a_tot, b_tot)


# ---------------------------------------------------------------------------
# Snowflake store: runs against the real Cirium schema
# (CIRIUM_FLIGHT_DATA.PUBLIC.FLIGHTS — the only flight table in the account).
#
# Cirium has no cancellation-cause codes, so the overall cancel rate is split
# across causes A/B/C/D by the global cause mix until BTS causes are loaded.
# When FLIGHT_RISK.STG.FLIGHTS exists (design doc §4), point
# SNOWFLAKE_FLIGHTS_TABLE at it and adjust COL below.
# Count windows are relative to the data horizon (MAX(FLIGHT_DATE_LOCAL)), not
# CURRENT_DATE, so partial loads still return something.
# ---------------------------------------------------------------------------

class SnowflakeStore:
    name = "snowflake"
    RECENT_DAYS = 1095  # 3-year window, per the design doc
    SCHEDULE_DAYS = 90

    COL = {
        "carrier": "OPERATING_CARRIER_ID",
        "flight": "FLIGHT_NUMBER",
        "origin": "DEPARTURE_AIRPORT_ID",
        "dest": "ARRIVAL_AIRPORT_ID",
        "date": "FLIGHT_DATE_LOCAL",
        "cancelled": "IFF(IS_CANCELLED, 1, 0)",
        "hour_band": ("CASE WHEN HOUR(SCHEDULED_GATE_DEPARTURE_LOCAL) < 10 THEN 'AM' "
                      "WHEN HOUR(SCHEDULED_GATE_DEPARTURE_LOCAL) < 16 THEN 'MID' ELSE 'PM' END"),
        "month": "MONTH(FLIGHT_DATE_LOCAL)",
    }
    MIX = {k: v / sum(GLOBAL_RATE.values()) for k, v in GLOBAL_RATE.items()}

    def __init__(self):
        self._conn = None
        self._down_until = 0.0
        self._health = None
        self._health_at = 0.0
        self._horizon = None
        self._markets = None
        self._carrier_counts = None

    # -- plumbing ------------------------------------------------------------

    def _connect(self):
        if self._conn is not None:
            return self._conn
        if sf_connector is None:
            raise StoreUnavailable("snowflake-connector-python not installed")
        try:
            cfg = {k: os.environ[f"SNOWFLAKE_{k.upper()}"]
                   for k in ("account", "user", "password", "role", "warehouse", "database", "schema")}
        except KeyError as e:
            raise StoreUnavailable(f"missing {e.args[0]} in environment/.env")
        self._conn = sf_connector.connect(login_timeout=5, network_timeout=5, **cfg)
        return self._conn

    def _reset(self, why):
        self._down_until = time.time() + 60  # stop hammering a dead warehouse
        self._health = None
        try:
            if self._conn is not None:
                self._conn.close()
        except Exception:
            pass
        self._conn = None
        print(f"[warn] snowflake unavailable: {why}; using sample store for 60s", file=sys.stderr)

    def _query(self, sql, params=()):
        try:
            conn = self._connect()
            cur = conn.cursor()
            try:
                cur.execute(sql, params)
                cols = [d[0].lower() for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]
            finally:
                cur.close()
        except StoreUnavailable:
            raise
        except Exception as e:
            self._reset(str(e))
            raise

    def horizon(self):
        """Latest flight date loaded (cached) — the data horizon."""
        if self._horizon is None:
            row = self._query(f"SELECT MAX({self.COL['date']}) AS d FROM {FLIGHTS_TABLE}")[0]
            self._horizon = row["d"]
        return self._horizon

    # -- endpoints -----------------------------------------------------------

    def available(self):
        """Health probe, cached. Serves the last good result instantly and
        refreshes in the background (the frontend's health timeout is 2.5s,
        and a cold Snowflake connect alone can take longer than that)."""
        if time.time() < self._down_until:
            return None
        if self._health:
            if time.time() - self._health_at > 60:
                threading.Thread(target=self._refresh_health, daemon=True).start()
            return self._health
        try:
            return self._refresh_health()
        except Exception:
            return None

    def _refresh_health(self):
        horizon = self.horizon()
        through = horizon.strftime("%b %Y") if hasattr(horizon, "strftime") else str(horizon)
        self._health = {"ok": True, "mode": self.name, "data_through": through,
                        "markets": len(self.markets())}
        self._health_at = time.time()
        return self._health

    def markets(self):
        """MARKET_LATEST rows when configured; the sample markets otherwise."""
        if self._markets is not None:
            return self._markets
        if MARKETS_TABLE:
            try:
                rows = self._query(f"""
                    SELECT market_id, title, venue, cause, q, q_market, q_hist, lift, liquidity,
                           window_start, window_end, scope_type, scope_value, history
                    FROM {MARKETS_TABLE}""")
                self._markets = [self._market_row(r) for r in rows]
                return self._markets
            except Exception as e:
                print(f"[warn] {MARKETS_TABLE} unreadable ({e}); using sample markets", file=sys.stderr)
        self._markets = MARKETS
        return self._markets

    @staticmethod
    def _market_row(r):
        hist = r.get("history")
        if isinstance(hist, str):
            hist = json.loads(hist)
        ws, we = r["window_start"], r["window_end"]
        return {
            "market_id": str(r["market_id"]),
            "title": r["title"],
            "venue": str(r["venue"] or "").lower(),
            "cause": r["cause"],
            "q": float(r["q"] or 0), "q_market": float(r["q_market"] or 0),
            "q_hist": float(r["q_hist"] or 0), "lift": float(r["lift"] or 1),
            "liquidity": float(r["liquidity"] or 0),
            "window_start": ws.isoformat() if hasattr(ws, "isoformat") else str(ws),
            "window_end": we.isoformat() if hasattr(we, "isoformat") else str(we),
            "scope_type": r["scope_type"], "scope_value": r["scope_value"],
            "history": hist or [],
        }

    def _counts(self, where="1=1", params=()):
        """(legs, cancels) for a hierarchy cell, last 3 years of loaded data."""
        c = self.COL
        rows = self._query(f"""
            SELECT COUNT(*) AS n_legs, SUM({c['cancelled']}) AS n_cxl
            FROM {FLIGHTS_TABLE}
            WHERE {c['date']} >= DATEADD(day, {self.RECENT_DAYS * -1}, %s) AND {where}
            """, (self.horizon(), *params))
        r = rows[0] if rows else {}
        return int(r.get("n_legs") or 0), int(r.get("n_cxl") or 0)

    def score(self, carrier, flight, origin, dest, date, time):
        hour = int(time[:2])
        band = "AM" if hour < 10 else "MID" if hour < 16 else "PM"
        c = self.COL
        levels = [
            ("carrier", f"{c['carrier']} = %s", (carrier,)),
            ("carrier_origin", f"{c['carrier']} = %s AND {c['origin']} = %s", (carrier, origin)),
            ("carrier_route", f"{c['carrier']} = %s AND {c['origin']} = %s AND {c['dest']} = %s",
             (carrier, origin, dest)),
            ("route_season",
             f"{c['carrier']} = %s AND {c['origin']} = %s AND {c['dest']} = %s AND {c['month']} = %s AND {c['hour_band']} = %s",
             (carrier, origin, dest, int(date[5:7]), band)),
            ("flight",
             f"{c['carrier']} = %s AND {c['origin']} = %s AND {c['dest']} = %s AND {c['flight']} = %s",
             (carrier, origin, dest, flight)),
        ]
        n_all, c_all = self._counts()
        parent = (c_all / n_all) if n_all else sum(GLOBAL_RATE.values())
        deepest, last = "global", (0.0, 0.0)
        for lvl, where, params in levels:
            n, cxl = self._counts(where, params)
            kappa = KAPPA[lvl]
            if n > 0:
                deepest = lvl
            alpha = cxl + kappa * parent
            beta = n - cxl + kappa * (1 - parent)
            last, parent = (alpha, beta), alpha / (n + kappa)
        lo, hi = beta_interval(*last)
        causes = [{"cause": k, "base": parent * self.MIX[k], "lo": lo * self.MIX[k],
                   "hi": hi * self.MIX[k], "level": deepest} for k in CAUSE_CODES]
        return {"causes": causes, "total": {"lo": lo, "hi": hi},
                "markets": markets_matching(self.markets(), origin, dest, date)}

    def route(self, origin, dest, date):
        c = self.COL
        horizon = self.horizon()
        sched = self._query(f"""
            SELECT {c['carrier']} AS carrier, {c['flight']} AS flight_no,
                   MIN(HOUR(SCHEDULED_GATE_DEPARTURE_LOCAL)) AS dep_hour
            FROM {FLIGHTS_TABLE}
            WHERE {c['origin']} = %s AND {c['dest']} = %s
              AND {c['date']} >= DATEADD(day, {self.SCHEDULE_DAYS * -1}, %s)
            GROUP BY 1, 2""", (origin, dest, horizon))
        # Route-level cancel counts by carrier (recent 3y of loaded data) ...
        route_rows = self._query(f"""
            SELECT {c['carrier']} AS carrier, COUNT(*) AS n_legs, SUM({c['cancelled']}) AS n_cxl
            FROM {FLIGHTS_TABLE}
            WHERE {c['origin']} = %s AND {c['dest']} = %s
              AND {c['date']} >= DATEADD(day, {self.RECENT_DAYS * -1}, %s)
            GROUP BY 1""", (origin, dest, horizon))
        # ... shrunk toward each carrier's own overall rate
        if self._carrier_counts is None:
            self._carrier_counts = self._query(f"""
                SELECT {c['carrier']} AS carrier, COUNT(*) AS n_legs, SUM({c['cancelled']}) AS n_cxl
                FROM {FLIGHTS_TABLE}
                WHERE {c['date']} >= DATEADD(day, {self.RECENT_DAYS * -1}, %s)
                GROUP BY 1""", (horizon,))
        carrier_parent = {str(r["carrier"]).upper(): (int(r["n_cxl"] or 0), int(r["n_legs"] or 0))
                          for r in self._carrier_counts}
        kappa = KAPPA["carrier_route"]
        global_total = sum(GLOBAL_RATE.values())

        def rates_for(code):
            cxl_c, n_c = carrier_parent.get(code, (0, 0))
            parent = (cxl_c / n_c) if n_c else global_total
            rc = next((r for r in route_rows if str(r["carrier"]).upper() == code), None)
            n, cxl = (int(rc["n_legs"] or 0), int(rc["n_cxl"] or 0)) if rc else (0, 0)
            rate = (cxl + kappa * parent) / (n + kappa)
            return {k: rate * self.MIX[k] for k in CAUSE_CODES}

        flights = [{"carrier": str(r["carrier"]).upper(), "flight": str(r["flight_no"]),
                    "time": f"{int(r['dep_hour'] or 12):02d}:00",
                    "rates": rates_for(str(r["carrier"]).upper())} for r in sched]
        return {"flights": flights, "markets": markets_matching(self.markets(), origin, dest, date)}


SAMPLE = SampleStore()
SNOWFLAKE = SnowflakeStore()


def active_store():
    return SNOWFLAKE if SNOWFLAKE.available() else SAMPLE


def call_store(method, *args):
    """Run a store method with per-request fallback to the sample store."""
    store = active_store()
    try:
        return getattr(store, method)(*args)
    except Exception as e:
        if store is SAMPLE:
            raise
        print(f"[warn] snowflake {method} failed ({e}); serving sample data", file=sys.stderr)
        return getattr(SAMPLE, method)(*args)


# ---------------------------------------------------------------------------
# load_rows bridge: /api/database -> load_rows.load_database()
# ---------------------------------------------------------------------------

_DB_CACHE = {}  # (origin, dest, date) -> rate


def database_rate(origin, dest, date_str):
    """Share of legs on the route delayed-or-cancelled, via load_rows.load_database.

    load_database() interpolates its params straight into SQL, so only values
    that passed the param() regexes (3-letter airports, ISO date) ever reach
    it. It opens a fresh Snowflake connection per call, so results are cached
    per route+date.
    """
    if load_database is None:
        raise HttpError(503, "load_rows unavailable (needs snowflake-connector-python and python-dotenv)")
    key = (origin, dest, date_str)
    if key not in _DB_CACHE:
        try:
            request = FlightRequest(
                departing_airport=origin,
                arriving_airport=dest,
                departure_date=date.fromisoformat(date_str),
            )
            _DB_CACHE[key] = load_database(request)
        except Exception as e:
            if "No data found" in str(e):
                raise HttpError(404, f"no flights for {origin}->{dest} in the database")
            traceback.print_exc()
            raise HttpError(502, f"load_database failed: {type(e).__name__}: {e}")
    return _DB_CACHE[key]


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

RE_CARRIER = re.compile(r"^[A-Z0-9]{2,3}$")
RE_FLIGHT = re.compile(r"^\d{1,4}$")
RE_AIRPORT = re.compile(r"^[A-Z]{3}$")
RE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RE_TIME = re.compile(r"^\d{2}:\d{2}$")


def param(query, name, pattern, example):
    vals = query.get(name)
    if not vals:
        raise HttpError(400, f"missing required parameter '{name}'")
    v = vals[0].strip().upper()
    if not pattern.match(v):
        raise HttpError(400, f"bad {name} {vals[0]!r} (expected e.g. {example})")
    return v


def main():
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "flight-risk-api/1.0"

        def _send(self, status, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # client gave up (e.g. its own timeout); nothing to do

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            started = time.time()
            url = urlparse(self.path)
            query = parse_qs(url.query)
            status = 200
            try:
                payload = self.route(url.path, query)
            except HttpError as e:
                status, payload = e.status, {"error": str(e)}
            except Exception as e:
                traceback.print_exc()
                status, payload = 500, {"error": f"{type(e).__name__}: {e}"}
            self._send(status, payload)
            print(f"{self.client_address[0]} GET {url.path} -> {status} ({(time.time() - started) * 1000:.0f}ms)")

        def route(self, path, query):
            if path == "/api/health":
                return SNOWFLAKE.available() or SAMPLE.health()
            if path == "/api/markets":
                return {"markets": call_store("markets")}
            if path == "/api/score":
                args = (
                    param(query, "carrier", RE_CARRIER, "UA"),
                    param(query, "flight", RE_FLIGHT, "1423"),
                    param(query, "origin", RE_AIRPORT, "ORD"),
                    param(query, "dest", RE_AIRPORT, "LGA"),
                    param(query, "date", RE_DATE, "2026-12-14"),
                    param(query, "time", RE_TIME, "07:05"),
                )
                return call_store("score", *args)
            if path == "/api/route":
                args = (
                    param(query, "origin", RE_AIRPORT, "ORD"),
                    param(query, "dest", RE_AIRPORT, "LGA"),
                    param(query, "date", RE_DATE, "2026-12-14"),
                )
                return call_store("route", *args)
            if path == "/api/database":
                args = (
                    param(query, "origin", RE_AIRPORT, "PHX"),
                    param(query, "dest", RE_AIRPORT, "LAX"),
                    param(query, "date", RE_DATE, "2026-10-04"),
                )
                return {"ok": True, "origin": args[0], "dest": args[1], "date": args[2],
                        "delayed_or_cancelled": database_rate(*args)}
            raise HttpError(404, f"no such endpoint: {path}")

        def log_message(self, *args):  # quieten the default stderr spam
            pass

    class Server(ThreadingHTTPServer):
        daemon_threads = True

    def make_server():
        import socket

        # Dual-stack (accepts IPv6 and IPv4) so 'localhost' works for every client;
        # V6ONLY must be cleared before the socket is bound.
        class V6Server(ThreadingHTTPServer):
            address_family = socket.AF_INET6
            daemon_threads = True

            def server_bind(self):
                try:
                    self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
                except OSError:
                    pass
                super().server_bind()

        class V4Server(ThreadingHTTPServer):
            daemon_threads = True

        try:
            return V6Server(("::", PORT), Handler), "::"
        except OSError:
            return V4Server((HOST, PORT), Handler), HOST

    httpd, bound = make_server()
    print(f"flight-risk API on http://{bound}:{PORT}  "
          f"(snowflake: {FLIGHTS_TABLE} / {MARKETS_TABLE or 'sample markets'}; sample fallback ready)")
    print("frontend expects this origin (web/live.js BASE); ctrl-c to stop")
    threading.Thread(target=SNOWFLAKE.available, daemon=True).start()  # prewarm the Snowflake connection
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
