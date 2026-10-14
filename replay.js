'use strict';
// Reprisen: når spillet er over, spilles hele runden av på kartet. Lagene beveger seg med et
// spor etter seg, challenges og coins spretter opp der de skjedde, busstopp skifter farge,
// og til slutt kåres vinneren.
const Replay = (() => {
  const { TEAM } = Engine;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const hhmm = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const IDLE_CAP = 120e3;   // lange pauser i spillet krympes til dette
  const DWELL = 45e3;       // hver hendelse får litt ekstra tid, så den rekker å vises
  let el = null, map = null, raf = 0, st = null, opts = null, confettiRaf = 0;

  // Finner verdien i ys som svarer til x i xs (begge stigende), med rett linje mellom punktene.
  function lerpTable(xs, ys, x) {
    if (!xs.length) return 0;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const span = xs[hi] - xs[lo];
    return span > 0 ? ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / span : ys[hi];
  }

  // ---------- Bygg reprisen fra hendelsesloggen og sporene ----------
  function buildModel({ cfg, events, tracks, players }) {
    const voided = new Set(events.filter(e => e.type === 'undo').map(e => e.target));
    const live = events.filter(e => e.type !== 'undo' && e.type !== 'end' && !voided.has(e.id) && typeof e.at === 'number');
    const s = Engine.initState(cfg), frames = [];
    const spot = b => ({ uid: b.uid, c: b.c, loc: [b.lat, b.lon] });
    const initial = s.board.map(spot);   // de som ligger på kartet fra start
    const stats = { B: { done: 0, failed: 0, placed: 0, stolen: 0 }, R: { done: 0, failed: 0, placed: 0, stolen: 0 } };
    for (const ev of live) {
      const inst = ev.uid !== undefined ? Engine.find(s, ev.uid) : null;
      const r = Engine.apply(s, ev);
      if (!r.ok) continue;
      const info = r.info, stop = info.kind === 'place' ? Engine.DATA.stops[info.stop] : null;
      const loc = inst ? [inst.lat, inst.lon] : stop ? [stop.lat, stop.lon] : null;
      const my = stats[ev.team];
      if (info.kind === 'done') { my.done++; my.stolen += info.stolen || 0; }
      if (info.kind === 'fail') my.failed++;
      if (info.kind === 'place') my.placed += info.amount;
      frames.push({
        at: ev.at, team: ev.team, info, loc, quiet: !!info.private,
        score: Engine.score(s), coins: { ...s.coins },
        owner: stop ? Engine.owner(s.stops[info.stop]) : null,
        text: Engine.describe(info, null, true),
        uid: inst ? inst.uid : null,
        gone: info.kind === 'done' || (info.kind === 'fail' && info.both),   // challengen forsvinner fra kartet
        spawn: (info.added || []).map(uid => Engine.find(s, uid)).filter(Boolean).map(spot),
      });
    }

    // Spor per telefon. Et lag uten GPS-spor følger i stedet stedene der laget gjorde noe.
    let movers = [];
    Object.entries(tracks || {}).forEach(([device, samples]) => {
      const pts = Object.values(samples || {}).filter(p => p && typeof p.at === 'number' && typeof p.lat === 'number').sort((a, b) => a.at - b.at);
      const who = (players || {})[device] || {};
      const team = (pts.length && pts[pts.length - 1].team) || who.team;
      if (pts.length && (team === 'B' || team === 'R')) movers.push({ team, name: who.name || TEAM[team], pts });
    });
    ['B', 'R'].forEach(t => {
      if (movers.filter(m => m.team === t).reduce((n, m) => n + m.pts.length, 0) >= 5) return;
      movers = movers.filter(m => m.team !== t);
      const pts = frames.filter(f => f.team === t && f.loc).map(f => ({ at: f.at, lat: f.loc[0], lon: f.loc[1] }));
      if (pts.length) movers.push({ team: t, name: TEAM[t], pts });
    });

    // Tidsakse der dødtid er krympet og hver hendelse får litt plass.
    const shown = frames.filter(f => !f.quiet);
    const keys = [...shown.map(f => ({ at: f.at, ev: true })), ...movers.flatMap(m => m.pts.map(p => ({ at: p.at })))].sort((a, b) => a.at - b.at);
    const real = [], warped = [];
    let w = 0;
    keys.forEach((k, i) => {
      if (i) w += Math.min(k.at - keys[i - 1].at, IDLE_CAP) + (keys[i - 1].ev ? DWELL : 0);
      real.push(k.at); warped.push(w);
    });
    const total = keys.length ? w + DWELL : 0;
    const warp = at => lerpTable(real, warped, at);
    frames.forEach(f => { f.w = warp(f.at); });
    movers.forEach(m => m.pts.forEach(p => { p.w = warp(p.at); }));
    return {
      frames, movers, total, stats, final: s, initial,
      unwarp: x => lerpTable(warped, real, x),
      duration: total ? clamp(total / 150e3, 8, 30) : 0,   // sekunder ved normal fart
      startCoins: cfg.startCoins,
    };
  }

  // ---------- Skjermen ----------
  const ICON = {
    play: '<svg class="icon" viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>',
    pause: '<svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    cross: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  };
  function open(o) {
    close();
    opts = o;
    const model = buildModel(o);
    el = document.createElement('div');
    el.className = 'rp';
    el.innerHTML = `
      <div class="rp-map" id="rpMap"></div>
      <div class="rp-score">
        <div class="B"><small>Blå</small><b id="rpStopB">0</b><span><i class="coin"></i><em id="rpCoinB"></em></span></div>
        <div class="rp-clock"><small>Reprise</small><b id="rpClock">–</b></div>
        <div class="R"><small>Rød</small><b id="rpStopR">0</b><span><i class="coin"></i><em id="rpCoinR"></em></span></div>
      </div>
      <div class="rp-caption" id="rpCaption"></div>
      <div class="rp-bar">
        <button class="rp-btn" id="rpPlay" aria-label="Pause">${ICON.pause}</button>
        <button class="rp-btn rp-speed" id="rpSpeed" aria-label="Fart">1x</button>
        <div class="rp-progress"><i id="rpProgress"></i></div>
        <button class="rp-btn rp-skip" id="rpSkip">Til slutten</button>
        <button class="rp-btn" id="rpClose" aria-label="Lukk">${ICON.close}</button>
      </div>
      <div class="rp-intro" id="rpIntro">
        <svg class="rp-plane" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-plane"/></svg>
        <h2>Reprise</h2>
        <div class="rp-stripes"></div>
        <p>Rom ${esc(o.code)} · ${new Date(model.frames.length ? model.frames[0].at : Date.now()).toLocaleDateString('no', { day: 'numeric', month: 'long' })}</p>
      </div>`;
    document.body.appendChild(el);

    map = L.map('rpMap', { zoomControl: false, attributionControl: true, minZoom: 11, maxZoom: 18, zoomSnap: 0.25 });
    L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png', {
      maxZoom: 18, attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
    }).addTo(map);
    const world = [[85, -180], [85, 180], [-85, 180], [-85, -180]];
    L.polygon([world, Engine.DATA.buffer], { className: 'outside', interactive: false, fillOpacity: 0.45, stroke: false }).addTo(map);
    map.fitBounds(L.latLngBounds(Engine.DATA.hull), { paddingTopLeft: [16, 96], paddingBottomRight: [16, 120] });

    st = { model, t: 0, speed: 1, playing: false, last: 0, frame: 0, done: false };
    resetScene();
    el.querySelector('#rpPlay').onclick = () => setPlaying(!st.playing);
    // Fart: 1x er standard, og 0.5x er for den som vil se roligere.
    el.querySelector('#rpSpeed').onclick = e => {
      st.speed = { 1: 2, 2: 4, 4: 0.5, 0.5: 1 }[st.speed];
      e.currentTarget.textContent = String(st.speed).replace('.', ',') + 'x';
    };
    el.querySelector('#rpSkip').onclick = () => { st.t = st.model.duration; };
    el.querySelector('#rpClose').onclick = close;

    // Tittelkort først, så starter avspillingen.
    const intro = el.querySelector('#rpIntro');
    const start = () => { if (!st || st.started) return; st.started = true; intro.classList.add('out'); setTimeout(() => intro.remove(), 600); setPlaying(true); };
    intro.onclick = start;
    setTimeout(start, reduced() ? 600 : 2400);
    st.last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function resetScene() {
    const m = st.model;
    if (st.layer) map.removeLayer(st.layer);
    st.layer = L.layerGroup().addTo(map);
    st.t = 0; st.frame = 0; st.done = false;
    // Bussrutene: en strekning får lagets farge når laget eier begge endene.
    st.owners = Engine.DATA.stops.map(() => null);
    st.routes = (Engine.DATA.edges || []).map(e => ({ e, line: L.polyline(e.path, { className: 'route', weight: 4, interactive: false }).addTo(st.layer) }));
    st.stops = Engine.DATA.stops.map(s => L.circleMarker([s.lat, s.lon], { radius: 5, weight: 2.5, className: 'stop-dot rp-stop', fillOpacity: 1, interactive: false }).addTo(st.layer));
    m.movers.forEach(mv => {
      mv.i = 0; mv.shown = false;
      mv.line =L.polyline([], { className: 'rp-trail ' + mv.team, weight: 4, interactive: false }).addTo(st.layer);
      mv.head = L.polyline([], { className: 'rp-trail ' + mv.team, weight: 4, interactive: false }).addTo(st.layer);
      mv.marker = L.marker([mv.pts[0].lat, mv.pts[0].lon], {
        icon: L.divIcon({ className: 'pl-wrap', html: `<div class="pl rp-pl ${mv.team}">${esc(mv.name.slice(0, 1).toUpperCase())}</div>`, iconSize: [0, 0] }),
        interactive: false, zIndexOffset: 800, opacity: 0,
      }).addTo(st.layer);
    });
    st.ch = {};
    m.initial.forEach(c => addChallenge(c, true));
    setScore({ B: 0, R: 0 }, { B: m.startCoins, R: m.startCoins });
    caption('');
    const w = el.querySelector('.rp-win'); if (w) w.remove();
    cancelAnimationFrame(confettiRaf);
  }
  function setPlaying(on) {
    st.playing = on;
    el.querySelector('#rpPlay').innerHTML = on ? ICON.pause : ICON.play;
  }
  function setScore(score, coins) {
    ['B', 'R'].forEach(t => {
      const s = el.querySelector('#rpStop' + t);
      if (s.textContent !== String(score[t])) { s.textContent = score[t]; s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); }
      el.querySelector('#rpCoin' + t).textContent = coins[t];
    });
  }
  function caption(text, team) {
    const c = el.querySelector('#rpCaption');
    c.className = 'rp-caption' + (text ? ' show ' + team : '');
    if (text) { c.textContent = text; c.classList.remove('in'); void c.offsetWidth; c.classList.add('in'); }
  }

  // ---------- Challenges på kartet ----------
  // Hver challenge som ligger ute, vises med premien i typens farge, som på spillkartet.
  function challengeIcon(c, fails, quick) {
    const value = c.type === 'CYS' ? 'CYS' : (c.type === 'Van' ? '<i class="coin"></i>' : '') + esc(Engine.prize(c, fails.length > 0));
    const dots = fails.map(t => `<i class="dot ${t}"></i>`).join('');
    return L.divIcon({ className: 'pl-wrap', html: `<div class="rp-ch type-${c.type} ${quick ? 'still' : ''}">${value}${dots}</div>`, iconSize: [0, 0] });
  }
  function addChallenge(c, quick) {
    if (st.ch[c.uid]) return;
    const marker = L.marker(c.loc, { icon: challengeIcon(c.c, [], quick), interactive: false, zIndexOffset: 100 }).addTo(st.layer);
    st.ch[c.uid] = { marker, c: c.c, fails: [] };
  }
  function removeChallenge(uid) {
    if (!st.ch[uid]) return;
    st.layer.removeLayer(st.ch[uid].marker);
    delete st.ch[uid];
  }

  // ---------- Hendelser på kartet ----------
  function pop(loc, team, html, cls = '') {
    const m = L.marker(loc, { icon: L.divIcon({ className: 'pl-wrap', html: `<div class="rp-pop ${team} ${cls}">${html}</div>`, iconSize: [0, 0] }), interactive: false, zIndexOffset: 1200 }).addTo(st.layer);
    setTimeout(() => { if (st && st.layer.hasLayer(m)) st.layer.removeLayer(m); }, 2400);
  }
  function badge(loc, team, kind) {
    L.marker(loc, { icon: L.divIcon({ className: 'pl-wrap', html: `<div class="rp-badge ${team} ${kind}">${ICON[kind === 'ok' ? 'check' : 'cross']}</div>`, iconSize: [0, 0] }), interactive: false, zIndexOffset: 300 }).addTo(st.layer);
  }
  function fire(f, quick) {
    setScore(f.score, f.coins);
    if (f.quiet) return;
    const i = f.info;
    if (i.kind === 'place') {
      const el2 = st.stops[i.stop].getElement();
      if (el2) { el2.classList.toggle('own-B', f.owner === 'B'); el2.classList.toggle('own-R', f.owner === 'R'); }
      st.owners[i.stop] = f.owner;
      st.routes.forEach(({ e, line }) => {
        if (e.a !== i.stop && e.b !== i.stop) return;
        const o = st.owners[e.a] && st.owners[e.a] === st.owners[e.b] ? st.owners[e.a] : null, el3 = line.getElement();
        if (el3) { el3.classList.toggle('own-B', o === 'B'); el3.classList.toggle('own-R', o === 'R'); }
        line.setStyle({ weight: o ? 7 : 4 });
      });
      if (!quick) { pop(f.loc, f.team, `<i class="coin"></i>+${i.amount}`); pop(f.loc, f.team, '', 'ring'); }
    } else if (i.kind === 'done' && f.loc) {
      badge(f.loc, f.team, 'ok');
      if (!quick) { pop(f.loc, f.team, `<i class="coin"></i>+${i.gain}`); pop(f.loc, f.team, '', 'ring'); }
    } else if (i.kind === 'fail' && f.loc) {
      // Ett lag har feilet: challengen blir liggende med en prikk i lagfargen. Har begge feilet, forsvinner den.
      const ch = st.ch[f.uid];
      if (f.gone) badge(f.loc, f.team, 'no');
      else if (ch) { ch.fails.push(f.team); ch.marker.setIcon(challengeIcon(ch.c, ch.fails, true)); }
      if (!quick) pop(f.loc, f.team, 'Feilet', 'miss');
    }
    if (f.gone) removeChallenge(f.uid);
    f.spawn.forEach(c => addChallenge(c, quick));
    if (!quick) caption(f.text, f.team);
  }

  // ---------- Avspilling ----------
  function render() {
    const m = st.model, w = m.duration ? st.t / m.duration * m.total : m.total;
    const jump = st.t >= m.duration;   // hoppet til slutten: vis sluttbildet uten å sprette alt
    m.movers.forEach(mv => {
      const p = mv.pts;
      if (w < p[0].w) return;
      if (!mv.shown) { mv.shown = true; mv.marker.setOpacity(1); mv.line.addLatLng([p[0].lat, p[0].lon]); }
      while (mv.i < p.length - 1 && p[mv.i + 1].w <= w) { mv.i++; mv.line.addLatLng([p[mv.i].lat, p[mv.i].lon]); }
      const a = p[mv.i], b = p[mv.i + 1];
      const k = b && b.w > a.w ? clamp((w - a.w) / (b.w - a.w), 0, 1) : 0;
      const pos = b ? [a.lat + (b.lat - a.lat) * k, a.lon + (b.lon - a.lon) * k] : [a.lat, a.lon];
      mv.head.setLatLngs([[a.lat, a.lon], pos]);
      mv.marker.setLatLng(pos);
    });
    while (st.frame < m.frames.length && m.frames[st.frame].w <= w) fire(m.frames[st.frame++], jump);
    if (m.total) el.querySelector('#rpClock').textContent = hhmm(m.unwarp(w));
    el.querySelector('#rpProgress').style.width = (m.duration ? st.t / m.duration * 100 : 100) + '%';
  }
  function tick(now) {
    if (!st) return;
    const dt = Math.min(0.1, (now - st.last) / 1000);
    st.last = now;
    if (st.playing && !st.done) st.t = Math.min(st.model.duration, st.t + dt * st.speed);
    render();
    if (st.started && st.t >= st.model.duration && !st.done) {
      st.done = true; setPlaying(false);
      setTimeout(showWinner, st.model.duration ? 900 : 0);
    }
    raf = requestAnimationFrame(tick);
  }

  // ---------- Vinneren ----------
  function showWinner() {
    if (!st || !el) return;
    const m = st.model, res = Engine.result(m.final), win = res.winner;
    caption('');
    const row = (label, f) => `<div><span class="B">${f('B')}</span><small>${label}</small><span class="R">${f('R')}</span></div>`;
    const box = document.createElement('div');
    box.className = 'rp-win';
    box.innerHTML = `
      <canvas class="rp-confetti"></canvas>
      <div class="rp-card ${win || 'tie'}">
        <div class="rp-stripes"></div>
        <div class="rp-label">${win ? 'Vinner' : 'Resultat'}</div>
        <h2>${win ? 'Lag ' + TEAM[win] : 'Uavgjort'}</h2>
        <p class="rp-final">${res.score.B} – ${res.score.R} busstopp${res.by === 'coins' ? ' · avgjort på coins' : ''}</p>
        <div class="rp-stats">
          ${row('Busstopp', t => res.score[t])}
          ${row('Coins igjen', t => res.coins[t])}
          ${row('Coins lagt på stopp', t => m.stats[t].placed)}
          ${row('Challenges klart', t => m.stats[t].done)}
          ${row('Challenges feilet', t => m.stats[t].failed)}
          ${row('Coins stjålet', t => m.stats[t].stolen)}
        </div>
        <div class="row2"><button class="btn small" id="rpAgain">Se igjen</button><button class="btn small yellow" id="rpDone">Lukk</button></div>
      </div>`;
    el.appendChild(box);
    box.querySelector('#rpDone').onclick = close;
    box.querySelector('#rpAgain').onclick = () => { resetScene(); setPlaying(true); };
    if (!reduced()) confetti(box.querySelector('canvas'), win);
  }
  function confetti(canvas, win) {
    const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
    const colors = [v('--yellow'), v('--orange'), v('--red'), v('--paper'), win ? v(win === 'B' ? '--blue' : '--red') : v('--blue')];
    const dpr = Math.min(2, devicePixelRatio || 1), W = canvas.width = innerWidth * dpr, H = canvas.height = innerHeight * dpr;
    const ctx = canvas.getContext('2d');
    const bits = Array.from({ length: 150 }, () => ({
      x: Math.random() * W, y: -Math.random() * H * 0.9, vx: (Math.random() - 0.5) * 2.2 * dpr, vy: (2 + Math.random() * 3.5) * dpr,
      w: (6 + Math.random() * 8) * dpr, h: (10 + Math.random() * 12) * dpr, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.25, c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    const step = now => {
      ctx.clearRect(0, 0, W, H);
      const fade = clamp(1 - (now - t0 - 6500) / 1500, 0, 1);
      bits.forEach(b => {
        b.x += b.vx; b.y += b.vy; b.r += b.vr;
        if (b.y > H + 30 && fade === 1) { b.y = -30; b.x = Math.random() * W; }
        ctx.save(); ctx.globalAlpha = fade; ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2 * Math.abs(Math.cos(b.r * 2)), b.w, b.h * Math.abs(Math.cos(b.r * 2)));
        ctx.restore();
      });
      if (fade > 0) confettiRaf = requestAnimationFrame(step);
    };
    confettiRaf = requestAnimationFrame(step);
  }

  function close() {
    cancelAnimationFrame(raf); cancelAnimationFrame(confettiRaf);
    if (map) { map.remove(); map = null; }
    if (el) { el.remove(); el = null; }
    st = null;
  }
  return { open, close, isOpen: () => !!el };
})();
