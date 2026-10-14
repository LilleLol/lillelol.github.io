// Regelmotoren for Jet Lag Trondheim. Alle telefoner regner ut nøyaktig samme spilltilstand
// fra samme hendelseslogg, så det trengs ingen server som kjenner reglene.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.Engine = factory({ DATA, POOL });
})(typeof self !== 'undefined' ? self : this, function (data) {
  'use strict';
  const DATA = data.DATA, POOL = data.POOL;

  const fmtNum = x => String(Math.round(x * 1000) / 1000);
  const START_BOARD = 5;   // challenges på brettet ved start
  const MAX_BOARD = 10;    // flest challenges på brettet samtidig
  const ADD_PER_DONE = 2;  // nye challenges når én forsvinner, til brettet er fullt
  const MAX_LEAD = 8;      // et lag kan ikke lede et busstopp med mer enn dette
  const BOOST = 1.5;       // premieøkning når det andre laget har feilet (bare Van og CYS)
  const TEAM = { B: 'Blå', R: 'Rød' };
  const other = t => (t === 'B' ? 'R' : 'B');

  // ---------- Seedet tilfeldighet (cyrb128 + sfc32) ----------
  function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  }
  function sfc32(a, b, c, d) {
    return function () {
      a |= 0; b |= 0; c |= 0; d |= 0;
      const t = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11); c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }
  function rng(key) { const r = sfc32(...cyrb128(key)); for (let i = 0; i < 15; i++) r(); return r; }
  function shuffle(arr, r) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ---------- Kortstokk ----------
  // Én fast rekkefølge per seed. Neste challenge som dukker opp er alltid neste kort i stokken,
  // uansett hvilken challenge som ble fjernet. Når stokken er brukt opp, stokkes den på nytt.
  let CH = {}, IDS = [], NON_LOC = [];
  // Setter hvilke challenges som er i spill. Må kalles før et spill regnes ut.
  function setChallenges(list) {
    CH = Object.fromEntries(list.map(c => [c.n, c]));
    IDS = list.map(c => c.n);
    NON_LOC = list.filter(c => !c.loc).map(c => c.n);
  }

  // ---------- Lese challenges fra challenges.json ----------
  // Radene har samme kolonner som Excel-arket: Nummer, Name, Explanation, Type, Coins, Koordinater.
  // Gir { list, errors, warnings }. list er tom hvis det finnes feil.
  const TYPES = { van: 'Van', stjel: 'Stjel', mult: 'Mult', cys: 'CYS' };
  const HEADERS = {
    n: ['nummer', 'num', 'nr'], name: ['name', 'navn'], desc: ['explanation', 'forklaring', 'beskrivelse'],
    type: ['type'], coins: ['coins', 'premie'], loc: ['koordinater', 'sted', 'adresse'],
  };
  const num = v => parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  function parseCoins(type, v) {
    // Excel kan ha gjort «1.5» om til en dato (1. mai). Da leser vi dag.måned som tallet.
    if (v instanceof Date) { const d = new Date(v.getTime() + 12 * 3600e3); v = `${d.getDate()}.${d.getMonth() + 1}`; }
    const s = String(v == null ? '' : v).trim().toLowerCase(), x = num(s);
    if (s === '' || isNaN(x)) return null;
    if (type === 'Van') return x >= 0 ? { val: String(Math.round(x)) } : null;
    if (type === 'Stjel') { const p = !s.includes('%') && x <= 1 ? x * 100 : x; return p > 0 && p <= 100 ? { val: fmtNum(p) + '%' } : null; }
    if (type === 'Mult') return x > 1 && x <= 10 ? { val: fmtNum(x) + 'x' } : null;
    return x > 0 ? { val: 'CYS', cys: x } : null;
  }
  function parseLoc(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return { loc: null };
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/.test(s)) return { err: 'kortlenker fra Google Maps kan ikke leses. Lim inn koordinatene i stedet' };
    const m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/[@=](-?\d+\.\d+),\+?(-?\d+\.\d+)/)
      || s.match(/^(-?\d+\.\d+)\s*[,; ]\s*(-?\d+\.\d+)$/) || s.match(/^(-?\d+,\d+)\s*[; ]\s*(-?\d+,\d+)$/);
    if (!m) return { err: 'forstår ikke koordinatene. Skriv for eksempel 63.42262, 10.43160' };
    const lat = num(m[1]), lon = num(m[2]);
    if (!(lat > -90 && lat < 90 && lon > -180 && lon < 180)) return { err: 'koordinatene er utenfor kartet' };
    return { loc: [lat, lon], far: lat < 63.35 || lat > 63.5 || lon < 10.2 || lon > 10.6 };
  }
  function parseChallenges(rows) {
    const errors = [], warnings = [], list = [], seen = new Set();
    if (!Array.isArray(rows)) return { list, errors: ['Filen må være en liste med rader'], warnings };
    rows.forEach((row, i) => {
      const lower = {};
      Object.keys(row || {}).forEach(k => { lower[k.trim().toLowerCase()] = row[k]; });
      const get = f => { const k = HEADERS[f].find(h => lower[h] !== undefined && lower[h] !== null); return k ? lower[k] : ''; };
      const name = String(get('name')).trim();
      if (!name && !String(get('type')).trim() && !String(get('n')).trim()) return;   // tom rad
      // Radnummeret slik det står i Excel (rad 1 er overskriftene).
      const rowNo = row.__rowNum__ !== undefined ? row.__rowNum__ + 1 : i + 2;
      const where = `Rad ${rowNo}${name ? ` («${name}»)` : ''}`;
      const n = Math.round(num(get('n')));
      const type = TYPES[String(get('type')).trim().toLowerCase()];
      const coins = type && parseCoins(type, get('coins')), place = parseLoc(get('loc'));
      const desc = String(get('desc')).replace(/\r\n/g, '\n').trim();
      if (!name) errors.push(`${where}: mangler navn`);
      if (isNaN(n)) errors.push(`${where}: mangler nummer`);
      else if (seen.has(n)) errors.push(`${where}: nummer ${n} er brukt flere ganger`);
      if (!type) errors.push(`${where}: Type må være Van, Stjel, Mult eller CYS`);
      else if (!coins) errors.push(`${where}: forstår ikke Coins for ${type}. Eksempler: Van 30, Stjel 25%, Mult 1.25x, CYS 5*X`);
      if (place.err) errors.push(`${where}: ${place.err}`);
      if (place.far) warnings.push(`${where}: stedet ligger langt utenfor Trondheim`);
      if (!desc) warnings.push(`${where}: mangler forklaring`);
      seen.add(n);
      if (name && !isNaN(n) && type && coins && !place.err) list.push({ n, name, type, desc, ...coins, ...(place.loc ? { loc: place.loc } : {}) });
    });
    if (!errors.length && list.length < MAX_BOARD) errors.push(`Det må være minst ${MAX_BOARD} challenges, men det er ${list.length}`);
    if (!errors.length && !list.some(c => !c.loc)) warnings.push('Alle challenges har fast sted, så bonuschallenge kan ikke trekkes');
    return { list: errors.length ? [] : list, errors, warnings };
  }
  // Radene slik de lagres i challenges.json, med ryddige verdier.
  function toRows(list) {
    return list.map(c => ({
      Nummer: c.n, Name: c.name, Explanation: c.desc || '', Type: c.type,
      Coins: c.type === 'CYS' ? fmtNum(c.cys) + '*X' : c.val,
      Koordinater: c.loc ? `${c.loc[0].toFixed(6)}, ${c.loc[1].toFixed(6)}` : '',
    }));
  }
  const POOLN = POOL.length / 6;
  function poolAt(i) {
    const s = POOL.substr(i * 6, 6);
    return [63.39 + parseInt(s.slice(0, 3), 36) / 1e5, 10.35 + parseInt(s.slice(3), 36) / 1e5];
  }
  // En tilfeldig challenge havner høyst «verdi × 10 meter» fra et busstopp. Verdien regnes om
  // til coins: Van = coins, Stjel = prosent, Mult = økningen i prosent, CYS = n × 3 (X ≈ 3).
  // Minst 100 m, så det alltid finnes steder å velge mellom.
  function spawnRadius(c) {
    const v = parseFloat(c.val);
    const coins = c.type === 'Van' ? v : c.type === 'Stjel' ? v : c.type === 'Mult' ? (v - 1) * 100 : c.cys * 3;
    return Math.max(100, Math.round(coins * 10));
  }
  let NEAR = null;
  const CAND = {};
  // Stedene i lista som ligger innenfor r meter fra nærmeste busstopp.
  function candidates(r) {
    if (!NEAR) {
      const kx = 111320 * Math.cos(63.43 * Math.PI / 180), ky = 110574;
      const st = DATA.stops.map(s => [s.lat * ky, s.lon * kx]);
      NEAR = new Float32Array(POOLN);
      for (let i = 0; i < POOLN; i++) {
        const [la, lo] = poolAt(i), y = la * ky, x = lo * kx;
        let best = Infinity;
        for (const [sy, sx] of st) { const d = (y - sy) ** 2 + (x - sx) ** 2; if (d < best) best = d; }
        NEAR[i] = Math.sqrt(best);
      }
    }
    if (!CAND[r]) {
      const list = [];
      for (let i = 0; i < POOLN; i++) if (NEAR[i] <= r) list.push(i);
      CAND[r] = list.length ? list : Array.from({ length: POOLN }, (_, i) => i);
    }
    return CAND[r];
  }
  function card(seed, i, cache) {
    const r = Math.floor(i / IDS.length);
    if (!cache[r]) cache[r] = shuffle(IDS, rng(`${seed}|kortstokk|${r}`));
    const c = CH[cache[r][i % IDS.length]];
    let lat, lon;
    if (c.loc) [lat, lon] = c.loc;
    else { const list = candidates(spawnRadius(c)); [lat, lon] = poolAt(list[Math.floor(rng(`${seed}|sted|${i}`)() * list.length)]); }
    return { uid: i, n: c.n, c, lat, lon, fixed: !!c.loc };
  }
  // Bonuschallenge for en stedsbundet challenge: fast ut fra seed + kort, lik for begge lag.
  function bonusFor(seed, uid) { return CH[NON_LOC[Math.floor(rng(`${seed}|bonus|${uid}`)() * NON_LOC.length)]]; }

  // ---------- Premier ----------
  const boostable = c => c.type === 'Van' || c.type === 'CYS';
  function prize(c, boosted) {
    const b = boosted && boostable(c) ? BOOST : 1;
    if (c.type === 'Van') return String(Math.round(parseFloat(c.val) * b));
    if (c.type === 'Stjel') return fmtNum(parseFloat(c.val)) + '%';
    if (c.type === 'Mult') return fmtNum(parseFloat(c.val)) + 'x';
    return fmtNum(c.cys * b) + ' × X';
  }

  // ---------- Tilstand ----------
  function initState(config) {
    const start = Math.max(0, Math.round(+config.startCoins || 0));
    const s = {
      config, cache: {}, board: [], next: 0,
      fails: {},                                   // uid -> lag som har feilet
      coins: { B: start, R: start },
      stops: DATA.stops.map(() => ({ B: 0, R: 0 })),
      active: { B: null, R: null },                // uid for lagets aktive challenge
      seen: { B: {}, R: {} },                      // challenges laget har aktivert (og dermed sett)
      shot: { B: {}, R: {} },                      // låst X for CYS
      bonus: { B: {}, R: {} },                     // trukket bonuschallenge
      wins: { B: 0, R: 0 },
      ended: null,                                 // { team, at } når spillet er avsluttet
    };
    draw(s, START_BOARD);
    return s;
  }
  function draw(s, count) {
    const added = [];
    while (count > 0 && s.board.length < IDS.length) {
      const inst = card(s.config.seed, s.next++, s.cache);
      if (s.board.some(b => b.n === inst.n)) continue;   // aldri to like på brettet
      s.board.push(inst); added.push(inst.uid); count--;
    }
    return added;
  }
  function removeInst(s, uid) {
    s.board = s.board.filter(b => b.uid !== uid);
    for (const t of ['B', 'R']) if (s.active[t] === uid) s.active[t] = null;
    return draw(s, Math.min(ADD_PER_DONE, MAX_BOARD - s.board.length));
  }
  const find = (s, uid) => s.board.find(b => b.uid === uid);
  const isBoosted = (s, uid) => (s.fails[uid] || []).length > 0;
  // Challengen laget faktisk gjør: bonuschallengen hvis den er trukket, ellers den på kortet.
  const effective = (s, team, inst) => (s.bonus[team][inst.uid] ? bonusFor(s.config.seed, inst.uid) : inst.c);
  const owner = st => (st.B > st.R ? 'B' : st.R > st.B ? 'R' : null);
  function score(s) {
    const sc = { B: 0, R: 0 };
    s.stops.forEach(st => { const o = owner(st); if (o) sc[o]++; });
    return sc;
  }
  // Vinneren har flest busstopp. Står det likt, vinner laget med flest coins igjen.
  function result(s) {
    const sc = score(s);
    const by = sc.B !== sc.R ? 'stops' : s.coins.B !== s.coins.R ? 'coins' : null;
    const lead = by === 'stops' ? sc : s.coins;
    return { winner: by ? (lead.B > lead.R ? 'B' : 'R') : null, by, score: sc, coins: { ...s.coins } };
  }
  // Hvor mange coins laget kan legge på stoppet: minst nok til å lede med 1, høyst til å lede med MAX_LEAD.
  function placeRange(s, team, stop) {
    const st = s.stops[stop], lead = st[team] - st[other(team)];
    return { min: Math.max(1, 1 - lead), max: Math.min(s.coins[team], MAX_LEAD - lead) };
  }

  const int = x => Number.isInteger(x);
  const fail = err => ({ ok: false, err });

  // Utfører én hendelse. Endrer s og gir { ok, info } eller { ok: false, err }.
  function apply(s, ev) {
    const team = ev.team;
    if (team !== 'B' && team !== 'R') return fail('Ukjent lag');
    const opp = other(team);

    if (s.ended) return fail('Spillet er avsluttet');
    if (ev.type === 'end') {
      s.ended = { team, at: ev.at || null };
      return { ok: true, info: { kind: 'end', team } };
    }
    if (ev.type === 'place') {
      const st = s.stops[ev.stop];
      if (!st || !int(ev.amount) || ev.amount < 1) return fail('Ugyldig antall coins');
      if (ev.amount > s.coins[team]) return fail('Dere har ikke nok coins');
      const r = placeRange(s, team, ev.stop);
      if (ev.amount < r.min) return fail(`Dere må legge minst ${r.min} for å lede stoppet`);
      if (ev.amount > r.max) return fail(`Dere kan ikke lede et stopp med mer enn ${MAX_LEAD} coins`);
      const prev = owner(st);
      st[team] += ev.amount; s.coins[team] -= ev.amount;
      return { ok: true, info: { kind: 'place', team, stop: ev.stop, amount: ev.amount, total: st[team], oppTotal: st[opp], took: prev === opp, claimed: prev === null } };
    }
    if (ev.type === 'adjust') {
      if (!int(ev.amount) || ev.amount === 0 || Math.abs(ev.amount) > 100000) return fail('Ugyldig justering');
      const before = s.coins[team];
      s.coins[team] = Math.max(0, before + ev.amount);
      return { ok: true, info: { kind: 'adjust', team, amount: s.coins[team] - before, note: String(ev.note || '').slice(0, 80) } };
    }

    const inst = find(s, ev.uid);
    if (!inst) return fail('Challengen ligger ikke lenger på kartet');
    const uid = inst.uid;

    if (ev.type === 'activate') {
      if (s.active[team] !== null) return fail('Dere har allerede en aktiv challenge');
      if ((s.fails[uid] || []).includes(team)) return fail('Dere har allerede prøvd denne');
      s.active[team] = uid; s.seen[team][uid] = true;
      return { ok: true, info: { kind: 'activate', team, uid, n: inst.n, private: true } };
    }
    if (s.active[team] !== uid) return fail('Challengen er ikke aktivert av laget deres');
    const c = effective(s, team, inst);

    if (ev.type === 'bonus') {
      if (!inst.fixed || !NON_LOC.length) return fail('Bare stedsbundne challenges har bonuschallenge');
      if (s.bonus[team][uid]) return fail('Bonuschallengen er allerede trukket');
      s.bonus[team][uid] = true; delete s.shot[team][uid];
      return { ok: true, info: { kind: 'bonus', team, uid, n: inst.n, private: true } };
    }
    if (ev.type === 'shot') {
      if (c.type !== 'CYS') return fail('Bare CYS har X');
      if (s.shot[team][uid]) return fail('X er allerede låst');
      if (!int(ev.x) || ev.x < 1 || ev.x > 99) return fail('X må være et helt tall fra 1 til 99');
      s.shot[team][uid] = ev.x;
      return { ok: true, info: { kind: 'shot', team, uid, n: inst.n, x: ev.x, private: true } };
    }
    if (ev.type === 'done') {
      const boosted = isBoosted(s, uid);
      const info = { kind: 'done', team, uid, n: inst.n, doneN: c.n, type: c.type, gain: 0 };
      if (c.type === 'Van') info.gain = Math.round(parseFloat(c.val) * (boosted ? BOOST : 1));
      else if (c.type === 'CYS') {
        const x = s.shot[team][uid];
        if (!x) return fail('Lås X før dere markerer klart');
        info.x = x; info.gain = Math.round(x * c.cys * (boosted ? BOOST : 1));
      } else if (c.type === 'Stjel') {
        info.gain = info.stolen = Math.round(s.coins[opp] * parseFloat(c.val) / 100);
        s.coins[opp] -= info.stolen;
      } else if (c.type === 'Mult') info.gain = Math.round(s.coins[team] * (parseFloat(c.val) - 1));
      s.coins[team] += info.gain; s.wins[team]++;
      info.added = removeInst(s, uid);
      return { ok: true, info };
    }
    if (ev.type === 'fail') {
      (s.fails[uid] || (s.fails[uid] = [])).push(team);
      s.active[team] = null;
      const info = { kind: 'fail', team, uid, n: inst.n, type: inst.c.type, both: s.fails[uid].length >= 2, added: [] };
      // Hvert lag får ett forsøk. Har begge feilet, kan ingen ta den, og den byttes ut.
      if (info.both) info.added = removeInst(s, uid);
      return { ok: true, info };
    }
    return fail('Ukjent hendelse');
  }

  // Spiller av hele loggen. Angrede hendelser hoppes over.
  function reduce(config, events) {
    const voided = new Set(events.filter(e => e.type === 'undo').map(e => e.target));
    const s = initState(config);
    s.log = [];
    for (const ev of events) {
      if (ev.type === 'undo') { s.log.push({ ev, info: { kind: 'undo', team: ev.team, target: ev.target } }); continue; }
      if (voided.has(ev.id)) { s.log.push({ ev, voided: true, info: null }); continue; }
      const r = apply(s, ev);
      if (r.ok) s.log.push({ ev, info: r.info });
    }
    return s;
  }
  const UNDOABLE = ['done', 'fail', 'place', 'adjust', 'end'];
  // Et lag kan bare angre sin egen siste hendelse.
  function undoable(events, team) {
    const voided = new Set(events.filter(e => e.type === 'undo').map(e => e.target));
    // Er spillet avsluttet, kan bare avslutningen angres, og bare av laget som avsluttet.
    const end = events.find(e => e.type === 'end' && !voided.has(e.id));
    if (end) return end.team === team ? end.id : null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.team === team && UNDOABLE.includes(e.type) && !voided.has(e.id)) return e.id;
    }
    return null;
  }

  // Tekst for logg og varsler. viewer er laget som leser. Hva en challenge er, røpes ikke
  // for et lag som ikke har aktivert den, så lenge den ligger på kartet.
  // viewer = null gir en nøytral tekst med lagnavn, og reveal = true viser navnet også på
  // challenges som er feilet. Begge brukes i reprisen når spillet er over.
  function describe(info, viewer, reveal) {
    if (!info) return '';
    const mine = info.team === viewer, neutral = viewer == null, who = mine ? 'Dere' : TEAM[info.team];
    const them = mine || neutral ? TEAM[other(info.team)] : 'dere';
    const news = n => (n ? ` ${n} ny${n > 1 ? 'e' : ''} på kartet.` : '');
    const stopName = i => DATA.stops[i].name;
    switch (info.kind) {
      case 'done': {
        const name = `«${CH[info.doneN].name}»`;
        let t = `${who} klarte ${name}: `;
        if (info.type === 'Stjel') t += `stjal ${info.stolen} coins fra ${them}${mine || neutral ? '.' : '!'}`;
        else t += `+${info.gain} coins.`;
        return t + news(info.added.length);
      }
      case 'fail': {
        let t = `${who} feilet ${mine || reveal ? `«${CH[info.n].name}»` : 'en challenge'}.`;
        if (info.both) t += ' Begge har feilet, så den er byttet ut.' + news(info.added.length);
        else if (info.type === 'Van' || info.type === 'CYS') t += ` Premien er økt med 50 % for ${them}.`;
        return t;
      }
      case 'place': {
        const tot = `(${info.total} mot ${info.oppTotal})`;
        if (info.took) return `${who} tok ${stopName(info.stop)} fra ${them} ${tot}.`;
        if (info.claimed) return `${who} tok ${stopName(info.stop)} med ${info.amount} coins ${tot}.`;
        return `${who} la ${info.amount} coins til på ${stopName(info.stop)} ${tot}.`;
      }
      case 'adjust': return `${who} justerte coins med ${info.amount > 0 ? '+' : ''}${info.amount}${info.note ? ` (${info.note})` : ''}.`;
      case 'undo': return `${who} angret siste handling.`;
      case 'end': return `${who} avsluttet spillet.`;
      case 'activate': return `${who} aktiverte «${CH[info.n].name}».`;
      case 'shot': return `${who} låste X = ${info.x}.`;
      case 'bonus': return `${who} trakk bonuschallenge.`;
    }
    return '';
  }

  return {
    START_BOARD, MAX_BOARD, ADD_PER_DONE, MAX_LEAD, TEAM, other, DATA, spawnRadius,
    // Endres når kartet eller måten stedene trekkes på endres. Et rom husker versjonen det ble laget med.
    MAP_VERSION: (DATA.version || 'v1') + '-r2',
    setChallenges, parseChallenges, toRows, challenges: () => IDS.map(n => CH[n]),
    rng, prize, boostable, bonusFor, initState, apply, reduce, undoable, describe,
    find, isBoosted, effective, owner, score, result, placeRange,
  };
});
