# Hackday_Oct_2026

Flight cancellation risk prototype: static frontend in `web/`, local API in `backend/`.

## Run

```bash
pip install -r requirements.txt
python backend/api.py                 # API on http://localhost:8787
python -m http.server -d web 8000     # frontend on http://localhost:8000
```

Copy `envexample` to `.env` and fill in the `SNOWFLAKE_*` values. Submitted
routes use `CIRIUM_FLIGHT_DATA.PUBLIC.FLIGHTS` through `/api/database`; the
frontend displays that response directly. If Snowflake is unavailable, the
route form shows an error and does not substitute sample/model data.

| Endpoint | Returns |
| --- | --- |
| `GET /api/health` | backend readiness (`{ok, mode}`) |
| `GET /api/catalog` | airport metadata used by the route form |
| `GET /api/database?origin&dest&date` | `load_rows.load_database()` — share of route legs delayed or cancelled, displayed directly on submit |

There is no browser-side scoring model or generated fallback. Backend failures
are shown as errors instead of being replaced with sample values.
