// Page logic: the ask form, the results view, Trip Watch and the market list.

(function () {
  const D = window.FP_DATA;
  const CAUSES = D.causes;
  const $ = (id) => document.getElementById(id);
  const { score, marketFactor, fmtPct, fmtMoney, fmtK, byCode, sumRates } = window.FP;

  // ---------- tooltip ----------
  const tip = $('tip');
  function showTip(evt, html, host) {
    tip.innerHTML = html;
    tip.hidden = false;
    const hr = host.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(evt.clientX - hr.left - w / 2, 8), hr.width - w - 8) + 'px';
    tip.style.top = evt.clientY - hr.top - tip.offsetHeight - 14 + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------- step 1: the form ----------
  const form = $('flight-form');
  const disabled = new Set();
  let current = null;

  // ---------- type-ahead search for airline, origin and destination ----------
  const airportLabel = (a) => `${a.city}, ${a.state} (${a.code})`;
  const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function searchAirports(text, limit = 8) {
    const t = text.trim().toLowerCase();
    if (!t) return D.airports.filter((a) => a.hub === 2).slice(0, limit);
    const rank = (a) => {
      const code = a.code.toLowerCase(), city = a.city.toLowerCase(), name = a.name.toLowerCase();
      if (code === t) return 0;
      if (city.startsWith(t)) return 1;
      if (code.startsWith(t)) return 2;
      if (name.toLowerCase().startsWith(t)) return 3;
      if (city.includes(t) || name.includes(t)) return 4;
      if (a.state.toLowerCase() === t) return 5;
      return 99;
    };
    return D.airports
      .map((a) => ({ a, r: rank(a) }))
      .filter((x) => x.r < 99)
      .sort((x, y) => x.r - y.r || y.a.hub - x.a.hub)
      .slice(0, limit)
      .map((x) => x.a);
  }

  function searchCarriers(text, limit = 8) {
    const t = text.trim().toLowerCase();
    if (!t) return D.carriers.slice(0, limit);
    const rank = (c) => {
      const code = c.code.toLowerCase(), name = c.name.toLowerCase();
      if (code === t) return 0;
      if (name.startsWith(t)) return 1;
      if (code.startsWith(t)) return 2;
      if (name.includes(t)) return 3;
      return 99;
    };
    return D.carriers.map((c) => ({ c, r: rank(c) })).filter((x) => x.r < 99).sort((x, y) => x.r - y.r).slice(0, limit).map((x) => x.c);
  }

  // Sample schedule: which carriers fly a route, how often, and when. Production reads this from STG.FLIGHTS.
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const fmtTime = (t) => new Date(`2000-01-01T${t}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const hash = window.FP.hash;

  function scheduleFor(carrierCode, o, d, date = $('f-date').value) {
    if (!o || !d || o === d) return [];
    // Real flights from BTS when the live API has this route
    const real = window.FPLive && window.FPLive.routeFlights(o, d, date);
    if (real) {
      return real
        .filter((x) => !carrierCode || x.carrier === carrierCode)
        .map((x) => ({ code: x.flight, carrier: x.carrier, carrierName: (byCode(D.carriers, x.carrier) || { name: x.carrier }).name, time: x.time }));
    }
    const oa = byCode(D.airports, o), da = byCode(D.airports, d);
    const carriers = carrierCode ? [byCode(D.carriers, carrierCode)] : D.carriers;
    const out = [];
    carriers.forEach((c) => {
      const key = `${c.code}-${o}-${d}`;
      // Bigger airports and bigger airlines mean more routes and more daily departures
      const reach = Math.min(0.95, 0.12 + 0.18 * (oa.hub + da.hub) * c.volume);
      if (!carrierCode && hash(key + 'serves') > reach) return;
      const n = Math.max(1, Math.round((0.6 + oa.hub + da.hub) * c.volume * (0.6 + hash(key + 'freq'))));
      const first = 360 + Math.round(hash(key + 'first') * 60);
      const gap = Math.floor((1290 - first) / Math.max(n, 1));
      for (let i = 0; i < n; i++) {
        const dep = Math.round((first + i * gap + hash(key + i) * Math.min(gap, 60) * 0.6) / 5) * 5;
        const num = String(Math.floor(100 + hash(key + 'no' + i) * (c.code.length === 2 && /\d/.test(c.code) ? 5800 : 2800)));
        out.push({ code: num, carrier: c.code, carrierName: c.name, time: toTime(dep) });
      }
    });
    return out;
  }

  const SOURCES = {
    airport: {
      search: searchAirports,
      find: (code) => byCode(D.airports, code),
      label: airportLabel,
      row: (a) => `<b>${a.code}</b><span>${esc(a.city)}, ${a.state}<small>${esc(a.name)}</small></span>`,
    },
    flight: {
      // Flights on the chosen route, closest to the chosen departure time first
      search: (text, limit = 8) => {
        const want = toMin($('f-time').value || '09:00');
        const t = text.replace(/\D/g, '');
        return scheduleFor(combos.carrier.resolve(), combos.origin.resolve(), combos.dest.resolve())
          .filter((f) => !t || f.code.startsWith(t))
          .sort((a, b) => Math.abs(toMin(a.time) - want) - Math.abs(toMin(b.time) - want))
          .slice(0, limit);
      },
      find: (code) => (code ? { code: String(code).replace(/\D/g, '').slice(0, 4) } : null),
      label: (f) => f.code,
      row: (f) => `<b>${f.carrier} ${f.code}</b><span>${fmtTime(f.time)}<small>${esc(f.carrierName)} · ${combos.origin.resolve()} → ${combos.dest.resolve()}</small></span>`,
      hint: () => (!combos.origin.resolve() || !combos.dest.resolve()
        ? 'Pick From and To to see flights on your route.'
        : 'No matching flights on this route. You can still type your number.'),
      free: true,
      onChoose: (f) => {
        combos.carrier.set(f.carrier);
        $('f-time').value = f.time;
      },
    },
    carrier: {
      search: searchCarriers,
      find: (code) => byCode(D.carriers, code),
      label: (c) => `${c.name} (${c.code})`,
      row: (c) => `<b>${c.code}</b><span>${esc(c.name)}</span>`,
    },
  };

  function combo(key, src) {
    const q = $(`f-${key}-q`), hid = $(`f-${key}`), list = $(`f-${key}-list`);
    let items = [], active = -1;

    function render() {
      list.innerHTML = items
        .map((a, i) => `<li role="option" id="f-${key}-opt-${i}" data-i="${i}" aria-selected="${i === active}">${src.row(a)}</li>`)
        .join('') || (src.hint ? `<li class="combo-hint" aria-disabled="true">${src.hint()}</li>` : '');
      q.setAttribute('aria-activedescendant', active >= 0 ? `f-${key}-opt-${active}` : '');
      const el = list.children[active];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
    function open(text) {
      items = src.search(text);
      active = items.length ? 0 : -1;
      list.hidden = !items.length && !src.hint;
      q.setAttribute('aria-expanded', String(!list.hidden));
      render();
    }
    function close() {
      list.hidden = true;
      q.setAttribute('aria-expanded', 'false');
    }
    function choose(a) {
      set(a.code);
      if (src.onChoose) src.onChoose(a);
      close();
    }
    function set(code) {
      const a = code && src.find(code);
      hid.value = a ? a.code : '';
      q.value = a ? src.label(a) : '';
      q.removeAttribute('aria-invalid');
    }
    // Typed text that never got picked: take an exact code or a single clear match
    function resolve() {
      if (hid.value || !q.value.trim()) return hid.value;
      if (src.free) { set(q.value); return hid.value; }
      const hits = src.search(q.value, 2);
      const exact = hits.find((a) => a.code.toLowerCase() === q.value.trim().toLowerCase());
      if (exact || hits.length === 1) set((exact || hits[0]).code);
      return hid.value;
    }

    q.addEventListener('input', () => {
      hid.value = '';
      if (src.free) q.value = q.value.replace(/\D/g, '').slice(0, 4);
      open(q.value);
    });
    q.addEventListener('focus', () => { q.select(); open(hid.value ? '' : q.value); });
    q.addEventListener('blur', () => setTimeout(() => { close(); resolve(); }, 120));
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (list.hidden) open(q.value);
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(items.length, 1);
        render();
        e.preventDefault();
      } else if (e.key === 'Enter' && !list.hidden && items[active] && !(src.free && q.value && !items[active].code.startsWith(q.value))) {
        choose(items[active]);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        close();
      }
    });
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('[data-i]');
      if (!li) return;
      e.preventDefault();
      choose(items[Number(li.dataset.i)]);
    });
    return { set, resolve, input: q };
  }
  const combos = {};
  Object.assign(combos, {
    carrier: combo('carrier', SOURCES.carrier),
    flight: combo('flight', SOURCES.flight),
    origin: combo('origin', SOURCES.airport),
    dest: combo('dest', SOURCES.airport),
  });

  $('f-swap').addEventListener('click', () => {
    const o = combos.origin.resolve();
    combos.origin.set(combos.dest.resolve());
    combos.dest.set(o);
  });

  function readForm() {
    return {
      carrier: combos.carrier.resolve(),
      flight: combos.flight.resolve(),
      origin: combos.origin.resolve(),
      dest: combos.dest.resolve(),
      date: $('f-date').value,
      time: $('f-time').value || '09:00',
    };
  }

  function validate(f) {
    if (!f.carrier) return ['f-carrier-q', 'Pick your airline. Search by name or code, like United or UA.'];
    if (!f.flight) return ['f-flight-q', 'Enter the flight number, or pick one from the list once From and To are set.'];
    if (!f.origin) return ['f-origin-q', 'Pick where you fly from. Search by city or airport code.'];
    if (!f.dest) return ['f-dest-q', 'Pick where you fly to. Search by city or airport code.'];
    if (f.origin === f.dest) return ['f-dest-q', 'Origin and destination are the same airport.'];
    if (!f.date) return ['f-date', 'Pick your travel date.'];
    return null;
  }

  function warmRoute() {
    const o = combos.origin.resolve(), d = combos.dest.resolve(), date = $('f-date').value;
    if (window.FPLive && window.FPLive.on && o && d && date) window.FPLive.route(o, d, date);
  }
  ['f-origin-q', 'f-dest-q', 'f-date'].forEach((id) => $(id).addEventListener('change', warmRoute));
  ['f-origin-list', 'f-dest-list'].forEach((id) => $(id).addEventListener('mousedown', () => setTimeout(warmRoute, 0)));

  function setForm(f) {
    combos.carrier.set(f.carrier);
    combos.flight.set(f.flight);
    $('f-date').value = f.date;
    $('f-time').value = f.time;
    combos.origin.set(f.origin);
    combos.dest.set(f.dest);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = readForm();
    const err = validate(f);
    form.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
    $('f-error').hidden = !err;
    if (err) {
      $('f-error').textContent = err[1];
      $(err[0]).setAttribute('aria-invalid', 'true');
      $(err[0]).focus();
      return;
    }
    check(f);
  });

  const EXAMPLES = {
    'ord-snow': { carrier: 'UA', flight: '1423', origin: 'ORD', dest: 'LGA', date: '2026-12-14', time: '07:05' },
    'nyc-tstorm': { carrier: 'B6', flight: '617', origin: 'JFK', dest: 'BOS', date: '2026-12-14', time: '17:40' },
    'den-wind': { carrier: 'WN', flight: '2214', origin: 'DEN', dest: 'DFW', date: '2026-11-03', time: '15:20' },
    'fl-storm': { carrier: 'AA', flight: '1650', origin: 'MIA', dest: 'ATL', date: '2026-10-10', time: '11:15' },
    'bos-noreaster': { carrier: 'DL', flight: '903', origin: 'BOS', dest: 'ATL', date: '2027-01-07', time: '06:30' },
    shutdown: { carrier: 'UA', flight: '508', origin: 'EWR', dest: 'SFO', date: '2026-11-20', time: '18:45' },
  };
  document.querySelectorAll('[data-example]').forEach((b) => {
    b.addEventListener('click', () => { setForm(EXAMPLES[b.dataset.example]); form.requestSubmit(); });
  });

  // ---------- step 2: the answer ----------
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Scroll reveals: anything with .reveal fades up the first time it comes into view
  const revealer = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      revealer.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  function replayReveals() {
    document.querySelectorAll('#results .reveal').forEach((el) => {
      el.classList.remove('in');
      revealer.observe(el);
    });
  }

  function countUp(el, to, digits) {
    if (reduceMotion) { el.textContent = to.toFixed(digits); return; }
    const t0 = performance.now();
    const dur = 1100;
    (function tick(now) {
      const k = Math.min(1, (now - t0) / dur);
      el.textContent = (to * (1 - Math.pow(1 - k, 3))).toFixed(digits);
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }

  async function check(f) {
    const btn = form.querySelector('[type="submit"]');
    if (window.FPLive && window.FPLive.on) {
      btn.disabled = true;
      btn.textContent = 'Checking Snowflake…';
      await window.FPLive.prefetch(f);
      btn.disabled = false;
      btn.textContent = 'Check my flight';
    }
    current = f;
    disabled.clear();
    $('results').hidden = false;
    $('nav-new').hidden = false;
    document.querySelector('.nav-flight').hidden = false;
    document.body.classList.add('has-results');
    render({ fresh: true });
    renderWatch();
    replayReveals();
    requestAnimationFrame(() => $('results').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }));
  }

  function verdict(r) {
    const ratio = r.total / sumRates(D.globalRate);
    if (r.total >= 0.04 || ratio >= 3) return { cls: 'high', icon: '▲', text: 'High risk' };
    if (r.total >= 0.015 || ratio >= 1.25) return { cls: 'elevated', icon: '●', text: 'Elevated risk' };
    return { cls: 'low', icon: '✓', text: 'Low risk' };
  }

  // The answer as one big sentence, with the key facts as inline chips
  function statement(r, f) {
    const o = byCode(D.airports, f.origin), d = byCode(D.airports, f.dest), c = byCode(D.carriers, f.carrier);
    const top = [...r.causes].sort((a, b) => b.p - a.p)[0];
    const typical = sumRates(D.globalRate);
    const vs = r.total / typical;
    const day = new Date(f.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const mover = r.applied.filter((m) => marketFactor(m) > 1.05).sort((a, b) => marketFactor(b) - marketFactor(a))[0];
    const chip = (html, cls = '') => ({ chip: html, cls });
    let compare;
    if (vs >= 1.15) compare = ['That’s', chip(`${vs.toFixed(1)}×`, 'accent'), 'a typical flight, mostly'];
    else if (vs <= 0.85) compare = ['That’s below the', chip(fmtPct(typical), 'accent'), 'of a typical flight, mostly'];
    else compare = ['That’s about a typical flight', chip(fmtPct(typical), 'accent'), ', mostly'];
    const parts = [
      `${c.name} ${f.flight} from`, chip(`<i class="pin"></i>${o.city} <em>${o.code}</em>`),
      'to', chip(`<i class="pin"></i>${d.city} <em>${d.code}</em>`),
      'on', chip(day), 'has a', chip(fmtPct(r.total), 'ink'), 'chance of being cancelled.',
      ...compare,
      chip(`<i class="sw-dot s${top.slot}"></i>${top.name.toLowerCase()}`),
      mover ? 'risk, pushed up by a market at' : 'risk.',
    ];
    if (mover) parts.push(chip(fmtPct(mover.q, { digits: 0 }), 'market'), `on ${mover.title.charAt(0).toLowerCase() + mover.title.slice(1)}.`);
    let i = 0;
    return parts
      .map((p) => typeof p === 'string'
        ? p.split(' ').map((w) => `<span class="w" style="--i:${i++}">${w}</span>`).join(' ')
        : `<span class="w tag ${p.cls}" style="--i:${i++}">${p.chip}</span>`)
      .join(' ');
  }

  function render(opts = {}) {
    if (!current) return;
    const f = current;
    const money = Number($('f-money').value.replace(/[^\d.]/g, '')) || 0;
    const r = score(f, { disabled });
    const day = new Date(f.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = new Date(`2000-01-01T${f.time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    $('r-flight').textContent = `${f.carrier} ${f.flight} · ${f.origin} → ${f.dest} · ${day} · ${time}`;

    const st = $('r-statement');
    st.innerHTML = statement(r, f);
    st.classList.add('reveal');

    const v = verdict(r);
    $('r-verdict').className = 'verdict ' + v.cls;
    $('r-verdict').innerHTML = `<span aria-hidden="true">${v.icon}</span> ${v.text}`;
    const big = r.total * 100;
    const digits = big < 1 ? 2 : 1;
    if (opts.fresh) countUp($('r-p'), big, digits);
    else $('r-p').textContent = big.toFixed(digits);
    $('r-base').textContent = fmtPct(r.baseTotal);
    $('r-ci').textContent = `${fmtPct(r.lo)} – ${fmtPct(r.hi)}`;
    $('r-exp').textContent = fmtMoney(r.total * money);

    // Interval strip, axis rounded up to a whole percent
    const max = Math.max(Math.ceil(r.hi * 100 * 1.15), 2) / 100;
    $('r-ci-band').style.left = (r.lo / max) * 100 + '%';
    $('r-ci-band').style.width = ((r.hi - r.lo) / max) * 100 + '%';
    $('r-ci-mark').style.left = (r.total / max) * 100 + '%';
    $('r-ci-base').style.left = (r.baseTotal / max) * 100 + '%';
    $('r-ci-max').textContent = Math.round(max * 100) + '%';

    // Share of the cancel probability, by cause
    const stack = $('r-stack');
    stack.setAttribute('aria-label', 'Cancel chance by cause: ' + r.causes.map((c) => `${c.name} ${fmtPct(c.p)}`).join(', '));
    stack.innerHTML = r.causes
      .map((c, k) => `<div class="seg s${c.slot}" style="--w:${(c.p / r.total) * 100}%;--i:${k}" data-code="${c.code}"></div>`)
      .join('');

    // All five outcomes as numbered cards
    const maxCause = Math.max(...r.causes.map((c) => c.hi));
    $('r-legend').innerHTML =
      `<li class="cause-card flies reveal" style="--i:0">
        <span class="cc-index">01</span>
        <span class="cc-name">Flies as scheduled</span>
        <b class="cc-val">${fmtPct(1 - r.total, { digits: 1 })}</b>
        <span class="cc-note soft">The outcome you’re hoping for.</span>
      </li>` +
      r.causes
        .map((c, k) => {
          const moved = Math.abs(c.p / c.base - 1) > 0.005;
          return `<li class="cause-card reveal" style="--i:${k + 1}" data-code="${c.code}">
            <span class="cc-index">0${k + 2}</span>
            <span class="cc-name"><i class="sw-dot s${c.slot}"></i>${c.name}</span>
            <b class="cc-val">${fmtPct(c.p)}</b>
            <span class="cc-bar"><i class="s${c.slot}" style="--w:${(c.p / maxCause) * 100}%"></i><i class="cc-range" style="left:${(c.lo / maxCause) * 100}%;width:${((c.hi - c.lo) / maxCause) * 100}%"></i></span>
            <span class="cc-note soft">90% range ${fmtPct(c.lo)}–${fmtPct(c.hi)}${moved ? `<br>${c.p > c.base ? '▲' : '▼'} from ${fmtPct(c.base)} with markets` : ''}</span>
          </li>`;
        })
        .join('');

    // Markets in scope, each switchable
    $('r-markets').innerHTML = r.matched.length
      ? r.matched
          .map((m) => {
            const cause = byCode(CAUSES, m.cause);
            const fct = marketFactor(m);
            return `<label class="toggle">
              <input type="checkbox" ${disabled.has(m.id) ? '' : 'checked'} data-id="${m.id}">
              <span class="sw" aria-hidden="true"></span>
              <span class="toggle-text"><b>${m.title}</b><span class="soft small">${m.venue} · ${m.window} · usually ${fmtPct(m.qHist, { digits: 0 })}</span></span>
              <span class="toggle-price">${fmtPct(m.q, { digits: 0 })}</span>
              <span class="toggle-effect"><i class="sw-dot s${cause.slot}"></i>${cause.name} ×${fct.toFixed(2)}</span>
            </label>`;
          })
          .join('')
      : `<p class="empty">No live markets cover this airport and date, so this is the historical rate for this flight.</p>`;

    renderAlts(r);

    lastResult = r;
    // Re-rendered cards are already in view after a toggle; show them without replaying
    if (!opts.fresh) document.querySelectorAll('#results .reveal').forEach((el) => el.classList.add('in'));
  }
  let lastResult = null;

  // Other departures on the same route and day, lowest cancel chance first
  function renderAlts(r) {
    const f = current;
    const mine = r.total;
    const alts = scheduleFor('', f.origin, f.dest)
      .filter((x) => !(x.carrier === f.carrier && x.code === f.flight))
      .map((x) => {
        const alt = { carrier: x.carrier, flight: x.code, origin: f.origin, dest: f.dest, date: f.date, time: x.time };
        return { ...alt, name: x.carrierName, p: score(alt, { disabled }).total };
      })
      .sort((a, b) => a.p - b.p)
      .slice(0, 6);
    const better = alts.filter((a) => a.p < mine * 0.95).length;
    $('r-alts-sub').textContent = alts.length
      ? `Same day, same route, ranked by cancel chance. ${better ? `${better} ${better === 1 ? 'is' : 'are'} safer than yours.` : 'Yours is already one of the safest.'}`
      : 'No other departures found on this route that day.';
    const max = Math.max(mine, ...alts.map((a) => a.p)) * 1.1;
    const row = (a, k, isMine) => {
      const diff = (a.p - mine) * 100;
      const delta = isMine ? '<span class="alt-delta mine">Your flight</span>'
        : `<span class="alt-delta ${diff < 0 ? 'down' : 'up'}">${diff < 0 ? '▼' : '▲'} ${Math.abs(diff).toFixed(diff > -1 && diff < 1 ? 2 : 1)} pts</span>`;
      return `<li class="alt${isMine ? ' is-mine' : ''}" style="--i:${k}">
        <span class="alt-time">${fmtTime(a.time)}</span>
        <span class="alt-flight"><b>${a.carrier} ${a.flight}</b><span class="soft small">${esc(a.name)}</span></span>
        <span class="alt-bar"><i style="--w:${(a.p / max) * 100}%"></i></span>
        <b class="alt-p">${fmtPct(a.p)}</b>
        ${delta}
        ${isMine ? '<span></span>' : `<button class="btn btn-ghost btn-sm" type="button" data-alt="${k}">Check</button>`}
      </li>`;
    };
    // Your flight sits in the list at its rank so the comparison is obvious
    const mineRow = { carrier: f.carrier, flight: f.flight, time: f.time, name: byCode(D.carriers, f.carrier).name, p: mine };
    const list = [...alts.map((a, k) => ({ a, k })), { a: mineRow, k: -1 }].sort((x, y) => x.a.p - y.a.p);
    $('r-alts').innerHTML = list.map(({ a, k }) => row(a, k, k === -1)).join('');
    altData = alts;
  }
  let altData = [];
  $('r-alts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-alt]');
    if (!b) return;
    const a = altData[Number(b.dataset.alt)];
    const f = { carrier: a.carrier, flight: a.flight, origin: a.origin, dest: a.dest, date: a.date, time: a.time };
    setForm(f);
    check(f);
  });

  $('r-markets').addEventListener('change', (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    e.target.checked ? disabled.delete(id) : disabled.add(id);
    render();
    renderWatch();
  });
  $('f-money').addEventListener('input', render);

  const outcomes = $('outcomes');
  outcomes.addEventListener('pointermove', (e) => {
    const el = e.target.closest('[data-code]');
    if (!el || !lastResult) return hideTip();
    const c = lastResult.causes.find((x) => x.code === el.dataset.code);
    showTip(e, `<b>${c.name}</b><br>${fmtPct(c.p)} chance<br><span class="soft">90% range ${fmtPct(c.lo)}–${fmtPct(c.hi)}</span><br><span class="soft">${fmtPct(c.p / lastResult.total, { digits: 0 })} of the cancel risk</span>`, outcomes);
  });
  outcomes.addEventListener('pointerleave', hideTip);

  // ---------- Trip Watch timeline ----------
  function sparkPath(vals, w, h, pad = 2, max = Math.max(...vals) * 1.1) {
    return vals
      .map((v, i) => `${i ? 'L' : 'M'}${((i / (vals.length - 1)) * w).toFixed(1)},${(h - pad - (v / max) * (h - pad * 2)).toFixed(1)}`)
      .join('');
  }

  const watch = { idx: 0, days: 15, series: [], hist: [] };
  function renderWatch() {
    const r = lastResult;
    // Follow the market that moves this flight the most
    const m = r.applied.slice().sort((a, b) => marketFactor(b) - marketFactor(a))[0];
    $('watch').hidden = !m;
    if (!m) return;
    const days = m.history.length;
    watch.days = days;
    watch.hist = m.history;
    watch.series = m.history.map((q) => score(current, { disabled, qOverride: { [m.id]: q } }).total);
    $('tl-title').textContent = `${current.carrier} ${current.flight} · ${current.origin} → ${current.dest}`;
    $('tl-market-label').textContent = m.title;
    $('tl-base').textContent = `${current.carrier} ${current.origin}→${current.dest} · ${r.band} departures · ${fmtPct(r.baseTotal)}`;

    const W = 1000, H = 60;
    const draw = (svg, vals) => {
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const d = sparkPath(vals, W, H, 6);
      svg.innerHTML = `<path class="area" d="${d}L${W},${H}L0,${H}Z"/><path class="line" pathLength="1" d="${d}"/>`;
    };
    draw($('tl-spark'), m.history);
    draw($('tl-out'), watch.series);

    $('tl-ruler').innerHTML = m.history
      .map((_, i) => (i % 2 ? '' : `<span style="left:${(i / (days - 1)) * 100}%">${i === days - 1 ? 'Today' : 'T−' + (days - 1 - i)}</span>`))
      .join('');

    // Alert when the market climbs 5+ points over two days
    let alerts = '';
    for (let i = 2; i < days; i++) {
      const jump = m.history[i] - m.history[i - 2] >= 0.05;
      const prevJump = i > 2 && m.history[i - 1] - m.history[i - 3] >= 0.05;
      if (jump && !prevJump) alerts += `<span class="alert-pin" style="left:${(i / (days - 1)) * 100}%">${fmtPct(m.history[i - 2], { digits: 0 })} → ${fmtPct(m.history[i], { digits: 0 })}</span>`;
    }
    $('tl-alerts').innerHTML = alerts || '<span class="soft small lane-note">No big moves yet</span>';
    setIdx(days - 1);
  }

  const tracks = $('tracks');
  const head = $('tl-playhead');
  function setIdx(i) {
    const { days, series, hist } = watch;
    if (!series.length) return;
    watch.idx = Math.max(0, Math.min(days - 1, i));
    const idx = watch.idx;
    const lane = tracks.querySelector('.lane').getBoundingClientRect();
    const tr = tracks.getBoundingClientRect();
    head.style.left = lane.left - tr.left + (idx / (days - 1)) * lane.width + 'px';
    const out = days - 1 - idx;
    $('tl-day').textContent = (out ? `${out} days ago` : 'Today') + ` · market ${fmtPct(hist[idx], { digits: 0 })} · your odds`;
    $('tl-p').textContent = fmtPct(series[idx]);
    head.setAttribute('aria-valuenow', String(out));
    head.setAttribute('aria-valuetext', `${out} days ago, ${fmtPct(series[idx])} chance of cancellation`);
  }
  function fromEvent(e) {
    const lane = tracks.querySelector('.lane').getBoundingClientRect();
    setIdx(Math.round(((e.clientX - lane.left) / lane.width) * (watch.days - 1)));
  }
  let scrubbing = false;
  tracks.addEventListener('pointerdown', (e) => { scrubbing = true; tracks.setPointerCapture(e.pointerId); fromEvent(e); });
  tracks.addEventListener('pointermove', (e) => { if (scrubbing) fromEvent(e); });
  tracks.addEventListener('pointerup', () => { scrubbing = false; });
  head.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { setIdx(watch.idx - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setIdx(watch.idx + 1); e.preventDefault(); }
  });
  window.addEventListener('resize', () => setIdx(watch.idx));

  // ---------- other markets ----------
  const grid = $('market-grid');
  function renderGrid() {
  grid.innerHTML = D.markets
    .filter((m) => m.liquidity >= D.minLiquidity)
    .map((m, k) => {
      const cause = byCode(CAUSES, m.cause);
      const scope = m.scope.national ? 'National' : m.scope.label || m.scope.airports.join(' · ');
      return `<article class="market-card reveal" style="--i:${k}">
        <header><span class="pill">${m.venue}</span><span class="pill"><i class="sw-dot s${cause.slot}"></i>${cause.name}</span></header>
        <h3>${m.title}</h3>
        <p class="soft small">${scope} · ${m.window}</p>
        <div class="market-num"><b>${fmtPct(m.q, { digits: 0 })}</b><span class="soft small">${fmtPct(m.history[0], { digits: 0 })} → ${fmtPct(m.q, { digits: 0 })} in 14 days</span></div>
        <div class="spark" data-id="${m.id}">
          <svg viewBox="0 0 240 56" preserveAspectRatio="none"><path pathLength="1" d="${sparkPath(m.history, 240, 56)}" /></svg>
          <span class="spark-dot"></span>
        </div>
        <dl>
          <div><dt>${cause.name} risk</dt><dd>×${marketFactor(m).toFixed(2)}</dd></div>
          <div><dt>Event lift</dt><dd>×${m.lift.toFixed(1)}</dd></div>
          <div><dt>Liquidity</dt><dd>$${fmtK(m.liquidity)}</dd></div>
        </dl>
        <button class="btn btn-light btn-sm" data-apply="${m.id}">Check a flight it affects</button>
      </article>`;
    })
    .join('');

  // Sparkline hover: nearest day readout
  grid.querySelectorAll('.spark').forEach((sp) => {
    const m = D.markets.find((x) => x.id === sp.dataset.id);
    const dot = sp.querySelector('.spark-dot');
    const max = Math.max(...m.history) * 1.1;
    sp.addEventListener('pointermove', (e) => {
      const r = sp.getBoundingClientRect();
      const i = Math.max(0, Math.min(m.history.length - 1, Math.round(((e.clientX - r.left) / r.width) * (m.history.length - 1))));
      const v = m.history[i];
      dot.style.left = (i / (m.history.length - 1)) * 100 + '%';
      dot.style.top = (1 - 2 / 56 - (v / max) * (52 / 56)) * 100 + '%';
      dot.dataset.label = `${m.history.length - 1 - i ? m.history.length - 1 - i + 'd ago' : 'Today'} · ${fmtPct(v, { digits: 0 })}`;
      sp.classList.add('hover');
    });
    sp.addEventListener('pointerleave', () => sp.classList.remove('hover'));
  });
  grid.querySelectorAll('.reveal').forEach((el) => revealer.observe(el));
  }
  renderGrid();

  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-apply]');
    if (!b) return;
    if (EXAMPLES[b.dataset.apply]) {
      setForm(EXAMPLES[b.dataset.apply]);
      check(EXAMPLES[b.dataset.apply]);
      return;
    }
    // Live market: start a search from an airport it covers, on a date inside its window
    const m = D.markets.find((x) => x.id === b.dataset.apply);
    const inState = (st) => D.airports.filter((a) => a.state === st).sort((a, z) => z.hub - a.hub)[0];
    const from = m.scope.national ? 'ATL' : byCode(D.airports, m.scope.airports[0]) ? m.scope.airports[0] : (inState(m.scope.airports[0]) || {}).code;
    const today = new Date().toISOString().slice(0, 10);
    setForm({ carrier: '', flight: '', origin: from || '', dest: '', date: m.dates[0] < today ? today : m.dates[0], time: '09:00' });
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    setTimeout(() => $('f-dest-q').focus(), reduceMotion ? 0 : 500);
  });

  // A flight in the URL (from the daily game, or a shared link) is checked straight away
  (function fromUrl() {
    const p = new URLSearchParams(location.search);
    const f = Object.fromEntries(['carrier', 'flight', 'origin', 'dest', 'date', 'time'].map((k) => [k, p.get(k) || '']));
    if (!f.time) f.time = '09:00';
    if (validate(f) || !byCode(D.carriers, f.carrier) || !byCode(D.airports, f.origin) || !byCode(D.airports, f.dest)) return;
    setForm(f);
    check(f);
  })();

  // ---------- live data ----------
  window.addEventListener('fp-live', (e) => {
    const badge = $('data-badge');
    badge.hidden = false;
    badge.classList.toggle('on', e.detail.on);
    badge.textContent = e.detail.on ? 'Live · Snowflake' : 'Sample data';
    badge.title = e.detail.on ? `Flights through ${e.detail.info.data_through}, ${e.detail.info.markets} live markets` : 'Start backend/api.py for live data';
    if (e.detail.on) renderGrid();
  });
  if (window.FPLive) window.FPLive.init();

  // ---------- hero ----------
  const tags = [...document.querySelectorAll('.charm-tag')];
  window.FPPlane && window.FPPlane.mountHero($('hero-canvas'), tags);
  // Tag order matches the charms: orange, blue, green
  [EXAMPLES['fl-storm'], EXAMPLES['ord-snow'], EXAMPLES['den-wind']].forEach((f, i) => {
    tags[i].textContent = `${f.carrier} ${f.flight} · ${fmtPct(score(f).total)}`;
  });
})();
