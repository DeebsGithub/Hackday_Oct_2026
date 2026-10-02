// API client. The frontend has no local or sample data path.
(function () {
  const D = window.FP_DATA;
  const BASE = window.FP_API_BASE || 'http://localhost:8787';

  async function get(path, params = {}, timeout = 30000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const query = new URLSearchParams(params);
      const response = await fetch(`${BASE}${path}${query.size ? `?${query}` : ''}`, { signal: ctl.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `API returned ${response.status}`);
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  const Live = {
    on: false,
    info: null,
    error: null,
    catalogReady: false,
    catalogError: null,

    async init() {
      try {
        const catalog = await get('/api/catalog', {}, 5000);
        if (!Array.isArray(catalog.airports) || !catalog.airports.length) {
          throw new Error('The airport catalog is unavailable.');
        }
        D.airports.splice(0, D.airports.length, ...catalog.airports);
        Live.catalogReady = true;
      } catch (error) {
        Live.catalogError = error;
        Live.error = error;
      }
      window.dispatchEvent(new CustomEvent('fp-catalog', {
        detail: { ok: Live.catalogReady, error: Live.catalogError && Live.catalogError.message },
      }));
      try {
        const health = await get('/api/health', {}, 5000);
        Live.info = health;
        Live.on = health.ok === true;
      } catch (error) {
        Live.error = error;
        Live.on = false;
      }
      window.dispatchEvent(new CustomEvent('fp-live', {
        detail: { on: Live.on, info: Live.info, error: Live.error && Live.error.message },
      }));
    },

    async database(origin, dest, date) {
      if (!Live.on || !origin || !dest || !date) return null;
      try {
        return await get('/api/database', { origin, dest, date });
      } catch (error) {
        Live.error = error;
        return null;
      }
    },

    lookup() { return null; },
    route() { return Promise.resolve(null); },
    routeFlights() { return null; },
  };

  window.FPLive = Live;
})();
