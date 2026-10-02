// Database-only route lookup and display.
(function () {
  const $ = (id) => document.getElementById(id);
  const airports = window.FP_DATA.airports;
  let catalogLoading = true;
  let catalogError = '';
  const byCode = (code) => airports.find((airport) => airport.code === code);
  const form = $('flight-form');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  function searchAirports(text, limit = 8) {
    const query = text.trim().toLowerCase();
    if (!query) return airports.filter((airport) => airport.hub === 2).slice(0, limit);
    const rank = (airport) => {
      const code = airport.code.toLowerCase();
      const city = airport.city.toLowerCase();
      const name = airport.name.toLowerCase();
      if (code === query) return 0;
      if (city.startsWith(query)) return 1;
      if (code.startsWith(query)) return 2;
      if (name.startsWith(query)) return 3;
      if (city.includes(query) || name.includes(query)) return 4;
      if (airport.state.toLowerCase() === query) return 5;
      return 99;
    };
    return airports.map((airport) => ({ airport, rank: rank(airport) }))
      .filter((item) => item.rank < 99)
      .sort((a, b) => a.rank - b.rank || b.airport.hub - a.airport.hub)
      .slice(0, limit).map((item) => item.airport);
  }

  function airportCombo(key) {
    const input = $(`f-${key}-q`);
    const hidden = $(`f-${key}`);
    const list = $(`f-${key}-list`);
    let items = [];
    let active = -1;
    let blurTimer;
    function render() {
      list.innerHTML = items.map((airport, index) => (
        `<li role="option" id="f-${key}-opt-${index}" data-index="${index}" aria-selected="${index === active}">` +
        `<b>${airport.code}</b><span>${escapeHtml(airport.city)}, ${escapeHtml(airport.state)}` +
        `<small>${escapeHtml(airport.name)}</small></span></li>`
      )).join('');
      if (!items.length) {
        const hint = catalogLoading ? 'Loading airports…'
          : catalogError ? 'Airport search is unavailable. Please reload and try again.'
            : 'No matching airports. Try a city name or a three-letter airport code.';
        list.innerHTML = `<li class="combo-hint" role="option" aria-disabled="true">${hint}</li>`;
      }
      list.hidden = false;
      input.setAttribute('aria-expanded', String(!list.hidden));
      if (items[active]) {
        input.setAttribute('aria-activedescendant', `f-${key}-opt-${active}`);
        list.children[active].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }
    function open() {
      items = searchAirports(hidden.value ? '' : input.value);
      active = items.length ? 0 : -1;
      render();
    }
    function close() {
      list.hidden = true;
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function set(code) {
      const airport = byCode(String(code || '').toUpperCase());
      hidden.value = airport ? airport.code : '';
      input.value = airport ? `${airport.city}, ${airport.state} (${airport.code})` : '';
      input.removeAttribute('aria-invalid');
    }
    function choose(airport) {
      set(airport.code);
      close();
    }
    function resolve() {
      if (hidden.value || !input.value.trim()) return hidden.value;
      const matches = searchAirports(input.value, 2);
      const exact = matches.find((airport) => airport.code.toLowerCase() === input.value.trim().toLowerCase());
      if (exact || matches.length === 1) set((exact || matches[0]).code);
      return hidden.value;
    }
    input.addEventListener('input', () => { hidden.value = ''; open(); });
    input.addEventListener('focus', () => { clearTimeout(blurTimer); input.select(); open(); });
    input.addEventListener('blur', () => { blurTimer = setTimeout(() => { close(); resolve(); }, 120); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (list.hidden) {
          open();
          active = event.key === 'ArrowUp' ? items.length - 1 : 0;
        } else if (items.length) {
          active = (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        }
        render();
        event.preventDefault();
      } else if (event.key === 'Enter' && !list.hidden && items[active]) {
        choose(items[active]);
        event.preventDefault();
      } else if (event.key === 'Escape') close();
    });
    list.addEventListener('pointerdown', (event) => {
      const row = event.target.closest('[data-index]');
      if (!row) return;
      event.preventDefault();
      choose(items[Number(row.dataset.index)]);
    });
    return {
      set,
      resolve,
      refresh() {
        if (document.activeElement === input && !list.hidden) open();
      },
    };
  }

  const originCombo = airportCombo('origin');
  const destCombo = airportCombo('dest');
  $('f-swap').addEventListener('click', () => {
    const origin = originCombo.resolve();
    originCombo.set(destCombo.resolve());
    destCombo.set(origin);
  });

  function validationError(route) {
    if (catalogLoading) return ['f-origin-q', 'Airport search is still loading. Please wait a moment.'];
    if (catalogError) return ['f-origin-q', 'Airport search is unavailable. Please reload and try again.'];
    if (!route.origin) return ['f-origin-q', 'Pick where you fly from. Search by city or airport code.'];
    if (!route.dest) return ['f-dest-q', 'Pick where you fly to. Search by city or airport code.'];
    if (route.origin === route.dest) return ['f-dest-q', 'Origin and destination are the same airport.'];
    if (!route.date) return ['f-date', 'Pick your travel date.'];
    return null;
  }

  function displayResult(route, response) {
    const origin = byCode(route.origin);
    const dest = byCode(route.dest);
    const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 6 })
      .format(Number(response.delayed_or_cancelled));
    const day = new Date(`${route.date}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
<<<<<<< HEAD
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
      await window.FPLive.route(f.origin, f.dest, f.date);
      btn.disabled = false;
      btn.textContent = 'Check my route';
    }
    // Ask the backend to run load_rows.load_database() for this route. When it
    // answers, the hero answer switches from the model's cancel-only chance to
    // the historical delayed-or-cancelled rate for this route.
    dbRate = null;
    if (window.FPLive) {
      window.FPLive.database(f.origin, f.dest, f.date).then((r) => {
        if (!r || current !== f) return;  // stale reply for an earlier route
        dbRate = r.delayed_or_cancelled;
        render();
      });
    }
    current = f;
    disabled.clear();
    $('results').hidden = false;
    $('nav-new').hidden = false;
    document.querySelector('.nav-flight').hidden = false;
    document.body.classList.add('has-results');
    document.querySelectorAll('#results .reveal').forEach((element) => element.classList.add('in'));
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
    const o = byCode(D.airports, f.origin), d = byCode(D.airports, f.dest);
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
      'A flight from', chip(`<i class="pin"></i>${o.city} <em>${o.code}</em>`),
      'to', chip(`<i class="pin"></i>${d.city} <em>${d.code}</em>`),
      'on', chip(day), 'has a', chip(fmtPct(dbRate != null ? dbRate : r.total), 'ink'),
      dbRate != null ? 'chance of being delayed or cancelled.' : 'chance of being cancelled.',
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
    $('r-flight').textContent = `${f.origin} → ${f.dest} · ${day}`;

    const st = $('r-statement');
    st.innerHTML = statement(r, f);
    st.classList.add('reveal');

    const v = verdict(r);
    $('r-verdict').className = 'verdict ' + v.cls;
    $('r-verdict').innerHTML = `<span aria-hidden="true">${v.icon}</span> ${v.text}`;
    // Hero answer: the delayed-or-cancelled rate once load_database answers,
    // the model's cancel-only chance until then (or if the backend is down).
    const heroRate = dbRate != null ? dbRate : r.total;
    const big = heroRate * 100;
    const digits = big < 1 ? 2 : 1;
    if (opts.fresh) countUp($('r-p'), big, digits);
    else $('r-p').textContent = big.toFixed(digits);
    $('r-caption').textContent = dbRate != null
      ? 'chance a flight on this route is delayed or cancelled'
      : 'chance a flight on this route is cancelled';
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

    lastResult = r;
    // Re-rendered cards are already in view after a toggle; show them without replaying
    if (!opts.fresh) document.querySelectorAll('#results .reveal').forEach((el) => el.classList.add('in'));
  }
  let lastResult = null;

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
    $('tl-title').textContent = `${current.origin} → ${current.dest}`;
    $('tl-market-label').textContent = m.title;
    $('tl-base').textContent = `${current.origin}→${current.dest} · ${r.band} departures · ${fmtPct(r.baseTotal)}`;

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
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const route = { origin: originCombo.resolve(), dest: destCombo.resolve(), date: $('f-date').value };
    const error = validationError(route);
    form.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
    if (error) {
      $('f-error').textContent = error[1];
      $('f-error').hidden = false;
      $(error[0]).setAttribute('aria-invalid', 'true');
      $(error[0]).focus();
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = 'Checking Snowflake…';
    const response = window.FPLive ? await window.FPLive.database(route.origin, route.dest, route.date) : null;
    button.disabled = false;
    button.textContent = 'Check my route';
    if (!response || !Number.isFinite(Number(response.delayed_or_cancelled))) {
      $('f-error').textContent = 'Could not load this route from Snowflake. Check the backend connection and try again.';
      $('f-error').hidden = false;
      $('results').hidden = true;
      document.body.classList.remove('has-results');
      return;
    }
    $('f-error').hidden = true;
    displayResult(route, response);
  });

  const params = new URLSearchParams(location.search);
  const initial = {
    origin: (params.get('origin') || '').toUpperCase(),
    dest: (params.get('dest') || '').toUpperCase(),
    date: params.get('date') || '',
  };
  window.addEventListener('fp-catalog', (event) => {
    catalogLoading = false;
    catalogError = event.detail.ok ? '' : (event.detail.error || 'Airport catalog unavailable');
    originCombo.refresh();
    destCombo.refresh();
  });
  window.addEventListener('fp-live', (event) => {
    const badge = $('data-badge');
    badge.hidden = false;
    badge.classList.toggle('on', event.detail.on);
    badge.textContent = event.detail.on ? 'Live · Snowflake' : 'Snowflake unavailable';
    badge.title = event.detail.on ? 'Showing backend data only' : (event.detail.error || 'Backend unavailable');
    if (event.detail.on && byCode(initial.origin) && byCode(initial.dest) && initial.date) {
      originCombo.set(initial.origin);
      destCombo.set(initial.dest);
      $('f-date').value = initial.date;
      form.requestSubmit();
    }
  });
  if (window.FPLive) window.FPLive.init();
  if (window.FPPlane) window.FPPlane.mountHero($('hero-canvas'), [...document.querySelectorAll('.charm-tag')]);
})();
