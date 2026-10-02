// Cancelled? — a daily Wordle-style game. Guess a mystery flight's cancel chance as DD.DD%.
// Digits score like Wordle, each guess unlocks a clue, and an arrow says higher or lower.

(function () {
  const D = window.FP_DATA;
  const { score, fmtPct, byCode, sumRates, marketFactor } = window.FP;
  const $ = (id) => document.getElementById(id);
  const ROWS = 6;
  const DAY = 864e5;
  const EPOCH = Date.UTC(2026, 9, 1); // puzzle #1 is Oct 1, 2026
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FLIP = reduce ? 0 : 280; // ms between tile flips

  // ---------- puzzle ----------
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pickFrom = (r, list) => list[Math.floor(r() * list.length)];
  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

  function makePuzzle(seed) {
    const r = rng(seed * 7919 + 17);
    const big = D.airports.filter((a) => a.hub >= 1);
    const carrier = pickFrom(r, D.carriers.slice(0, 9)).code;
    let origin, date;
    // Four days in ten, build the puzzle around a live weather market
    const live = D.markets.filter((m) => m.liquidity >= D.minLiquidity && !m.scope.national);
    if (r() < 0.4 && live.length) {
      const m = pickFrom(r, live);
      origin = pickFrom(r, m.scope.airports);
      const start = Date.parse(m.dates[0]), end = Date.parse(m.dates[1]);
      date = isoDay(start + Math.floor(r() * ((end - start) / DAY + 1)) * DAY);
    } else {
      origin = pickFrom(r, big).code;
      date = isoDay(EPOCH + (seed + 5 + Math.floor(r() * 90)) * DAY);
    }
    let dest = pickFrom(r, big).code;
    while (dest === origin) dest = pickFrom(r, big).code;
    const mins = 360 + Math.floor(r() * 186) * 5;
    const time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const f = { carrier, flight: String(100 + Math.floor(r() * 2900)), origin, dest, date, time };
    const result = score(f);
    // Answer as four digits DDdd, e.g. 4.21% -> "0421"
    const answer = String(Math.min(9999, Math.round(result.total * 10000))).padStart(4, '0');
    return { f, result, answer };
  }

  function clues(p) {
    const { f, result } = p;
    const c = byCode(D.carriers, f.carrier);
    const o = byCode(D.airports, f.origin);
    const d = byCode(D.airports, f.dest);
    const dt = new Date(f.date + 'T12:00:00');
    const hour = Number(f.time.slice(0, 2));
    const part = hour < 10 ? 'morning' : hour < 16 ? 'midday' : 'evening';
    const m = result.applied.slice().sort((a, b) => marketFactor(b) - marketFactor(a))[0];
    return [
      { icon: '◷', label: 'When', value: `${dt.toLocaleDateString('en-US', { month: 'long' })} ${part}` },
      { icon: '✈', label: 'Airline', value: c.name },
      { icon: '↗', label: 'From', value: `${o.city} ${o.code}` },
      { icon: '↘', label: 'To', value: `${d.city} ${d.code}` },
      { icon: '◆', label: 'Live market', value: m ? `${m.short} at ${fmtPct(m.q, { digits: 0 })}` : 'None in play' },
      { icon: '≈', label: 'Typical rate', value: fmtPct(result.baseTotal) },
    ];
  }

  // Wordle scoring with repeated digits handled the usual two-pass way
  function grade(guess, answer) {
    const res = Array(4).fill('miss');
    const left = {};
    for (let i = 0; i < 4; i++) {
      if (guess[i] === answer[i]) res[i] = 'hit';
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < 4; i++) {
      if (res[i] !== 'hit' && left[guess[i]]) {
        res[i] = 'near';
        left[guess[i]]--;
      }
    }
    return res;
  }
  const toDigits = (buf) => {
    const [i = '', f = ''] = buf.split('.');
    return i.padStart(2, '0').slice(-2) + f.padEnd(2, '0').slice(0, 2);
  };
  const fmtDigits = (s) => `${Number(s.slice(0, 2))}.${s.slice(2)}%`;

  // ---------- storage (per viewer, optional) ----------
  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const emptyStats = { played: 0, wins: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0], last: 0 };

  // ---------- state ----------
  const now = new Date();
  const today = Math.max(1, Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - EPOCH) / DAY) + 1);
  let S = null;

  function start(n, practice) {
    const puzzle = makePuzzle(n);
    const saved = practice ? null : store.get(`fp-cancelled-${n}`, null);
    // Only keep well-formed guesses (four digits each)
    if (saved && !(Array.isArray(saved.guesses) && saved.guesses.every((g) => /^\d{4}$/.test(g)))) saved.guesses = [];
    S = { n, practice, puzzle, clues: clues(puzzle), guesses: saved ? saved.guesses : [], buf: '', busy: false };
    $('g-kicker').textContent = practice ? 'Practice round' : `Daily #${n} · ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    buildBoard();
    buildClues();
    buildKeys();
    if (done()) setTimeout(() => openEnd(), 500);
  }

  const won = () => S.guesses.includes(S.puzzle.answer);
  const done = () => won() || S.guesses.length >= ROWS;
  const unlocked = () => Math.min(S.clues.length, S.guesses.length + 1 + (done() ? 99 : 0));

  // ---------- board ----------
  function tileHTML() {
    return `<div class="tile" data-i="0"></div><div class="tile" data-i="1"></div><span class="dot">.</span>
      <div class="tile" data-i="2"></div><div class="tile" data-i="3"></div><span class="pct">%</span><span class="hint"></span>`;
  }

  function buildBoard() {
    const board = $('g-board');
    board.innerHTML = Array.from({ length: ROWS }, (_, r) => `<div class="row" role="row" data-r="${r}">${tileHTML()}</div>`).join('');
    S.guesses.forEach((g, r) => paintRow(r, g, false));
    paintCurrent();
  }

  function rowEl(r) { return $('g-board').children[r]; }

  function paintRow(r, digits, animate) {
    const row = rowEl(r);
    const res = grade(digits, S.puzzle.answer);
    const tiles = [...row.querySelectorAll('.tile')];
    tiles.forEach((t, i) => {
      t.textContent = digits[i];
      t.setAttribute('aria-label', `${digits[i]}, ${{ hit: 'correct', near: 'in the answer, wrong spot', miss: 'not in the answer' }[res[i]]}`);
      const apply = () => { t.className = `tile ${res[i]}`; };
      if (!animate) { apply(); return; }
      t.style.animationDelay = `${i * FLIP}ms`;
      t.classList.add('flip');
      setTimeout(apply, i * FLIP + FLIP * 0.9);
    });
    const hint = row.querySelector('.hint');
    const g = Number(digits), a = Number(S.puzzle.answer);
    const showHint = () => {
      hint.className = 'hint show ' + (g === a ? 'win' : '');
      hint.textContent = g === a ? '✓' : a > g ? '↑' : '↓';
      hint.setAttribute('aria-label', g === a ? 'Correct' : a > g ? 'Higher' : 'Lower');
    };
    if (animate) setTimeout(showHint, 4 * FLIP + 200); else showHint();
    row.classList.add('done');
  }

  // The row being typed: integer digits fill from the right of the two-digit slot, decimals from the left
  function paintCurrent() {
    if (done()) return;
    const row = rowEl(S.guesses.length);
    if (!row) return;
    const [i = '', f = ''] = S.buf.split('.');
    const hasDot = S.buf.includes('.');
    const slots = [i.length > 1 ? i[i.length - 2] : '', i.length ? i[i.length - 1] : '', f[0] || '', f[1] || ''];
    row.querySelectorAll('.tile').forEach((t, k) => {
      const had = t.textContent;
      t.textContent = slots[k];
      t.className = 'tile' + (slots[k] ? ' filled' : '') + (!slots[k] && k < 2 && (i.length || hasDot) ? ' ghost' : '');
      if (slots[k] && had !== slots[k] && !reduce) {
        t.classList.remove('pop');
        void t.offsetWidth;
        t.classList.add('pop');
      }
    });
    row.querySelector('.dot').classList.toggle('lit', hasDot);
    row.classList.add('current');
  }

  // ---------- clues ----------
  function buildClues() {
    const n = unlocked();
    $('g-clues').innerHTML = S.clues
      .map((c, i) => `<li class="clue${i < n ? ' open' : ''}" style="--d:${i}">
        <div class="clue-inner">
          <div class="clue-face clue-back"><span>${i + 1}</span><small>after guess ${i}</small></div>
          <div class="clue-face clue-front"><span class="clue-label">${c.icon} ${c.label}</span><b>${c.value}</b></div>
        </div></li>`)
      .join('');
  }
  function revealClues() {
    const n = unlocked();
    [...$('g-clues').children].forEach((li, i) => {
      if (i < n && !li.classList.contains('open')) li.classList.add('open', 'fresh');
    });
  }

  // ---------- keypad ----------
  const KEYS = [['1', '2', '3', '4', '5'], ['6', '7', '8', '9', '0'], ['enter', '.', 'back']];
  function buildKeys() {
    $('g-keys').innerHTML = KEYS.map((row) => `<div class="key-row">${row
      .map((k) => {
        const label = k === 'enter' ? 'Guess' : k === 'back' ? '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12V5Zm-9 4 6 6m0-6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>' : k;
        const aria = k === 'back' ? 'aria-label="Delete"' : k === '.' ? 'aria-label="Decimal point"' : '';
        return `<button type="button" class="key${k.length > 1 ? ' wide' : ''}" data-k="${k}" ${aria}>${label}</button>`;
      })
      .join('')}</div>`).join('');
    paintKeys();
  }
  // Each digit key shows the best thing we know about it
  function paintKeys() {
    const best = {};
    const rank = { hit: 3, near: 2, miss: 1 };
    S.guesses.forEach((g) => grade(g, S.puzzle.answer).forEach((r, i) => {
      if (!best[g[i]] || rank[r] > rank[best[g[i]]]) best[g[i]] = r;
    }));
    $('g-keys').querySelectorAll('[data-k]').forEach((b) => {
      const st = best[b.dataset.k];
      b.className = 'key' + (b.dataset.k.length > 1 ? ' wide' : '') + (st ? ' ' + st : '');
    });
  }

  // ---------- input ----------
  function press(k) {
    if (!S || S.busy || done()) return;
    if (k === 'back') S.buf = S.buf.slice(0, -1);
    else if (k === 'enter') return submit();
    else if (k === '.') { if (!S.buf.includes('.')) S.buf += S.buf ? '.' : '0.'; }
    else if (/^\d$/.test(k)) {
      const [i = '', f] = S.buf.split('.');
      if (f === undefined && i.length >= 2) {
        // Third digit without a dot: assume they meant d.dd, like typing 421 for 4.21
        S.buf = `${i[0]}.${i[1]}${k}`;
      } else if (f !== undefined && f.length >= 2) return bump();
      else S.buf += k;
    }
    paintCurrent();
  }

  function bump() {
    const row = rowEl(S.guesses.length);
    if (!row || reduce) return;
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
  }

  function submit() {
    if (!S.buf.replace('.', '')) { toast('Type a percentage first'); return bump(); }
    const digits = toDigits(S.buf);
    const r = S.guesses.length;
    S.guesses.push(digits);
    S.buf = '';
    S.busy = true;
    if (!S.practice) store.set(`fp-cancelled-${S.n}`, { guesses: S.guesses });
    rowEl(r).classList.remove('current');
    paintRow(r, digits, true);
    const settle = 4 * FLIP + 350;
    setTimeout(() => {
      S.busy = false;
      paintKeys();
      revealClues();
      if (won()) {
        celebrate(r);
        toast(['Pilot-grade', 'Superb', 'Sharp', 'Nice', 'Solid', 'Phew'][r]);
        finish(true);
      } else if (done()) {
        toast(fmtDigits(S.puzzle.answer), 4000);
        finish(false);
      } else {
        const g = Number(digits), a = Number(S.puzzle.answer);
        const off = Math.abs(a - g) / Math.max(a, 1);
        toast(off < 0.15 ? 'So close' : a > g ? 'Higher' : 'Lower', 1200);
        paintCurrent();
      }
    }, settle);
  }

  function celebrate(r) {
    if (reduce) return;
    rowEl(r).querySelectorAll('.tile').forEach((t, i) => {
      t.style.animationDelay = `${i * 90}ms`;
      t.classList.add('bounce');
    });
  }

  function finish(win) {
    if (!S.practice) {
      const st = store.get('fp-cancelled-stats', emptyStats);
      if (st.last !== S.n) {
        st.played++;
        if (win) {
          st.wins++;
          st.dist[S.guesses.length - 1]++;
          st.streak = st.last === S.n - 1 ? st.streak + 1 : 1;
          st.best = Math.max(st.best, st.streak);
        } else st.streak = 0;
        st.last = S.n;
        store.set('fp-cancelled-stats', st);
      }
    }
    setTimeout(openEnd, win ? 1400 : 1800);
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$('g-help').hidden || !$('g-end').hidden) {
      if (e.key === 'Escape') closeModals();
      return;
    }
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === '.' || e.key === ',') press('.');
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') { e.preventDefault(); press('enter'); }
  });
  $('g-keys').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (b) { press(b.dataset.k); b.blur(); }
  });

  // ---------- toasts ----------
  function toast(text, ms = 1600) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    $('g-toasts').prepend(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  // ---------- modals ----------
  let lastFocus = null;
  function openModal(id) {
    lastFocus = document.activeElement;
    const m = $(id);
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('in'));
    m.querySelector('[data-close]').focus();
  }
  function closeModals() {
    document.querySelectorAll('.g-modal').forEach((m) => {
      if (m.hidden) return;
      m.classList.remove('in');
      setTimeout(() => { m.hidden = true; }, reduce ? 0 : 250);
    });
    if (lastFocus) lastFocus.focus();
  }
  document.querySelectorAll('.g-modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModals(); });
  });
  $('g-help-btn').addEventListener('click', () => openModal('g-help'));
  $('g-stats-btn').addEventListener('click', () => openEnd());

  function shareText() {
    const rows = S.guesses.map((g) => {
      const cells = grade(g, S.puzzle.answer).map((r) => ({ hit: '🟩', near: '🟨', miss: '⬛' }[r]));
      const a = Number(S.puzzle.answer), n = Number(g);
      return `${cells[0]}${cells[1]}.${cells[2]}${cells[3]} ${n === a ? '✅' : a > n ? '⬆️' : '⬇️'}`;
    });
    return `Cancelled? ${S.practice ? 'practice' : '#' + S.n} ${won() ? S.guesses.length : 'X'}/${ROWS}\n${rows.join('\n')}`;
  }

  function countdown() {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const ms = Math.max(0, next - Date.now());
    const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4), s = Math.floor((ms % 6e4) / 1e3);
    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  }

  let timer = null;
  function openEnd() {
    const st = store.get('fp-cancelled-stats', emptyStats);
    const f = S.puzzle.f, r = S.puzzle.result;
    const top = [...r.causes].sort((a, b) => b.p - a.p)[0];
    const max = Math.max(1, ...st.dist);
    const params = new URLSearchParams(f).toString();
    const finished = done();
    $('g-end-body').innerHTML = `
      ${finished ? `
        <p class="kicker">${won() ? `Solved in ${S.guesses.length}` : 'The answer was'}</p>
        <div class="end-answer"><b>${fmtDigits(S.puzzle.answer)}</b></div>
        <p class="end-flight">${f.carrier} ${f.flight} · ${f.origin} → ${f.dest} · ${new Date(f.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
        <p class="muted small">Mostly ${top.name.toLowerCase()} risk. A typical US flight is ${fmtPct(sumRates(D.globalRate))}.</p>
        <div class="end-actions">
          <button class="btn btn-dark" type="button" id="g-share">Share</button>
          <a class="btn btn-ghost" href="index.html?${params}">See the full breakdown</a>
        </div>` : '<h2 id="g-end-title">Statistics</h2>'}
      ${S.practice ? '' : `
      <div class="stats-row">
        <div><b>${st.played}</b><span>Played</span></div>
        <div><b>${st.played ? Math.round((st.wins / st.played) * 100) : 0}</b><span>Win %</span></div>
        <div><b>${st.streak}</b><span>Streak</span></div>
        <div><b>${st.best}</b><span>Best</span></div>
      </div>
      <p class="dist-title">Guess distribution</p>
      <div class="dist">${st.dist.map((v, i) => `<div class="dist-row"><span>${i + 1}</span><i class="${won() && S.guesses.length === i + 1 && finished ? 'mine' : ''}" style="--w:${Math.max(8, (v / max) * 100)}%;--d:${i}">${v}</i></div>`).join('')}</div>`}
      <div class="end-foot">
        ${S.practice ? '' : `<div><span class="muted small">Next flight in</span><b id="g-count">${countdown()}</b></div>`}
        ${finished ? '<button class="btn btn-ghost btn-sm" type="button" id="g-practice">Practice round</button>' : ''}
      </div>
      <p class="muted small" id="g-copied" role="status"></p>`;
    if (finished) $('g-end-title') || $('g-end-body').querySelector('.kicker').setAttribute('id', 'g-end-title');
    openModal('g-end');
    clearInterval(timer);
    timer = setInterval(() => { const c = $('g-count'); if (c) c.textContent = countdown(); }, 1000);
    const share = $('g-share');
    if (share) share.addEventListener('click', async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(shareText()); ok = true; } catch {}
      $('g-copied').textContent = ok ? 'Copied to clipboard.' : shareText();
    });
    const prac = $('g-practice');
    if (prac) prac.addEventListener('click', () => {
      closeModals();
      setTimeout(() => start(Math.floor(Math.random() * 1e6) + 1000, true), 260);
    });
  }

  start(today, false);
  // First visit: show the rules
  if (!store.get('fp-cancelled-seen', false)) {
    store.set('fp-cancelled-seen', true);
    setTimeout(() => openModal('g-help'), 400);
  }
})();
