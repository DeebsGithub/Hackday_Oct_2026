#!/usr/bin/env python3
"""HTTP API for the FlightPredictor frontend.

The API serves only Snowflake-backed route results. It does not generate or
substitute sample data when Snowflake is unavailable.
"""

import ast
import json
import os
import re
import sys
import time
import traceback
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
if load_dotenv:
    load_dotenv(ROOT / ".env")

sys.path.insert(0, str(ROOT))
try:
    from load_rows import FlightRequest, load_database
    LOAD_ERROR = None
except Exception as error:
    FlightRequest, load_database = None, None
    LOAD_ERROR = error

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8787"))
RE_AIRPORT = re.compile(r"^[A-Z]{3}$")
RE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DB_CACHE = {}


class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def load_airports():
    """Load airport reference metadata for the form; no risk values are stored."""
    try:
        text = (WEB_DIR / "airports.js").read_text(encoding="utf-8")
        start = text.index("[", text.index("FP_AIRPORTS"))
        rows = ast.literal_eval(text[start:text.rindex("]") + 1])
    except Exception as error:
        raise RuntimeError(f"could not load airport catalog: {error}") from error
    return [
        {"code": code, "city": city, "state": state, "name": name,
         "lat": lat, "lon": lon, "hub": int(hub)}
        for code, city, state, name, lat, lon, hub in rows
    ]


AIRPORTS = load_airports()


def param(query, name, pattern, example):
    values = query.get(name)
    if not values:
        raise HttpError(400, f"missing required parameter '{name}'")
    value = values[0].strip().upper()
    if not pattern.fullmatch(value):
        raise HttpError(400, f"bad {name} {values[0]!r} (expected e.g. {example})")
    return value


def database_rate(origin, dest, date_str):
    if load_database is None:
        detail = f": {LOAD_ERROR}" if LOAD_ERROR else ""
        raise HttpError(503, f"Snowflake loader is unavailable{detail}")
    key = (origin, dest, date_str)
    if key not in _DB_CACHE:
        try:
            request = FlightRequest(
                departing_airport=origin,
                arriving_airport=dest,
                departure_date=date.fromisoformat(date_str),
            )
            value = load_database(request)
            if not isinstance(value, (int, float)):
                raise ValueError("database result was not numeric")
            _DB_CACHE[key] = float(value)
        except Exception as error:
            if "No data found" in str(error):
                raise HttpError(404, f"no flights for {origin}->{dest} in Snowflake")
            traceback.print_exc()
            raise HttpError(502, f"Snowflake query failed: {type(error).__name__}: {error}")
    return _DB_CACHE[key]


def main():
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"
        server_version = "flight-predictor-api/2.0"

        def send_json(self, status, payload):
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
                pass

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
            try:
                payload = self.route(url.path, parse_qs(url.query))
                status = 200
            except HttpError as error:
                status, payload = error.status, {"error": str(error)}
            except Exception as error:
                traceback.print_exc()
                status, payload = 500, {"error": f"{type(error).__name__}: {error}"}
            self.send_json(status, payload)
            print(f"{self.client_address[0]} GET {url.path} -> {status} ({(time.time() - started) * 1000:.0f}ms)")

        def route(self, path, query):
            if path == "/api/health":
                if load_database is None:
                    raise HttpError(503, "Snowflake loader is unavailable")
                return {"ok": True, "mode": "snowflake"}
            if path == "/api/catalog":
                return {"airports": AIRPORTS}
            if path == "/api/database":
                origin = param(query, "origin", RE_AIRPORT, "PHX")
                dest = param(query, "dest", RE_AIRPORT, "LAX")
                date_str = param(query, "date", RE_DATE, "2026-10-04")
                return {
                    "ok": True,
                    "origin": origin,
                    "dest": dest,
                    "date": date_str,
                    "delayed_or_cancelled": database_rate(origin, dest, date_str),
                }
            raise HttpError(404, f"no such endpoint: {path}")

        def log_message(self, *_args):
            pass

    class Server(ThreadingHTTPServer):
        daemon_threads = True

    httpd = Server((HOST, PORT), Handler)
    print(f"flight-predictor API on http://{HOST}:{PORT} (Snowflake only; no sample fallback)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
