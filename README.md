# Hackday_Oct_2026

Flight cancellation risk prototype: static frontend in `web/`, local API in `backend/`.

## Run

```bash
pip install -r requirements.txt
python backend/api.py                 # API on http://localhost:8787
python -m http.server -d web 8000     # frontend on http://localhost:8000
```

Copy `envexample` to `.env` and fill in the `SNOWFLAKE_*` values. With valid
credentials the API serves Snowflake data (Cirium OTP view
`CIRIUM_FLIGHT_DATA.PUBLIC.FLIGHTS`); without them — or if Snowflake errors — it
falls back to the sample model ported from `web/data.js`, and the frontend works
either way (badge shows which).

| Endpoint | Returns |
| --- | --- |
| `GET /api/health` | `{ok, mode, data_through, markets}` |
| `GET /api/markets` | prediction markets (rows consumed by `toMarket` in `web/live.js`) |
| `GET /api/score?carrier&flight&origin&dest&date&time` | per-cause base rates + 90% intervals, matching markets |
| `GET /api/route?origin&dest&date` | flights + per-carrier base rates + matching markets |

Design notes: `docs/design/cancellation-probability-pipeline.md`. Markets are
applied client-side (`web/score.js`) so toggling one never needs another round
trip. Cirium has no cancellation-cause codes, so the Snowflake store splits the
overall rate across causes by the global mix until BTS causes are loaded.
