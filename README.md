# Hackday_Oct_2026

Flight cancellation risk prototype: static frontend in `web/`, local API in `backend/`.

## Run

Two processes: the API (`backend/api.py`, port 8787) and a static file server
for the frontend (`web/`, port 8000). Each runs in its own terminal.

### 1. One-time setup

```bash
python3 -m venv .venv              # repo already ships one (Python 3.12)
source .venv/bin/activate          # or call .venv/bin/python directly
pip install -r requirements.txt
cp envexample .env                 # then fill in the SNOWFLAKE_* values
```

`.env` must contain valid `SNOWFLAKE_*` credentials — the backend connects to
`CIRIUM_FLIGHT_DATA.PUBLIC.FLIGHTS` on every route submit.

### 2. Start the backend (terminal 1)

```bash
source .venv/bin/activate
python backend/api.py              # serves http://localhost:8787
```

Sanity check that it's up:

```bash
curl http://localhost:8787/api/health
# {"ok": true, "mode": "snowflake", ...}
```

### 3. Start the frontend (terminal 2)

```bash
source .venv/bin/activate
python -m http.server -d web 8000  # serves http://localhost:8000
```

### 4. Use it

Open **http://localhost:8000**, pick origin, destination and a date, and
submit. The form calls `GET /api/database` (which runs
`load_rows.load_database()` against Snowflake) and displays the share of
historical flights on that route that were delayed or cancelled.

### Notes

- Keep both terminals running; stop either server with Ctrl-C.
- The backend port is set by `PORT` in `.env` (default 8787), and the frontend
  hardcodes that URL (`BASE` in `web/live.js`). If you change one, change the
  other.
- Submitted routes query Snowflake directly; if it is unreachable the form
  shows an error and does not substitute sample/model data.

## API endpoints (backend, port 8787)

| Endpoint | Returns |
| --- | --- |
| `GET /api/health` | backend readiness (`{ok, mode}`) |
| `GET /api/catalog` | airport metadata used by the route form |
| `GET /api/database?origin&dest&date` | `load_rows.load_database()` — share of route legs delayed or cancelled, displayed directly on submit |

There is no browser-side scoring model or generated fallback. Backend failures
are shown as errors instead of being replaced with sample values.
