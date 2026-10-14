'use strict';
// Nettappen: lobby, sanntidssynk, kart og alle skjermene.
// Reglene ligger i engine.js. Alt som vises her, regnes ut fra hendelsesloggen i databasen.
const { TEAM, other } = Engine;

// ================= Hjelpere =================
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, m => {
    const trail = (m.match(/[.,)]+$/) || [''])[0];
    const url = m.slice(0, m.length - trail.length);
    return `<a href="${url}" target="_blank" rel="noopener">${url}</a>${trail}`;
  });
}
function hhmm(ts) { if (!ts) return '–'; const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'nå' : m < 60 ? `${m} min siden` : `${Math.floor(m / 60)} t ${m % 60} min siden`;
}
function dist(a, b) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtDist(m) { return m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km'; }
const icon = id => `<svg class="icon"><use href="#i-${id}"/></svg>`;
const COIN = '<i class="coin" aria-hidden="true"></i>';
const gmaps = (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}&travelmode=walking`;
const TYPE_NAME = { Van: 'Van', Stjel: 'Stjel', Mult: 'Mult', CYS: 'CYS' };
const PRIZE_TEXT = { Van: 'coins', Stjel: 'stjel fra det andre laget', Mult: 'multiplier', CYS: 'Call your shot<br>coins per x' };
const TYPE_DESC = {
  Van: 'Vanlig. Greier dere challengen, får dere et bestemt antall coins.',
  Stjel: 'Greier dere challengen, stjeler dere en bestemt prosent coins fra det andre laget.',
  Mult: 'Multiplier. Greier dere challengen, får dere en prosentvis økning på coinsa deres.',
  CYS: 'Call your shot. Bestem et antall x på forhånd. Greier dere x, får dere x·n coins.',
};

// ================= Lagret på telefonen =================
const LS_KEY = 'jetlag-trondheim-v2';
let saved = { device: null, name: '', team: null, code: null, outbox: [], share: true };
try { Object.assign(saved, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch (e) {}
if (!saved.device) saved.device = Math.random().toString(36).slice(2) + Date.now().toString(36);
function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(saved)); } catch (e) {} }
persist();

// ================= Spilltilstand =================
let room = null;        // { code, seed, startCoins, ntfy }
let events = [];        // hendelsesloggen fra serveren
let S = null;           // tilstanden regnet ut av Engine.reduce
let positions = {};     // device -> siste posisjon
const me = () => saved.team;
const findInst = uid => S && Engine.find(S, uid);
const boostedShown = inst => Engine.isBoosted(S, inst.uid) && Engine.boostable(inst.c);
const revealed = inst => !!S.seen[me()][inst.uid];
const triedByMe = inst => (S.fails[inst.uid] || []).includes(me());
// CYS-premien vises først etter aktivering.
function prizeHtml(c, boosted, shown) {
  if (c.type === 'CYS' && !shown) return 'CYS';
  const v = esc(Engine.prize(c, boosted));
  return c.type === 'Van' ? COIN + v : v;
}

// ================= Toast, dialog, lyd =================
let toastTimer;
function toast(text, actionLabel, action) {
  $('toastText').textContent = text;
  const b = $('toastAction');
  if (actionLabel) { b.textContent = actionLabel; b.classList.remove('hidden'); b.onclick = () => { hideToast(); action(); }; }
  else b.classList.add('hidden');
  $('toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, actionLabel ? 8000 : 4200);
}
function hideToast() { $('toast').classList.remove('show'); }

function choose(title, text, options) {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'dialog-bg';
    bg.innerHTML = `<div class="dialog" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
      <div class="row2">${options.map((o, i) => `<button class="btn small ${o.cls || ''}" data-i="${i}">${esc(o.label)}</button>`).join('')}</div></div>`;
    bg.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (b || e.target === bg) { bg.remove(); resolve(b ? options[+b.dataset.i].value : null); }
    });
    document.body.appendChild(bg);
    bg.querySelector('button:last-child').focus();
  });
}
const dialog = (title, text, okLabel, cancelLabel = 'Avbryt') =>
  choose(title, text, [{ label: cancelLabel, value: false }, { label: okLabel, value: true, cls: 'yellow' }]).then(Boolean);

// Lyd og vibrasjon når det andre laget gjør noe. Lyd må låses opp av et trykk først.
let audio = null;
document.addEventListener('pointerdown', () => { if (!audio) try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }, { once: true });
function buzz() {
  try { navigator.vibrate && navigator.vibrate([140, 70, 140]); } catch (e) {}
  if (!audio) return;
  try {
    [880, 1175].forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.16;
      o.frequency.value = f; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.start(t); o.stop(t + 0.16);
    });
  } catch (e) {}
}

// ================= Synk (Firebase Realtime Database) =================
// Rommet ligger i databasen som en nummerert hendelseslogg: rooms/<kode>/events/0, 1, 2 …
// En telefon legger til en hendelse ved å ta neste ledige nummer. Databasen slipper bare
// gjennom den første som tar et nummer, så alle telefoner ser hendelsene i samme rekkefølge.
const fb = { db: null, ref: null, buffer: {}, live: false, busy: false, connected: false };
const hashParams = new URLSearchParams(location.hash.slice(1));
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // uten tegn som er lette å forveksle
const randomCode = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ALPHABET[b % ALPHABET.length]).join('');
const waitFor = (test, ms) => new Promise(resolve => {
  const t0 = Date.now(), tick = () => (test() || Date.now() - t0 > ms ? resolve() : setTimeout(tick, 120));
  tick();
});
const cfg = () => ({ seed: room.seed, startCoins: room.startCoins });

function setConn(text) {
  $('conn').textContent = text || '';
  $('conn').classList.toggle('hidden', !text);
  $('srvStatus').textContent = text || 'Koblet til';
  $('srvStatus').classList.toggle('ok', !text);
}
function initSync() {
  const c = JL_CONFIG.FIREBASE;
  if (typeof firebase === 'undefined' || !c || !c.databaseURL) {
    setConn('Synk er ikke satt opp ennå. Firebase mangler i config.js.');
    return;
  }
  firebase.initializeApp(c);
  fb.db = firebase.database();
  setConn('Kobler til …');
  fb.db.ref('.info/connected').on('value', s => {
    fb.connected = !!s.val();
    setConn(fb.connected ? '' : 'Ingen kontakt. Kobler til igjen …');
    if (fb.connected) pump();
  });
}

async function createRoom(startCoins, seed) {
  for (let i = 0; i < 5; i++) {
    const code = randomCode(5);
    const config = {
      seed: seed.trim().toLowerCase().slice(0, 60) || randomCode(8).toLowerCase(), startCoins,
      secret: randomCode(12).toLowerCase(), createdAt: firebase.database.ServerValue.TIMESTAMP,
      challenges: JSON.stringify(Engine.toRows(siteChallenges)), map: Engine.MAP_VERSION,
    };
    // Lykkes bare hvis koden er ledig.
    const res = await fb.db.ref(`rooms/${code}/config`).transaction(cur => (cur === null ? config : undefined), undefined, false);
    if (res.committed) return enterRoom(code);
  }
  throw new Error('Klarte ikke å lage rom. Prøv igjen.');
}
async function enterRoom(code) {
  leaveRoom();
  const ref = fb.db.ref('rooms/' + code);
  const snap = await ref.child('config').get();
  if (!snap.exists()) throw new Error('Fant ikke rommet. Sjekk koden.');
  const c = snap.val();
  // Rommet bruker challengene det ble laget med, så alle telefoner er enige selv om
  // challenges.json endres senere. Eldre rom uten egen liste bruker sidens.
  const own = c.challenges ? Engine.parseChallenges(JSON.parse(c.challenges)).list : [];
  Engine.setChallenges(own.length ? own : siteChallenges);
  // Kartet (busstopp og steder) ligger i siden, ikke i rommet. Er det byttet siden rommet ble laget,
  // kan stoppene og stedene ha flyttet seg.
  if (c.map !== Engine.MAP_VERSION) setTimeout(() => toast('Kartet er oppdatert siden dette rommet ble laget. Lag et nytt rom, ellers kan stopp og steder være feil.'), 1500);
  room = { code, seed: c.seed, startCoins: c.startCoins, secret: c.secret, ntfy: `jl-${c.secret}-${saved.team.toLowerCase()}` };
  fb.ref = ref; fb.buffer = {}; fb.live = false; events = [];
  Object.entries((await ref.child('events').get()).val() || {}).forEach(([k, v]) => { if (v) addEvent(+k, v); });
  fb.live = true;
  ref.child('events').on('child_added', s => addEvent(+s.key, s.val()));
  ref.child('pos').on('value', s => { positions = s.val() || {}; renderPlayers(); });
  saved.code = code; persist();
  recompute(); bootGame(); pump();
}
function leaveRoom() {
  if (fb.ref) { fb.ref.child('events').off(); fb.ref.child('pos').off(); }
  fb.ref = null; room = null; S = null; events = []; positions = {};
}
// Tar imot hendelse nummer n. Hendelser brukes i nummerrekkefølge uten hull.
function addEvent(n, v) {
  if (n < events.length || fb.buffer[n]) return;
  fb.buffer[n] = v;
  const fresh = [];
  while (fb.buffer[events.length]) {
    const i = events.length, ev = { ...fb.buffer[i], id: i + 1 };
    delete fb.buffer[i]; events.push(ev); fresh.push(ev);
  }
  if (!fresh.length || !fb.live) return;
  recompute();
  fresh.forEach(ev => {
    const mine = saved.outbox.some(o => o.cid === ev.cid);
    dropOutbox(ev.cid);
    const entry = S.log.find(l => l.ev.id === ev.id);
    if (!entry) return;
    announce(entry, mine);
    if (mine) pushNotify(entry.info);
  });
}

// Handlinger legges i en kø på telefonen, så de overlever nettbrudd og omstart av siden.
function sendEvent(ev) {
  saved.outbox.push({ cid: Math.random().toString(36).slice(2) + Date.now().toString(36), ev });
  persist(); pump();
  if (!fb.connected) toast('Ingen kontakt akkurat nå. Handlingen sendes når nettet er tilbake.');
}
function dropOutbox(cid) { saved.outbox = saved.outbox.filter(o => o.cid !== cid); persist(); }
async function pump() {
  if (fb.busy || !fb.ref) return;
  fb.busy = true;
  try {
    while (saved.outbox.length && fb.ref) {
      const o = saved.outbox[0];
      if (events.some(e => e.cid === o.cid)) { dropOutbox(o.cid); continue; }
      const ev = { ...o.ev, team: saved.team, by: saved.name, cid: o.cid, at: firebase.database.ServerValue.TIMESTAMP };
      // Sjekk mot reglene før hendelsen sendes.
      let err = null;
      if (ev.type === 'undo') { ev.target = Engine.undoable(events, saved.team); if (!ev.target) err = 'Ingenting å angre'; }
      else { const r = Engine.apply(Engine.reduce(cfg(), events), ev); if (!r.ok) err = r.err; }
      if (err) { dropOutbox(o.cid); toast(err); rerender(); continue; }
      const idx = events.length;
      const res = await fb.ref.child('events/' + idx).transaction(cur => (cur === null ? ev : undefined), undefined, false);
      // Tok noen andre nummeret først, venter vi på deres hendelse og prøver igjen med neste.
      await waitFor(() => (res.committed ? events.some(e => e.cid === o.cid) : events.length > idx), 6000);
    }
  } catch (e) { console.error(e); setTimeout(pump, 3000); }
  finally { fb.busy = false; }
}

// Varsel til det andre lagets telefoner via ntfy, også når de er låst.
function pushNotify(info) {
  if (info.private) return;
  const to = other(info.team), tags = { done: 'white_check_mark', fail: 'x', place: 'busstop', adjust: 'coin', undo: 'leftwards_arrow_with_hook', end: 'checkered_flag' };
  fetch('https://ntfy.sh', {
    method: 'POST',
    body: JSON.stringify({ topic: `jl-${room.secret}-${to.toLowerCase()}`, title: 'Jet Lag Trondheim', message: Engine.describe(info, to), tags: [tags[info.kind] || 'bell'], click: JL_CONFIG.SITE_URL }),
  }).catch(() => {});
}
function sendPos(lat, lon, acc) {
  if (!fb.ref) return;
  fb.ref.child('pos/' + saved.device).set({ team: saved.team, name: saved.name, lat, lon, acc, at: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
}
// Sporet lagres underveis, så reprisen kan vise hvor lagene beveget seg.
let lastTrack = { at: 0, pos: null };
function sendTrack(pos) {
  const now = Date.now(), moved = lastTrack.pos ? dist(lastTrack.pos, pos) : Infinity;
  if (!fb.ref || !S || S.ended || !(moved > 20 || now - lastTrack.at > 120000)) return;
  lastTrack = { at: now, pos };
  fb.ref.child(`track/${saved.device}/${now.toString(36)}`)
    .set({ team: saved.team, lat: +pos[0].toFixed(5), lon: +pos[1].toFixed(5), at: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
}
async function openReplay() {
  if (!S || !S.ended || Replay.isOpen()) return;
  let tracks = {};
  try { tracks = (await fb.ref.child('track').get()).val() || {}; } catch (e) {}
  closeSheet(); hideToast();
  Replay.open({ cfg: cfg(), events, tracks, players: positions, code: room.code });
}

function recompute() {
  S = Engine.reduce(cfg(), events);
  if (map) { renderAll(); rerender(); }
}
// Vis hva som skjedde. Det andre lagets handlinger gir også lyd og vibrasjon.
function announce(entry, mine) {
  const info = entry.info;
  if (!info) return;
  if (info.private) { if (info.team !== me() || mine) return; return toast(Engine.describe(info, me())); }
  (info.added || []).forEach(uid => { newUids.add(uid); setTimeout(() => { newUids.delete(uid); renderChallenges(); }, 5000); });
  renderChallenges();
  const text = Engine.describe(info, me());
  if (info.kind === 'end') {
    // Spillet er over for alle: vis reprisen.
    toast(text); if (info.team !== me()) buzz();
    return void setTimeout(openReplay, 1400);
  }
  const first = info.added && info.added.length ? info.added[0] : null;
  if (first !== null && findInst(first)) toast(text, 'Vis', () => openDetail(first, { focus: true }));
  else if (info.kind === 'place') toast(text, 'Vis', () => openStop(info.stop, { focus: true }));
  else toast(text);
  if (info.team !== me()) buzz();
}

// ================= Kart =================
let map, challengeLayer, playerLayer, meMarker, meCircle, myPos = null, watchId = null;
let markers = {}, stopMarkers = [], routeLines = [], selected = null, newUids = new Set();

function initMap() {
  const buf = Engine.DATA.buffer;
  map = L.map('map', { zoomControl: true, attributionControl: true, maxBounds: L.latLngBounds(buf).pad(0.6), minZoom: 12, maxZoom: 19, zoomSnap: 0.5 });
  map.zoomControl.setPosition('topright');
  L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png', {
    maxZoom: 19, maxNativeZoom: 18,
    attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a> · gater fra &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // Mørklegg alt utenfor spillområdet (brettet + 1 km).
  const world = [[85, -180], [85, 180], [-85, 180], [-85, -180]];
  L.polygon([world, buf], { className: 'outside', interactive: false, fillOpacity: 0.45, stroke: false }).addTo(map);
  L.polygon(buf, { className: 'buffer-line', interactive: false, weight: 3, dashArray: '12 8', fill: false }).addTo(map);
  L.polygon(Engine.DATA.hull, { className: 'hull-line', interactive: false, weight: 2, dashArray: '2 6', fill: false }).addTo(map);

  // Bussrutene mellom stoppene. En strekning får lagets farge når laget eier begge endene.
  const routes = L.layerGroup().addTo(map);
  routeLines = (Engine.DATA.edges || []).map(e => L.polyline(e.path, { className: 'route', weight: 5, interactive: false }).addTo(routes));

  const stops = L.layerGroup().addTo(map);
  stopMarkers = Engine.DATA.stops.map((st, i) => {
    const dot = L.circleMarker([st.lat, st.lon], { radius: 7, weight: 3, className: 'stop-dot', fillOpacity: 1, interactive: false })
      .bindTooltip('', { permanent: true, direction: 'right', offset: [9, 0], className: 'stop-label' }).addTo(stops);
    // Større usynlig treffflate, så stoppet er lett å trykke på.
    L.circleMarker([st.lat, st.lon], { radius: 17, stroke: false, fillOpacity: 0, bubblingMouseEvents: false }).on('click', () => openStop(i)).addTo(stops);
    return dot;
  });
  playerLayer = L.layerGroup().addTo(map);
  challengeLayer = L.layerGroup().addTo(map);
  map.fitBounds(L.latLngBounds(Engine.DATA.hull), { padding: [16, 16] });
  const zoomCls = () => map.getContainer().classList.toggle('zoom-lo', map.getZoom() < 14.5);
  map.on('zoomend', zoomCls); zoomCls();
  map.on('click', () => { if (sheet.kind === 'detail' || sheet.kind === 'stop') closeSheet(); });
}

function renderStops() {
  const owners = S.stops.map(Engine.owner);
  owners.forEach((o, i) => {
    const el = stopMarkers[i].getElement();
    if (el) { el.classList.toggle('own-B', o === 'B'); el.classList.toggle('own-R', o === 'R'); el.classList.toggle('is-selected', selected === 's' + i); }
    stopMarkers[i].setTooltipContent(esc(Engine.DATA.stops[i].name));
  });
  (Engine.DATA.edges || []).forEach((e, k) => {
    const o = owners[e.a] && owners[e.a] === owners[e.b] ? owners[e.a] : null, el = routeLines[k].getElement();
    if (el) { el.classList.toggle('own-B', o === 'B'); el.classList.toggle('own-R', o === 'R'); }
    routeLines[k].setStyle({ weight: o ? 8 : 5 });
  });
}

function markerHtml(inst) {
  const c = inst.c, fails = [...(S.fails[inst.uid] || [])].sort();
  const active = S.active[me()] === inst.uid;
  const cls = ['cm', 'type-' + c.type, selected === 'c' + inst.uid ? 'is-selected' : '', newUids.has(inst.uid) ? 'is-new' : '',
    active ? 'is-active' : '', triedByMe(inst) ? 'is-tried' : ''].join(' ');
  const failDots = fails.length ? `<span class="cm-fails">${fails.map(t => `<i class="dot ${t}" title="${TEAM[t]} feilet"></i>`).join('')}</span>` : '';
  const up = boostedShown(inst) ? '<span class="cm-up">+50%</span>' : '';
  return `<div class="${cls}">${active ? '<span class="cm-flag">Aktiv</span>' : ''}<div class="cm-box">${prizeHtml(c, boostedShown(inst), revealed(inst))}${up}${failDots}</div><div class="cm-tail"></div></div>`;
}
function renderChallenges() {
  if (!S || !map) return;
  const keep = new Set(S.board.map(b => String(b.uid)));
  Object.keys(markers).forEach(k => { if (!keep.has(k)) { challengeLayer.removeLayer(markers[k]); delete markers[k]; } });
  S.board.forEach(inst => {
    const ic = L.divIcon({ className: 'cm-wrap', html: markerHtml(inst), iconSize: [0, 0], iconAnchor: [0, 0] });
    if (markers[inst.uid]) markers[inst.uid].setIcon(ic);
    else markers[inst.uid] = L.marker([inst.lat, inst.lon], { icon: ic, riseOnHover: true, keyboard: true, title: TYPE_NAME[inst.c.type] + ' challenge' })
      .on('click', () => openDetail(inst.uid)).addTo(challengeLayer);
    markers[inst.uid].setZIndexOffset(selected === 'c' + inst.uid ? 1000 : S.active[me()] === inst.uid ? 500 : 0);
  });
}
function renderPlayers() {
  if (!map) return;
  playerLayer.clearLayers();
  Object.entries(positions).forEach(([device, p]) => {
    if (device === saved.device || !p || Date.now() - p.at > 6 * 3600e3) return;
    const old = Date.now() - p.at > 5 * 60e3;
    L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: 'pl-wrap', html: `<div class="pl ${p.team} ${old ? 'old' : ''}">${esc((p.name || '?').slice(0, 1).toUpperCase())}</div>`, iconSize: [0, 0] }),
      zIndexOffset: -200,
    }).bindTooltip(`${esc(p.name)} · ${TEAM[p.team]} · ${ago(p.at)}`, { direction: 'top', offset: [0, -16] }).addTo(playerLayer);
  });
}
setInterval(renderPlayers, 30000);

function renderHeader() {
  $('coinLabel').textContent = S.coins[me()];
  $('teamLabel').textContent = TEAM[me()]; $('teamLabel').className = 'team-' + me();
  $('roomLabel').textContent = room.code;
  const sc = Engine.score(S);
  $('score').innerHTML = ['B', 'R'].map(t => `<div class="${t}" title="Busstopp og coins for ${TEAM[t]}"><small>${TEAM[t]}</small><b>${sc[t]}</b><span>${COIN}${S.coins[t]}</span></div>`).join('');
  const act = S.active[me()] !== null && findInst(S.active[me()]);
  $('activeBar').classList.toggle('hidden', !act || !!S.ended);
  $('endBar').classList.toggle('hidden', !S.ended);
  if (S.ended) {
    const res = Engine.result(S);
    $('endBarText').textContent = res.winner ? `${TEAM[res.winner]} vant ${res.score.B}–${res.score.R}` : `Uavgjort ${res.score.B}–${res.score.R}`;
  }
  if (act) $('activeBarName').textContent = Engine.effective(S, me(), act).name;
}
function renderAll() { renderHeader(); renderStops(); renderChallenges(); renderPlayers(); }

// ================= Ark =================
const sheet = { kind: null, again: null };
function openSheet(kind, title, html, again) {
  const same = sheet.kind === kind, top = same ? $('sheetBody').scrollTop : 0;
  sheet.kind = kind; sheet.again = again || null;
  $('sheetTitle').textContent = title;
  $('sheetBody').innerHTML = html;
  $('sheetBody').scrollTop = top;
  $('sheet').classList.add('open');
  ['List', 'Log', 'Menu'].forEach(k => $('btn' + k).classList.toggle('is-active', kind === k.toLowerCase()));
}
function closeSheet() {
  $('sheet').classList.remove('open');
  sheet.kind = null; sheet.again = null;
  ['List', 'Log', 'Menu'].forEach(k => $('btn' + k).classList.remove('is-active'));
  if (selected) { selected = null; renderChallenges(); renderStops(); }
}
// Tegn det åpne arket på nytt når tilstanden endrer seg.
function rerender() { if (sheet.again) sheet.again(); }
$('sheetClose').onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet.kind) closeSheet(); });

// Plasser punktet midt i den delen av kartet som ikke dekkes av arket.
function focusOn(lat, lon, zoom) {
  const z = zoom ?? map.getZoom(), size = map.getSize();
  const off = innerWidth >= 900 ? L.point(210, 0) : L.point(0, Math.min($('sheet').offsetHeight, size.y * 0.8) / 2);
  map.flyTo(map.unproject(map.project([lat, lon], z).add(off), z), z, { duration: 0.5 });
}
function reveal(lat, lon, focus) {
  const pt = map.latLngToContainerPoint([lat, lon]), size = map.getSize();
  const hidden = innerWidth >= 900 ? pt.x > size.x - 440 : pt.y > size.y - $('sheet').offsetHeight - 20;
  if (focus) focusOn(lat, lon, Math.max(map.getZoom(), 15)); else if (hidden) focusOn(lat, lon);
}
const FIT_PAD = { paddingTopLeft: [30, 60], paddingBottomRight: [70, 30] };
function boardBounds() {
  const b = L.latLngBounds(Engine.DATA.hull);
  S.board.forEach(a => b.extend([a.lat, a.lon]));
  return b;
}

// To trykk for å bekrefte.
function twoTap(btn, run) {
  if (!btn) return;
  btn.onclick = () => {
    if (!btn.classList.contains('confirm')) {
      $('sheetBody').querySelectorAll('.confirm').forEach(x => { x.classList.remove('confirm'); x.innerHTML = x.dataset.orig; });
      btn.dataset.orig = btn.innerHTML;
      btn.classList.add('confirm');
      btn.innerHTML = '<small>Sikker?</small>Trykk igjen';
      setTimeout(() => { if (btn.isConnected && btn.classList.contains('confirm')) { btn.classList.remove('confirm'); btn.innerHTML = btn.dataset.orig; } }, 3500);
      return;
    }
    btn.disabled = true;
    run();
  };
}
// Teller med pluss og minus. Gir en funksjon som leser verdien.
function stepper(el, min, max, start, onChange) {
  let v = Math.max(min, Math.min(max, start));
  const draw = () => { el.querySelector('output').textContent = v; el.querySelector('[data-d="-1"]').disabled = v <= min; el.querySelector('[data-d="1"]').disabled = v >= max; if (onChange) onChange(v); };
  el.innerHTML = '<button type="button" class="btn small" data-d="-1">−</button><output></output><button type="button" class="btn small" data-d="1">+</button>';
  el.querySelectorAll('button').forEach(b => b.onclick = () => { v = Math.max(min, Math.min(max, v + +b.dataset.d)); draw(); });
  draw();
  return () => v;
}

// ================= Challenge-kort =================
function cardHtml(c, headNote, { extra = '', boosted = false, hidden = false } = {}) {
  const up = boosted ? '<span class="up-chip">+50 %</span>' : '';
  return `
    <div class="card type-${c.type}">
      <div class="card-stripes"></div>
      <div class="card-head"><span class="t">${TYPE_NAME[c.type]}</span><span class="n">${headNote}</span></div>
      <div class="card-main">
        <h3 class="card-name">${hidden ? 'Skjult challenge' : esc(c.name)}</h3>
        <div class="prize"><b>${prizeHtml(c, boosted, !hidden)}</b><span>${hidden && c.type === 'CYS' ? 'Call your shot<br>premien vises etter aktivering' : PRIZE_TEXT[c.type]}</span>${up}</div>
        ${extra}
        ${hidden ? '<div class="desc empty">Aktiver challengen for å se hva den går ut på.</div>' : `<div class="desc">${linkify(c.desc || '')}</div>`}
      </div>
    </div>`;
}

function openDetail(uid, opts = {}) {
  const inst = findInst(uid);
  if (!inst) { if (sheet.kind === 'detail') closeSheet(); return; }
  selected = 'c' + uid; renderChallenges(); renderStops();
  const t = me(), c = inst.c, seen = revealed(inst), active = S.active[t] === uid;
  const fails = S.fails[uid] || [], boosted = boostedShown(inst);
  const d = myPos ? fmtDist(dist(myPos, [inst.lat, inst.lon])) + ' unna' : null;
  const where = `
        <div class="where">
          ${d ?`<span class="pill">${esc(d)}</span>` : ''}
          <a class="pill" href="${gmaps(inst.lat, inst.lon)}" target="_blank" rel="noopener">${icon('nav')}Veibeskrivelse</a>
        </div>
        ${fails.length ? `<div class="note">${fails.map(x => TEAM[x]).join(' og ')} har feilet denne.${boosted ? ' Premien er økt med 50 %.' : ''}</div>` : ''}`;

  const bonusOn = !!S.bonus[t][uid], eff = Engine.effective(S, t, inst), x = S.shot[t][uid];
  let bonus = '';
  if (active && inst.fixed) bonus = `
    <div class="bonus">
      <div class="label">Umulig å gjennomføre her?</div>
      <p>Er oppgaven umulig på grunn av forholdene på stedet, trekker dere med en gang en bonuschallenge (ikke en stedsbundet) og gjennomfører den i stedet, for ny pris.</p>
      ${bonusOn ? cardHtml(eff, 'Bonuschallenge', { boosted: boosted && Engine.boostable(eff) }) : '<button class="btn small" data-bonus>Trekk bonuschallenge</button>'}
    </div>`;

  let mine;
  if (S.ended) mine = '<div class="note">Spillet er avsluttet.</div>';
  else if (active) {
    let shot = '';
    if (eff.type === 'CYS') {
      const per = eff.cys * (Engine.isBoosted(S, uid) ? 1.5 : 1);
      shot = x
        ? `<div class="note">X = ${x} er låst. Klarer dere ${x}, får dere ${Math.round(x * per)} coins.</div>`
        : `<div class="shot"><div class="label">Call your shot: velg X før dere starter</div>
             <div class="stepper" id="shotStep"></div><p class="hint-line" id="shotHint"></p>
             <button class="btn small yellow" data-shot>Lås X</button></div>`;
    }
    mine = `
      <div class="label">Dere har aktivert denne</div>
      ${shot}
      <div class="actions">
        <button class="btn team-btn ${t}" data-win ${eff.type === 'CYS' && !x ? 'disabled' : ''}><small>Lag ${TEAM[t]}</small>Vi klarte</button>
        <button class="btn team-btn lose" data-lose><small>Lag ${TEAM[t]}</small>Vi feilet</button>
      </div>
      <p class="hint-line">Dere må klare eller feile før dere kan aktivere en ny. Hvert lag får bare ett forsøk.</p>`;
  } else if (fails.includes(t)) {
    mine = `<div class="note">Dere har allerede prøvd denne og feilet. Hvert lag får bare ett forsøk.</div>`;
  } else if (S.active[t] !== null) {
    mine = `<div class="note">Dere har allerede en aktiv challenge. Klar eller feil den før dere aktiverer en ny.</div>
      <button class="btn small" data-goto>Gå til aktiv challenge</button>`;
  } else {
    mine = `<button class="btn yellow activate" data-activate><small>Lag ${TEAM[t]}</small>Aktiver challenge</button>`;
  }

  const head = seen ? `Challenge #${c.n}` : 'Ikke aktivert';
  openSheet('detail', active ? 'Aktiv challenge' : 'Challenge',
    `${cardHtml(c, head, { extra: where, boosted, hidden: !seen })}${bonus}<div class="who">${mine}</div>`,
    () => openDetail(uid));
  reveal(inst.lat, inst.lon, opts.focus);

  const q = s => $('sheetBody').querySelector(s);
  if (q('[data-activate]')) q('[data-activate]').onclick = async () => {
    const ok = await dialog('Aktivere challengen?', 'Dere kan bare ha én aktiv challenge, og dere må klare eller feile den før dere kan ta en ny. Dere får bare ett forsøk.', 'Aktiver');
    if (ok) sendEvent({ type: 'activate', uid });
  };
  if (q('[data-goto]')) q('[data-goto]').onclick = () => openDetail(S.active[t], { focus: true });
  if (q('#shotStep')) {
    const per = eff.cys * (Engine.isBoosted(S, uid) ? 1.5 : 1);
    const get = stepper(q('#shotStep'), 1, 30, 1, v => { q('#shotHint').textContent = `Klarer dere ${v}, får dere ${Math.round(v * per)} coins.`; });
    twoTap(q('[data-shot]'), () => sendEvent({ type: 'shot', uid, x: get() }));
  }
  twoTap(q('[data-win]'), () => sendEvent({ type: 'done', uid }));
  twoTap(q('[data-lose]'), () => sendEvent({ type: 'fail', uid }));
  if (q('[data-bonus]')) q('[data-bonus]').onclick = async () => {
    const ok = await dialog('Trekke bonuschallenge?', 'Gjør bare dette hvis oppgaven er umulig å gjennomføre på stedet.', 'Trekk');
    if (ok) sendEvent({ type: 'bonus', uid });
  };
}

// ================= Busstopp =================
function openStop(i, opts = {}) {
  const st = S.stops[i], info = Engine.DATA.stops[i], t = me(), o = other(t);
  selected = 's' + i; renderStops(); renderChallenges();
  const own = Engine.owner(st), r = Engine.placeRange(S, t, i);
  const d = myPos ? dist(myPos, [info.lat, info.lon]) : null;
  let place;
  if (S.ended) place = '<div class="note">Spillet er avsluttet.</div>';
  else if (r.max < r.min) {
    place = `<div class="note">${st[t] - st[o] >= Engine.MAX_LEAD
      ? `Dere leder allerede med ${Engine.MAX_LEAD}, og det er det meste man kan lede et stopp med.`
      : `Dere trenger minst ${r.min} coins for å lede dette stoppet, men har ${S.coins[t]}.`}</div>`;
  } else {
    place = `
      <div class="label">Legg coins på stoppet</div>
      <div class="stepper big" id="placeStep"></div>
      <p class="hint-line" id="placeHint"></p>
      ${d !== null && d > 150 ? `<div class="note">Dere er ca. ${fmtDist(d)} unna. Man må være på stoppet for å legge coins.</div>` : ''}
      <button class="btn team-btn ${t}" data-place><small>Lag ${TEAM[t]}</small>Legg coins</button>`;
  }
  const html = `
    <div class="card stopcard ${own ? 'own-' + own : ''}">
      <div class="card-stripes"></div>
      <div class="card-head"><span class="t">Busstopp</span><span class="n">${own ? 'Eies av ' + TEAM[own] : st.B || st.R ? 'Likt – ingen eier' : 'Ingen eier'}</span></div>
      <div class="card-main">
        <h3 class="card-name">${esc(info.name)}</h3>
        <div class="versus">
          <div class="B ${own === 'B' ? 'lead' : ''}"><small>Blå</small><b>${st.B}</b></div>
          <div class="R ${own === 'R' ? 'lead' : ''}"><small>Rød</small><b>${st.R}</b></div>
        </div>
        <div class="where">
          ${d !== null ? `<span class="pill">${fmtDist(d)} unna</span>` : ''}
          <a class="pill" href="${gmaps(info.lat, info.lon)}" target="_blank" rel="noopener">${icon('nav')}Veibeskrivelse</a>
        </div>
      </div>
    </div>
    <div class="who">${place}<p class="hint-line">Laget med flest coins på stoppet eier det. Man kan ikke lede med mer enn ${Engine.MAX_LEAD}. Dere har ${S.coins[t]} coins.</p></div>`;
  openSheet('stop', 'Busstopp', html, () => openStop(i));
  reveal(info.lat, info.lon, opts.focus);
  const q = s => $('sheetBody').querySelector(s);
  if (q('#placeStep')) {
    const get = stepper(q('#placeStep'), r.min, r.max, r.min, v => {
      q('#placeHint').textContent = `Da har dere ${st[t] + v} mot ${st[o]} og leder med ${st[t] + v - st[o]}. Dere har ${S.coins[t] - v} coins igjen.`;
    });
    twoTap(q('[data-place]'), () => sendEvent({ type: 'place', stop: i, amount: get() }));
  }
}

// ================= Liste =================
function openList() {
  const t = me(), act = S.board.map(a => ({ ...a, d: myPos ? dist(myPos, [a.lat, a.lon]) : 0 }));
  act.sort((a, b) => (S.active[t] === b.uid) - (S.active[t] === a.uid) || (myPos ? a.d - b.d : a.uid - b.uid));
  const html = `<div class="label">${act.length} av ${Engine.MAX_BOARD} challenges på kartet${myPos ? ' · nærmest først' : ''}</div>
    <div class="list">${act.map(a => {
      const tags = [TYPE_NAME[a.c.type]];
      if (boostedShown(a)) tags.push('+50 %');
      if (triedByMe(a)) tags.push('Prøvd');
      const on = S.active[t] === a.uid;
      return `
      <button class="item type-${a.c.type} ${on ? 'is-active' : ''}" data-uid="${a.uid}">
        <span class="item-val">${prizeHtml(a.c, boostedShown(a), revealed(a))}</span>
        <span class="item-mid"><span class="item-name">${on ? '<span class="flag">Aktiv</span> ' : ''}${revealed(a) ? esc(a.c.name) : 'Skjult challenge'}</span>
          <span class="item-sub">${tags.join(' · ')}</span></span>
        <span class="item-dist">${myPos ? fmtDist(a.d) : ''}</span>
      </button>`;
    }).join('')}</div>`;
  openSheet('list', 'Challenges', html, openList);
  $('sheetBody').querySelectorAll('[data-uid]').forEach(b => b.onclick = () => openDetail(+b.dataset.uid, { focus: true }));
}

// ================= Logg =================
function openLog() {
  const t = me(), undoId = Engine.undoable(events, t);
  const rows = S.log.filter(l => l.voided || !l.info.private || l.info.team === t).reverse();
  const html = rows.length ? `<div class="log">${rows.map(l => {
    const team = l.ev.team;
    const text = l.voided ? `${team === t ? 'Dere' : TEAM[team]}: angret handling` : Engine.describe(l.info, t);
    return `
      <div class="log-row ${l.voided ? 'voided' : ''}">
        <span class="log-bar ${team}"></span>
        <span class="log-text">${esc(text)}<small>${hhmm(l.ev.at)} · ${esc(l.ev.by || TEAM[team])}</small></span>
        ${l.ev.id === undoId ? '<button class="btn small" data-undo>Angre</button>' : '<span></span>'}
      </div>`;
  }).join('')}</div>` : `<div class="empty-note">Ingenting har skjedd ennå</div>`;
  openSheet('log', 'Logg', html, openLog);
  const u = $('sheetBody').querySelector('[data-undo]');
  if (u) u.onclick = async () => {
    const ok = await dialog('Angre?', 'Lagets siste handling trekkes tilbake for begge lag: coins, busstopp og challenges settes tilbake.', 'Angre');
    if (ok) sendEvent({ type: 'undo' });
  };
}

// ================= Meny =================
const inviteUrl = () => JL_CONFIG.SITE_URL + '#rom=' + room.code;
async function invite() {
  const text = `Bli med på Jet Lag Trondheim! Romkode: ${room.code}`;
  if (navigator.share) { try { await navigator.share({ title: 'Jet Lag Trondheim', text, url: inviteUrl() }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copy(`${text}\n${inviteUrl()}`, 'Invitasjon kopiert');
}
async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done || 'Kopiert'); }
  catch (e) { toast('Kunne ikke kopiere'); }
}
let wakeLock = null;
async function setWake(on) {
  try {
    if (on) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.onrelease = () => { wakeLock = null; }; }
    else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { toast('Telefonen støtter ikke dette'); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && saved.wake && !wakeLock) setWake(true); });

function openMenu() {
  const t = me(), online = Object.values(positions).filter(p => p && Date.now() - p.at < 6 * 3600e3).sort((a, b) => b.at - a.at);
  const html = `
    <div class="panel">
      <h3>Rom ${esc(room.code)}</h3>
      <p>Du er <b style="color:var(--ink)">${esc(saved.name)}</b> på lag <b style="color:var(--ink)">${TEAM[t]}</b>. Del romkoden med de andre spillerne.</p>
      <button class="btn small yellow" id="mInvite">${icon('share')}Inviter spillere</button>
      ${online.length ? `<div class="players">${online.map(p => `<div><i class="dot ${p.team}"></i>${esc(p.name)}<span>${ago(p.at)}</span></div>`).join('')}</div>` : ''}
    </div>
    <div class="panel">
      <h3>Varsler på låst telefon</h3>
      <p>Siden kan bare varsle mens den er åpen. For varsler når telefonen ligger i lomma:</p>
      <ol class="rules">
        <li>Installer gratisappen <b>ntfy</b> fra App Store eller Google Play.</li>
        <li>Trykk «Åpne i ntfy» under, eller legg til emnet manuelt i appen.</li>
      </ol>
      <div class="code">${esc(room.ntfy)}</div>
      <div class="row2"><a class="btn small yellow" href="ntfy://ntfy.sh/${esc(room.ntfy)}">${icon('bell')}Åpne i ntfy</a><button class="btn small" id="mTopic">Kopier emne</button></div>
    </div>
    <div class="panel">
      <h3>Posisjon</h3>
      <p>Begge lag ser hverandre på kartet. Posisjonen oppdateres bare mens siden er åpen på skjermen.</p>
      <label class="switch"><input type="checkbox" id="mShare" ${saved.share ? 'checked' : ''}><span>Del posisjonen min</span></label>
      <label class="switch"><input type="checkbox" id="mWake" ${saved.wake ? 'checked' : ''}><span>Hold skjermen på</span></label>
    </div>
    <div class="panel">
      <h3>Juster coins</h3>
      <p>Bare for å rette feil. Justeringen vises i loggen for begge lag.</p>
      <div class="row2"><input class="field" id="mAdj" type="number" inputmode="numeric" placeholder="+10 eller -5" style="font-size:18px"><input class="field" id="mNote" maxlength="80" placeholder="Hvorfor?" style="font-size:18px"></div>
      <button class="btn small" id="mAdjGo">Juster lagets coins</button>
    </div>
    <div class="panel">
      <h3>Typer</h3>
      <div class="legend">${Object.keys(TYPE_DESC).map(k => `<div><span class="type-chip type-${k}">${k}</span><span>${TYPE_DESC[k]}</span></div>`).join('')}</div>
    </div>
    <div class="panel">
      <h3>Regler</h3>
      <ul class="rules">
        <li>Brettet starter med <b>${Engine.START_BOARD} challenges</b>. Hver gang en forsvinner, kommer det <b>${Engine.ADD_PER_DONE} nye</b>, til det er ${Engine.MAX_BOARD} på kartet.</li>
        <li><b>Aktiver</b> en challenge for å se hva den er. Dere kan bare ha én aktiv, og må klare eller feile den.</li>
        <li>Hvert lag får <b>ett forsøk</b> per challenge. Feiler et lag, øker premien med 50 % for <b>Van og CYS</b>. Stjel og Mult øker ikke.</li>
        <li>Feiler begge lag, byttes challengen ut.</li>
        <li><b>Busstopp:</b> legg coins for å ta et stopp. Laget med flest coins der eier det, og man kan ikke lede med mer enn ${Engine.MAX_LEAD}.</li>
        <li>Laget med <b>flest busstopp</b> vinner. Står det likt, vinner laget med flest coins igjen.</li>
        <li>Er en aktivert challenge umulig å gjennomføre på grunn av forholdene på stedet, kan dere trekke en <b>bonuschallenge</b> når knappen vises på kortet.</li>
      </ul>
    </div>
    <div class="panel">
      <h3>${S.ended ? 'Spillet er over' : 'Avslutt spillet'}</h3>
      ${S.ended
        ? `<p>Se hele runden på kartet en gang til. Laget som avsluttet, kan angre avslutningen i loggen.</p>
           <button class="btn small yellow" id="mReplay">Se reprisen</button>`
        : `<p>Avslutter spillet for begge lag og kårer vinneren. Da vises en reprise av hele runden hos alle.</p>
           <button class="btn small dark" id="mEnd">Avslutt spillet</button>`}
    </div>
    <div class="panel">
      <h3>Rom</h3>
      <p>Seed: <b style="color:var(--ink)">${esc(room.seed)}</b> · Startcoins: <b style="color:var(--ink)">${room.startCoins}</b></p>
      <button class="btn small dark" id="mLeave">Forlat rommet</button>
    </div>`;
  openSheet('menu', 'Meny', html);
  $('mInvite').onclick = invite;
  $('mTopic').onclick = () => copy(room.ntfy, 'Emnet er kopiert');
  $('mShare').onchange = e => { saved.share = e.target.checked; persist(); toast(saved.share ? 'Deler posisjon' : 'Deler ikke posisjon'); if (saved.share) startLocate(); };
  $('mWake').onchange = e => { saved.wake = e.target.checked; persist(); setWake(saved.wake); };
  $('mAdjGo').onclick = async () => {
    const n = Math.round(+$('mAdj').value);
    if (!n) return toast('Skriv inn et tall, for eksempel 10 eller -5');
    if (await dialog('Justere coins?', `${TEAM[t]} får ${n > 0 ? '+' : ''}${n} coins. Dette vises for begge lag.`, 'Juster')) { sendEvent({ type: 'adjust', amount: n, note: $('mNote').value }); closeSheet(); }
  };
  if ($('mReplay')) $('mReplay').onclick = openReplay;
  if ($('mEnd')) $('mEnd').onclick = async () => {
    const sc = Engine.score(S);
    if (await dialog('Avslutte spillet?', `Stillingen er ${sc.B}–${sc.R} i busstopp. Spillet avsluttes for begge lag, og ingen kan gjøre flere trekk.`, 'Avslutt')) { closeSheet(); sendEvent({ type: 'end' }); }
  };
  $('mLeave').onclick = async () => {
    if (!(await dialog('Forlate rommet?', 'Spillet fortsetter for de andre. Du kan bli med igjen med romkoden.', 'Forlat'))) return;
    closeSheet(); leaveRoom();
    saved.code = null; saved.outbox = []; persist();
    showSetup();
  };
}

// ================= Posisjon =================
let lastSent = { at: 0, pos: null };
function startLocate() {
  if (watchId !== null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(p => {
    myPos = [p.coords.latitude, p.coords.longitude];
    if (!meMarker) {
      meCircle = L.circle(myPos, { radius: p.coords.accuracy, className: 'me-acc', weight: 2, interactive: false }).addTo(map);
      meMarker = L.circleMarker(myPos, { radius: 9, weight: 4, className: 'me-dot team-' + me(), fillOpacity: 1, interactive: false }).addTo(map);
    } else { meMarker.setLatLng(myPos); meCircle.setLatLng(myPos).setRadius(p.coords.accuracy); }
    $('btnLocate').classList.add('is-active');
    // Send til de andre når vi har flyttet oss litt, eller minst hvert halvminutt.
    const now = Date.now(), moved = lastSent.pos ? dist(lastSent.pos, myPos) : Infinity;
    if (saved.share && now - lastSent.at > 8000 && (moved > 15 || now - lastSent.at > 30000)) {
      lastSent = { at: now, pos: myPos };
      sendPos(myPos[0], myPos[1], Math.round(p.coords.accuracy));
    }
    if (saved.share) sendTrack(myPos);
  }, err => {
    if (err.code === 1) toast('Fikk ikke lov til å bruke posisjon. Slå det på i nettleseren for å vises på kartet.');
    navigator.geolocation.clearWatch(watchId); watchId = null;
    $('btnLocate').classList.remove('is-active');
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}

// ================= Lobby =================
let pickedTeam = saved.team, tab = 'join';
function showSetup() {
  $('setup').classList.remove('hidden');
  $('nameInput').value = saved.name || '';
  if (hashParams.get('rom')) $('codeInput').value = hashParams.get('rom').toUpperCase().slice(0, 5);
  document.querySelectorAll('#setup [data-pick]').forEach(x => x.classList.toggle('is-on', x.dataset.pick === pickedTeam));
}
document.querySelectorAll('#setup [data-pick]').forEach(b => b.onclick = () => {
  pickedTeam = b.dataset.pick;
  document.querySelectorAll('#setup [data-pick]').forEach(x => x.classList.toggle('is-on', x === b));
});
document.querySelectorAll('#setup [data-tab]').forEach(b => b.onclick = () => {
  tab = b.dataset.tab;
  document.querySelectorAll('#setup [data-tab]').forEach(x => x.classList.toggle('is-on', x === b));
  $('tabJoin').classList.toggle('hidden', tab !== 'join');
  $('tabCreate').classList.toggle('hidden', tab !== 'create');
});
$('codeInput').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
$('setupForm').onsubmit = async e => {
  e.preventDefault();
  const name = $('nameInput').value.trim(), btn = e.submitter;
  if (!name) return toast('Skriv inn navnet ditt');
  if (!pickedTeam) return toast('Velg hvilket lag du er på');
  if (!fb.db) return toast('Synk er ikke satt opp ennå');
  if (tab === 'create' && !siteChallenges.length) return toast('Kan ikke lage rom: challenges.json har feil');
  saved.name = name; saved.team = pickedTeam; persist();
  if (btn) btn.disabled = true;
  try {
    if (tab === 'join') {
      const code = $('codeInput').value.trim();
      if (code.length !== 5) throw new Error('Romkoden har fem tegn');
      await enterRoom(code);
    } else await createRoom(Math.max(0, Math.min(99999, Math.round(+$('coinsInput').value || 0))), $('seedInput').value);
  } catch (err) { toast(err.message || 'Noe gikk galt'); }
  if (btn) btn.disabled = false;
};

let booted = false;
function bootGame() {
  $('setup').classList.add('hidden');
  if (!map) initMap();
  renderAll();
  if (!booted) {
    booted = true;
    setTimeout(() => { map.invalidateSize(); map.fitBounds(boardBounds(), FIT_PAD); renderStops(); }, 60);
    if (saved.share) startLocate();
    if (saved.wake) setWake(true);
    if (!events.length) toast(`Rom ${room.code} er klart. Del koden med de andre.`, 'Inviter', invite);
  }
}

$('btnList').onclick = () => sheet.kind === 'list' ? closeSheet() : openList();
$('btnLog').onclick = () => sheet.kind === 'log' ? closeSheet() : openLog();
$('btnMenu').onclick = () => sheet.kind === 'menu' ? closeSheet() : openMenu();
$('btnShare').onclick = invite;
$('btnFit').onclick = () => map.flyToBounds(boardBounds(), { ...FIT_PAD, duration: 0.6 });
$('btnLocate').onclick = () => { if (myPos) map.flyTo(myPos, Math.max(map.getZoom(), 15), { duration: 0.6 }); else { startLocate(); toast('Henter posisjonen …'); } };
$('activeBar').onclick = () => openDetail(S.active[me()], { focus: true });
$('endBar').onclick = openReplay;

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
// Challengene leses fra challenges.json, som lages fra Excel-arket med eksport.html.
let siteChallenges = [];
async function loadChallenges() {
  try {
    const res = await fetch('challenges.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('fant ikke challenges.json');
    const parsed = Engine.parseChallenges(await res.json());
    if (parsed.errors.length) throw new Error(parsed.errors[0]);
    siteChallenges = parsed.list;
    Engine.setChallenges(siteChallenges);
  } catch (err) {
    console.error(err);
    toast('Feil i challenges.json: ' + err.message);
  }
}

(async () => {
  await loadChallenges();
  initSync();
  if (saved.code && saved.team && fb.db) {
    // Tilbake i samme rom som sist.
    enterRoom(saved.code).catch(err => { saved.code = null; persist(); toast(err.message || 'Fant ikke rommet'); showSetup(); });
  } else showSetup();
})();
