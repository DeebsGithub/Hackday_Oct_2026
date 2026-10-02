// Scoring that mirrors SCORE.P_CANCEL: nested shrinkage per cause, then live market adjustments.

(function () {
  const D = window.FP_DATA;
  const CAUSES = D.causes;
  const LEVELS = [
    { key: 'carrier', label: 'Carrier' },
    { key: 'carrier_origin', label: 'Carrier × origin' },
    { key: 'carrier_route', label: 'Carrier × route' },
    { key: 'route_season', label: '× month × hour band' },
    { key: 'flight', label: 'Flight number' },
  ];

  // ---------- helpers ----------
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }
  // Deterministic noise around 1 so the same flight always scores the same
  const jitter = (key, spread) => Math.exp((hash(key) - 0.5) * 2 * spread);

  function fmtPct(p, opts = {}) {
    const v = p * 100;
    if (v > 0 && v < 0.01) return '<0.01%';
    const digits = opts.digits ?? (v < 1 ? 2 : 1);
    return v.toFixed(digits) + '%';
  }
  const fmtMoney = (v) => '$' + Math.round(v).toLocaleString('en-US');
  const fmtK = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1e3) + 'k');
  const byCode = (list, code) => list.find((x) => x.code === code);
  const sumRates = (r) => Object.values(r).reduce((a, b) => a + b, 0);

  // Beta(α, β) 5% / 95% bounds. Logit-normal works once there are a few cancels;
  // below that the tail is set by the prior's strength instead of blowing up.
  function betaInterval(a, b) {
    const m = a / (a + b);
    if (m <= 0) return [0, 0];
    if (a < 3) {
      const n = a + b;
      return [m * Math.max(0.05, a / 6), Math.min(1, (a + 1.645 * Math.sqrt(a) + 1.2) / n)];
    }
    const sd = Math.sqrt(1 / a + 1 / b);
    const lg = Math.log(m / (1 - m));
    const inv = (x) => 1 / (1 + Math.exp(-x));
    return [inv(lg - 1.645 * sd), inv(lg + 1.645 * sd)];
  }

  function seasonOf(month) {
    if ([12, 1, 2].includes(month)) return 'winter';
    if ([6, 7, 8, 9].includes(month)) return 'summer';
    return 'shoulder';
  }

  // ---------- scoring ----------
  function marketsFor(input) {
    return D.markets.filter((m) => {
      if (m.liquidity < D.minLiquidity) return false;
      if (input.date < m.dates[0] || input.date > m.dates[1]) return false;
      if (m.scope.national) return true;
      return m.scope.airports.includes(input.origin) || m.scope.airports.includes(input.dest);
    });
  }

  // Live markets carry dayShare: a month-long market only hits a given trip day part of the time
  const marketFactor = (m, q = m.q) => {
    const qd = q * (m.dayShare ?? 1);
    return (qd * m.lift + 1 - qd) / (m.qHist * m.lift + 1 - m.qHist);
  };

  // Score from Snowflake (via live.js): base rates and intervals per cause, markets applied here
  // so switching one off or scrubbing Trip Watch still works without another round trip
  function liveScore(input, live, opts) {
    const hour = Number(input.time.slice(0, 2));
    const band = hour < 10 ? 'AM' : hour < 16 ? 'MID' : 'PM';
    const matched = live.markets;
    const applied = matched.filter((m) => !(opts.disabled && opts.disabled.has(m.id)));
    const factor = Object.fromEntries(CAUSES.map((c) => [c.code, 1]));
    applied.forEach((m) => {
      const q = opts.qOverride && opts.qOverride[m.id] != null ? opts.qOverride[m.id] : m.q;
      factor[m.cause] *= marketFactor(m, q);
    });
    const causes = CAUSES.map((c) => {
      const row = live.causes.find((x) => x.cause === c.code) || { base: 0 };
      const f = factor[c.code];
      // Route-level lookups have no intervals; show a plain ±60% band rather than nothing
      const lo = row.lo != null ? row.lo : row.base * 0.4;
      const hi = row.hi != null ? row.hi : row.base * 1.6;
      return { ...c, base: row.base, p: row.base * f, lo: lo * f, hi: hi * f, level: row.level };
    });
    const total = causes.reduce((s, c) => s + c.p, 0);
    const baseTotal = causes.reduce((s, c) => s + c.base, 0);
    const scale = baseTotal ? total / baseTotal : 1;
    const t = live.total || { lo: baseTotal * 0.6, hi: baseTotal * 1.5 };
    return {
      causes, total, baseTotal, lo: t.lo * scale, hi: t.hi * scale,
      levels: [], matched, applied, band, month: Number(input.date.slice(5, 7)), live: true,
    };
  }


  function score(input, opts = {}) {
    const live = window.FPLive && window.FPLive.lookup(input);
    if (live) return liveScore(input, live, opts);
    // Route-level checks pass no carrier: score a typical airline (all multipliers 1)
    const carrier = byCode(D.carriers, input.carrier) || { code: '··', name: 'Typical', mult: { A: 1, B: 1, C: 1, D: 1 }, volume: 0.5 };
    const origin = byCode(D.airports, input.origin);
    const dest = byCode(D.airports, input.dest);
    const month = Number(input.date.slice(5, 7));
    const season = seasonOf(month);
    const hour = Number(input.time.slice(0, 2));
    const band = hour < 10 ? 'AM' : hour < 16 ? 'MID' : 'PM';
    const bandMult = { AM: 0.8, MID: 1, PM: 1.3 }[band];
    const wx = (a) => (season === 'shoulder' ? ((a.winter + a.summer) / 2) * 0.7 : a[season]);

    const route = `${input.carrier}-${input.origin}-${input.dest}`;
    const flightKey = `${route}-${input.flight}`;

    // Rate each level would observe, getting more specific as we go down
    const truth = (lvl, k) => {
      let r = D.globalRate[k] * carrier.mult[k];
      if (lvl === 'carrier') return r;
      if (k === 'B') r *= Math.sqrt(wx(origin) * 1.2);
      if (k === 'C') r *= origin.nas;
      if (lvl === 'carrier_origin') return r;
      if (k === 'B') r *= Math.sqrt(wx(dest) / 1.2);
      if (k === 'C') r *= Math.sqrt(dest.nas);
      r *= jitter(route + k, 0.25);
      if (lvl === 'carrier_route') return r;
      r *= k === 'B' ? Math.sqrt(wx(origin)) * bandMult : bandMult;
      if (lvl === 'route_season') return r;
      return r * jitter(flightKey + k, 0.5);
    };

    const nFlights = {
      carrier: Math.round(620000 * carrier.volume),
      carrier_origin: Math.round(48000 * carrier.volume * (0.6 + hash(input.origin))),
      carrier_route: Math.round(2400 + 6000 * hash(route)),
      route_season: Math.round(140 + 260 * hash(route + month + band)),
      flight: Math.round(18 + 70 * hash(flightKey)),
    };

    const levels = [];
    let parent = { ...D.globalRate };
    const last = {};
    LEVELS.forEach(({ key, label }) => {
      const n = nFlights[key];
      const kappa = D.kappa[key];
      const row = { label, n, kappa, cancels: 0, post: 0 };
      const post = {};
      CAUSES.forEach(({ code: k }) => {
        const c = Math.round(n * truth(key, k) * jitter(key + flightKey + k + 'obs', 0.15));
        post[k] = (c + kappa * parent[k]) / (n + kappa);
        last[k] = { alpha: c + kappa * parent[k], beta: n - c + kappa * (1 - parent[k]) };
        row.cancels += c;
        row.post += post[k];
      });
      row.raw = row.cancels / n;
      levels.push(row);
      parent = post;
    });

    // Live adjustments, cause by cause
    const matched = marketsFor(input);
    const applied = matched.filter((m) => !(opts.disabled && opts.disabled.has(m.id)));
    const factor = Object.fromEntries(CAUSES.map((c) => [c.code, 1]));
    applied.forEach((m) => {
      const q = opts.qOverride && opts.qOverride[m.id] != null ? opts.qOverride[m.id] : m.q;
      factor[m.cause] *= marketFactor(m, q);
    });

    const causes = CAUSES.map((c) => {
      const base = parent[c.code];
      const [lo, hi] = betaInterval(last[c.code].alpha, last[c.code].beta);
      const f = factor[c.code];
      return { ...c, base, p: base * f, lo: lo * f, hi: hi * f };
    });

    const total = causes.reduce((s, c) => s + c.p, 0);
    const baseTotal = causes.reduce((s, c) => s + c.base, 0);
    const aTot = CAUSES.reduce((s, c) => s + last[c.code].alpha, 0);
    const bTot = last.A.alpha + last.A.beta - aTot;
    const [lo, hi] = betaInterval(aTot, bTot);
    const scale = total / baseTotal;

    return { causes, total, baseTotal, lo: lo * scale, hi: hi * scale, levels, matched, applied, band, month };
  }

  window.FP = { score, marketFactor, marketsFor, fmtPct, fmtMoney, fmtK, byCode, sumRates, hash };
})();
