// Live data from the local Snowflake API (backend/api.py). When it isn't running, everything
// falls back to the sample model in score.js and the page works the same.

(function () {
  const D = window.FP_DATA;
  const BASE = 'http://localhost:8787';
  const scores = new Map();   // flight key -> live score
  const routes = new Map();   // route key -> { flights, markets }
  const pending = new Map();

  const flightKey = (f) => [f.carrier, f.flight, f.origin, f.dest, f.date].join('|').toUpperCase();
  const routeKey = (o, d, date) => [o, d, date].join('|').toUpperCase();
  const fmtWindow = (a, b) => {
    const o = { month: 'short', day: 'numeric' };
    const s = new Date(a + 'T12:00:00').toLocaleDateString('en-US', o);
    const e = new Date(b + 'T12:00:00').toLocaleDateString('en-US', o);
    return a === b ? s : `${s} – ${e}`;
  };

  async function get(path, params, ms = 20000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { signal: ctl.signal });
      if (!res.ok) throw new Error((await res.json()).error || res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // API market rows into the same shape as the sample markets
  function toMarket(m) {
    const short = m.title.replace(/\?.*$/, '').replace(/^Will (a |the )?/, '').replace(/ by [A-Z][a-z]+ \d+, \d{4}$/, '');
    return {
      id: m.market_id, title: m.title.replace(/\?$/, ''), short: short.slice(0, 28), venue: m.venue === 'kalshi' ? 'Kalshi' : 'Polymarket',
      cause: m.cause, q: m.q_market, dayShare: m.q_market ? m.q / m.q_market : 1, qHist: m.q_hist, lift: m.lift,
      liquidity: m.liquidity || 0, volume: 0,
      dates: [m.window_start, m.window_end], window: fmtWindow(m.window_start, m.window_end),
      scope: m.scope_type === 'national' ? { national: true } : { airports: String(m.scope_value).split(' '), label: m.scope_value },
      history: m.history, live: true,
    };
  }

  const Live = {
    on: false,
    info: null,

    async init() {
      try {
        Live.info = await get('/api/health', {}, 2500);
        Live.on = !!Live.info.ok;
      } catch {
        Live.on = false;
      }
      if (Live.on) {
        try {
          const { markets } = await get('/api/markets', {});
          D.markets = markets.map(toMarket);
          D.minLiquidity = 0;
        } catch { /* keep sample markets */ }
      }
      window.dispatchEvent(new CustomEvent('fp-live', { detail: { on: Live.on, info: Live.info } }));
    },

    // Fetch the flight and its route; resolves even on failure so the page can fall back
    async prefetch(f) {
      if (!Live.on) return false;
      const fk = flightKey(f);
      if (scores.has(fk)) return true;
      if (pending.has(fk)) return pending.get(fk);
      const job = Promise.all([
        get('/api/score', { carrier: f.carrier, flight: f.flight, origin: f.origin, dest: f.dest, date: f.date, time: f.time }),
        Live.route(f.origin, f.dest, f.date),
      ]).then(([s]) => {
        scores.set(fk, { ...s, markets: s.markets.map(toMarket) });
        return true;
      }).catch((e) => {
        console.warn('Live score failed, using sample model', e);
        return false;
      }).finally(() => pending.delete(fk));
      pending.set(fk, job);
      return job;
    },

    async route(o, d, date) {
      if (!Live.on || !o || !d || !date) return null;
      const rk = routeKey(o, d, date);
      if (routes.has(rk)) return routes.get(rk);
      try {
        const r = await get('/api/route', { origin: o, dest: d, date });
        const value = { flights: r.flights, markets: r.markets.map(toMarket) };
        routes.set(rk, value);
        return value;
      } catch (e) {
        console.warn('Live route failed', e);
        return null;
      }
    },

    // Synchronous lookups for score.js and the flight picker
    lookup(f) {
      if (!Live.on || !f) return null;
      const s = scores.get(flightKey(f));
      if (s) return s;
      // A flight we only know from its route: base rates without per-cause intervals
      const r = routes.get(routeKey(f.origin, f.dest, f.date));
      const hit = r && r.flights.find((x) => x.carrier === f.carrier && x.flight === String(f.flight));
      if (!hit) return null;
      return {
        causes: D.causes.map((c) => ({ cause: c.code, base: hit.rates[c.code], lo: null, hi: null, level: 'route' })),
        total: null,
        markets: r.markets.filter((m) => !(m.scope && m.scope.carrier)),
      };
    },
    routeFlights(o, d, date) {
      const r = routes.get(routeKey(o, d, date));
      return r ? r.flights : null;
    },
  };

  window.FPLive = Live;
})();
