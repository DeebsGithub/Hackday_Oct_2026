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
    $('r-flight').textContent = `${route.origin} → ${route.dest} · ${day}`;
    $('r-statement').textContent = `Snowflake reports that ${percent} of historical flights from ${origin.city} (${origin.code}) to ${dest.city} (${dest.code}) were delayed or cancelled.`;
    $('r-verdict').className = 'verdict';
    $('r-verdict').textContent = 'Snowflake result';
    $('r-p').textContent = percent.replace('%', '');
    $('results').hidden = false;
    $('nav-new').hidden = false;
    document.querySelector('.nav-flight').hidden = false;
    document.body.classList.add('has-results');
    document.querySelectorAll('#results .reveal').forEach((element) => element.classList.add('in'));
    requestAnimationFrame(() => $('results').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }));
  }

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
