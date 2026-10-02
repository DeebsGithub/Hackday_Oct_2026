// Sample data for the prototype. Real values come from FLIGHT_RISK.BAYES and SCORE.MARKET_LATEST.

window.FP_DATA = {
  // Cause codes follow BTS: A carrier, B weather, C air traffic system, D security
  causes: [
    { code: 'B', name: 'Weather', slot: 1 },
    { code: 'A', name: 'Carrier', slot: 2 },
    { code: 'C', name: 'Air traffic', slot: 3 },
    { code: 'D', name: 'Security', slot: 4 },
  ],

  globalRate: { A: 0.0062, B: 0.0058, C: 0.0024, D: 0.00008 },

  // Multipliers on the global rate per cause, standing in for carrier posteriors
  carriers: [
    { code: 'UA', name: 'United', mult: { A: 1.05, B: 1.0, C: 1.15, D: 1 }, volume: 1.0 },
    { code: 'DL', name: 'Delta', mult: { A: 0.55, B: 0.85, C: 0.9, D: 1 }, volume: 1.0 },
    { code: 'AA', name: 'American', mult: { A: 1.1, B: 1.05, C: 1.0, D: 1 }, volume: 1.0 },
    { code: 'WN', name: 'Southwest', mult: { A: 1.25, B: 1.1, C: 0.85, D: 1 }, volume: 1.1 },
    { code: 'B6', name: 'JetBlue', mult: { A: 1.4, B: 1.2, C: 1.35, D: 1 }, volume: 0.45 },
    { code: 'AS', name: 'Alaska', mult: { A: 0.8, B: 0.9, C: 0.8, D: 1 }, volume: 0.4 },
    { code: 'NK', name: 'Spirit', mult: { A: 1.7, B: 1.1, C: 1.1, D: 1 }, volume: 0.3 },
    { code: 'F9', name: 'Frontier', mult: { A: 1.6, B: 1.15, C: 1.0, D: 1 }, volume: 0.25 },
    { code: 'OO', name: 'SkyWest', mult: { A: 1.3, B: 1.35, C: 1.2, D: 1 }, volume: 0.6 },
  ],

  // Origin weather sensitivity by season and congestion (cause C)
  airports: [
    { code: 'ORD', city: 'Chicago', winter: 2.4, summer: 1.3, nas: 1.3, region: 'Midwest' },
    { code: 'LGA', city: 'New York', winter: 1.9, summer: 1.6, nas: 1.8, region: 'NYC' },
    { code: 'EWR', city: 'Newark', winter: 1.8, summer: 1.7, nas: 2.0, region: 'NYC' },
    { code: 'JFK', city: 'New York', winter: 1.7, summer: 1.4, nas: 1.5, region: 'NYC' },
    { code: 'BOS', city: 'Boston', winter: 2.2, summer: 1.0, nas: 1.2, region: 'Northeast' },
    { code: 'DEN', city: 'Denver', winter: 2.0, summer: 1.1, nas: 1.0, region: 'Mountain' },
    { code: 'ATL', city: 'Atlanta', winter: 1.0, summer: 1.3, nas: 1.1, region: 'Southeast' },
    { code: 'DFW', city: 'Dallas', winter: 1.3, summer: 1.4, nas: 1.0, region: 'South' },
    { code: 'MIA', city: 'Miami', winter: 0.5, summer: 1.6, nas: 0.9, region: 'Florida' },
    { code: 'MCO', city: 'Orlando', winter: 0.5, summer: 1.5, nas: 0.9, region: 'Florida' },
    { code: 'SFO', city: 'San Francisco', winter: 1.1, summer: 0.6, nas: 1.4, region: 'West' },
    { code: 'LAX', city: 'Los Angeles', winter: 0.6, summer: 0.5, nas: 1.0, region: 'West' },
    { code: 'SEA', city: 'Seattle', winter: 1.2, summer: 0.5, nas: 0.9, region: 'West' },
  ],

  // Kappa per level x cause (prior strength), from the grid search
  kappa: {
    carrier: 1000, carrier_origin: 300, carrier_route: 200, route_season: 150, flight: 300,
  },

  // Live markets. q = smoothed price, qHist = historical frequency of the event,
  // lift = multiplier on the cause rate on event days (Beta-shrunk from analog days).
  markets: [
    {
      id: 'ord-snow',
      title: 'Snow ≥ 6″ at O’Hare',
      short: 'ORD snow ≥ 6″',
      window: 'Dec 14',
      dates: ['2026-12-13', '2026-12-15'],
      scope: { airports: ['ORD'] },
      cause: 'B', venue: 'Kalshi', q: 0.34, qHist: 0.06, lift: 4.2,
      liquidity: 182000, volume: 61000,
      history: [0.08, 0.09, 0.09, 0.12, 0.12, 0.13, 0.15, 0.14, 0.18, 0.21, 0.24, 0.29, 0.31, 0.34, 0.34],
    },
    {
      id: 'nyc-tstorm',
      title: 'NYC ground stop for thunderstorms',
      short: 'NYC storms',
      window: 'Dec 13–15',
      dates: ['2026-12-13', '2026-12-15'],
      scope: { airports: ['LGA', 'EWR', 'JFK'] },
      cause: 'B', venue: 'Polymarket', q: 0.07, qHist: 0.04, lift: 3.1,
      liquidity: 54000, volume: 12000,
      history: [0.04, 0.04, 0.05, 0.05, 0.04, 0.05, 0.06, 0.06, 0.05, 0.06, 0.07, 0.07, 0.07, 0.07, 0.07],
    },
    {
      id: 'den-wind',
      title: 'Denver gusts over 50 mph',
      short: 'DEN wind 50+ mph',
      window: 'Nov 3',
      dates: ['2026-11-02', '2026-11-04'],
      scope: { airports: ['DEN'] },
      cause: 'B', venue: 'Kalshi', q: 0.41, qHist: 0.12, lift: 2.3,
      liquidity: 97000, volume: 30000,
      history: [0.14, 0.15, 0.13, 0.17, 0.2, 0.22, 0.25, 0.24, 0.28, 0.33, 0.35, 0.38, 0.4, 0.41, 0.41],
    },
    {
      id: 'fl-storm',
      title: 'Named storm landfall in Florida',
      short: 'FL landfall',
      window: 'Oct 8–12',
      dates: ['2026-10-08', '2026-10-12'],
      scope: { airports: ['MIA', 'MCO'] },
      cause: 'B', venue: 'Polymarket', q: 0.22, qHist: 0.05, lift: 7.5,
      liquidity: 410000, volume: 150000,
      history: [0.05, 0.06, 0.06, 0.08, 0.11, 0.1, 0.12, 0.15, 0.17, 0.19, 0.18, 0.2, 0.21, 0.22, 0.22],
    },
    {
      id: 'bos-noreaster',
      title: 'Nor’easter closes Logan',
      short: 'BOS nor’easter',
      window: 'Jan 6–8',
      dates: ['2027-01-06', '2027-01-08'],
      scope: { airports: ['BOS'] },
      cause: 'B', venue: 'Kalshi', q: 0.11, qHist: 0.04, lift: 9.0,
      liquidity: 38000, volume: 9000,
      history: [0.03, 0.04, 0.04, 0.05, 0.05, 0.06, 0.07, 0.07, 0.08, 0.09, 0.1, 0.1, 0.11, 0.11, 0.11],
    },
    {
      id: 'shutdown',
      title: 'Federal shutdown in effect',
      short: 'Shutdown',
      window: 'Oct 15 – Dec 31',
      dates: ['2026-10-15', '2026-12-31'],
      scope: { national: true },
      cause: 'C', venue: 'Kalshi', q: 0.18, qHist: 0.03, lift: 1.6,
      liquidity: 900000, volume: 420000,
      history: [0.3, 0.28, 0.27, 0.25, 0.26, 0.24, 0.22, 0.21, 0.2, 0.2, 0.19, 0.18, 0.18, 0.18, 0.18],
    },
  ],

  minLiquidity: 25000,
};

// More carriers (regional and leisure), multipliers rough until their posteriors are in
window.FP_DATA.carriers.push(
  { code: 'HA', name: 'Hawaiian', mult: { A: 0.6, B: 0.6, C: 0.5, D: 1 }, volume: 0.25 },
  { code: 'G4', name: 'Allegiant', mult: { A: 1.9, B: 1.1, C: 0.9, D: 1 }, volume: 0.25 },
  { code: 'SY', name: 'Sun Country', mult: { A: 1.3, B: 1.2, C: 0.9, D: 1 }, volume: 0.1 },
  { code: 'MX', name: 'Breeze', mult: { A: 1.8, B: 1.1, C: 1.0, D: 1 }, volume: 0.1 },
  { code: 'MQ', name: 'Envoy (American Eagle)', mult: { A: 1.5, B: 1.4, C: 1.3, D: 1 }, volume: 0.35 },
  { code: 'YX', name: 'Republic', mult: { A: 1.35, B: 1.35, C: 1.4, D: 1 }, volume: 0.35 },
  { code: '9E', name: 'Endeavor (Delta Connection)', mult: { A: 1.1, B: 1.3, C: 1.2, D: 1 }, volume: 0.3 },
  { code: 'OH', name: 'PSA (American Eagle)', mult: { A: 1.6, B: 1.3, C: 1.2, D: 1 }, volume: 0.3 },
  { code: 'QX', name: 'Horizon (Alaska)', mult: { A: 1.0, B: 1.3, C: 0.8, D: 1 }, volume: 0.15 },
);

// Every airport in airports.js gets weather and congestion factors. Hand-tuned ones keep theirs;
// the rest are derived from latitude (snow), the thunderstorm belt east of the Rockies, and hub size.
(function () {
  const D = window.FP_DATA;
  const tuned = Object.fromEntries(D.airports.map((a) => [a.code, a]));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  D.airports = (window.FP_AIRPORTS || []).map(([code, city, state, name, lat, lon, hub]) => {
    const base = { code, city, state, name, lat, lon, hub };
    if (tuned[code]) return { ...base, ...tuned[code] };
    const island = lon < -150 || lat < 20;
    const winter = island ? 0.4 : clamp(0.35 + (lat - 27) * 0.11, 0.35, 2.4);
    const summer = island ? 0.5 : lon > -103 ? (lat < 35 ? 1.5 : 1.25) : 0.6;
    const nas = [0.85, 0.95, 1.15][hub];
    return { ...base, winter, summer, nas, region: state };
  });
})();
