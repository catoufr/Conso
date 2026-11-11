/* Logique pure : import des CSV, répartition HP/HC, coûts. Aucune dépendance au DOM. */
(function (root) {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');

  /* ---------- dates (calendrier naïf, sans fuseau) ---------- */
  function addDays(d, n) {
    const [y, m, dd] = d.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, dd + n));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  }
  function dow(d) {
    const [y, m, dd] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  }
  function frToIso(s) {
    const m = String(s).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
  }
  function hm(s) {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  }
  function fromMin(x) {
    return pad(Math.floor(x / 60)) + ':' + pad(x % 60);
  }
  const num = (s) => parseFloat(String(s).replace(',', '.'));

  /* ---------- lecture des fichiers ---------- */
  function decode(buf) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(buf);
    }
  }

  /* Données Enedis (service Conso API) rassemblées par le script du PC :
     { format:'conso-enedis', parts:[{ type, data }] }. Pour la courbe de charge, l'horodatage est la FIN
     de la tranche de 30 min (comme dans les CSV) ; les créneaux sont stockés à leur DÉBUT.
     Le jour du changement d'heure d'automne, l'heure murale en double : la première occurrence
     (la plus tôt) reçoit le suffixe « |1 », comme dans les CSV. */
  function parseEnedis(obj) {
    const slots = {}, idx = {}, pmax = {};
    let estimated = 0, stale = 0;
    for (const part of obj.parts || []) {
      const d = part && part.data;
      if (!d) continue;
      if (part.type === 'courbe_de_charge_consommation') {
        const pts = [];
        for (const g of d.grandeur || []) for (const pt of g.points || []) {
          const m = String(pt.d).match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/);
          const v = pt.v === null || pt.v === '' || pt.v === undefined ? NaN : Number(pt.v);
          if (!m || !isFinite(v)) continue;
          let sm = Number(m[2]) * 60 + Number(m[3]) - 30, day = m[1];
          if (sm < 0) { sm += 1440; day = addDays(day, -1); }
          pts.push({ key: day + ' ' + fromMin(sm), v });
        }
        pts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        const last = {};
        pts.forEach((x, i) => { last[x.key] = i; });
        pts.forEach((x, i) => { slots[last[x.key] === i ? x.key : x.key + '|1'] = x.v; });
      } else if (part.type === 'index_consommation') {
        const cals = [];
        for (const c of d.contexte || []) for (const g of c.grandeur || []) for (const cal of g.calendrier || []) cals.push(cal);
        const cal = cals.find((c) => c.idCalendrier === 'FC000032') || cals.find((c) => (c.classeTemporelle || []).some((k) => k.idClasseTemporelle === 'HC'));
        if (!cal) continue;
        const get = (id) => ((cal.classeTemporelle || []).find((k) => k.idClasseTemporelle === id) || {}).valeur || [];
        const hc = {}, hp = {};
        for (const x of get('HC')) hc[String(x.d).slice(0, 10)] = Number(x.v) / 1000;
        for (const x of get('HP')) hp[String(x.d).slice(0, 10)] = Number(x.v) / 1000;
        for (const k of Object.keys(hc)) if (isFinite(hc[k]) && isFinite(hp[k])) idx[k] = { hp: hp[k], hc: hc[k] };
      } else if (part.type === 'puissance_conso_max_quotidienne') {
        for (const g of d.grandeur || []) for (const pt of g.points || []) {
          const v = Number(pt.v);
          if (isFinite(v) && pt.d) pmax[String(pt.d).slice(0, 10)] = v;
        }
      }
    }
    const ds = Object.keys(idx).sort();
    for (let i = 1; i < ds.length; i++) {
      const a = idx[ds[i - 1]], b = idx[ds[i]];
      if (a && b && addDays(ds[i - 1], 1) === ds[i] && a.hp === b.hp && a.hc === b.hc) { delete idx[ds[i]]; stale++; }
    }
    const nS = Object.keys(slots).length, nI = Object.keys(idx).length, nP = Object.keys(pmax).length;
    if (!nS && !nI && !nP) throw new Error('aucune donnée Enedis lisible');
    return { type: 'enedis', slots, idx, pmax, count: nS, nIdx: nI, nPmax: nP, stale, estimated };
  }

  function parseCsv(text) {
    const t0 = text.replace(/^\uFEFF/, '').trimStart();
    if (t0[0] === '{') {
      let o = null;
      try { o = JSON.parse(t0); } catch (e) { throw new Error('fichier JSON illisible'); }
      if (o && o.format === 'conso-enedis') return parseEnedis(o);
      throw new Error('format non reconnu');
    }
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const head = lines.slice(0, 8).join(' ').toLowerCase();
    if (/charg/.test(head) && /d.but/.test(head) && /kwh/.test(head)) return parseVe(lines);
    if (/puissance max/.test(head)) return parsePmax(lines);
    if (/date de consommation|p.{1,2}riode de consommation/.test(head))
      return { type: 'info', label: /p.{1,2}riode/.test(head) ? 'consommation mensuelle' : 'consommation quotidienne' };
    if (/puissance/.test(head)) return parsePower(lines);
    if (/index/.test(head)) return parseIndex(lines);
    throw new Error('format non reconnu');
  }

  /* Export d'un chargeur de VE : « Nom,Heure,Début :,Fin :,Durée :,Chargé :(kWh) ».
     L'identifiant de l'appareil (première ligne) n'est jamais lu ni conservé. */
  const pad2 = (n) => String(n).padStart(2, '0');
  function parseVe(lines) {
    const sessions = [];
    for (const raw of lines) {
      const c = raw.split(',');
      if (c.length < 6) continue;
      const h = c[1].trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      const d = c[4].trim().match(/^(\d+):(\d{2}):(\d{2})$/);
      const kwh = parseFloat(c[5].replace(',', '.'));
      if (!h || !d || !isFinite(kwh) || kwh <= 0) continue;
      const durSec = +d[1] * 3600 + +d[2] * 60 + +d[3];
      const startSec = (+h[2] * 60 + +h[3]) * 60 + +h[4], endSec = startSec + durSec;
      const endMin = Math.floor(endSec / 60) % 1440, startMin = Math.floor(startSec / 60);
      sessions.push({
        date: h[1], mins: durSec / 60, kwh,
        start: h[1] + ' ' + pad2(Math.floor(startMin / 60)) + ':' + pad2(startMin % 60),
        end: addDays(h[1], Math.floor(endSec / 86400)) + ' ' + pad2(Math.floor(endMin / 60)) + ':' + pad2(endMin % 60),
      });
    }
    if (!sessions.length) throw new Error('aucune recharge lisible');
    return { type: 've', sessions, count: sessions.length };
  }

  /* Puissance maximale quotidienne (VA) ; seules les lignes à date complète sont lues. */
  function parsePmax(lines) {
    const pmax = {};
    for (const raw of lines) {
      const m = raw.trim().match(/^(\d{2}\/\d{2}\/\d{4});(\d+(?:[.,]\d+)?)/);
      if (m) pmax[frToIso(m[1])] = num(m[2]);
    }
    return { type: 'pmax', pmax, count: Object.keys(pmax).length };
  }

  function parseIndex(lines) {
    const idx = {};
    for (const raw of lines) {
      const c = raw.split(';');
      const iso = frToIso(c[0]);
      if (!iso || c.length < 4) continue;
      const hp = num(c[2]), hc = num(c[3]);
      if (isFinite(hp) && isFinite(hc)) idx[iso] = { hp, hc };
    }
    /* Un relevé identique à celui de la veille est une copie : aucun foyer ne consomme 0 kWh. */
    let stale = 0;
    const ds = Object.keys(idx).sort();
    for (let i = 1; i < ds.length; i++) {
      const a = idx[ds[i - 1]], b = idx[ds[i]];
      if (a && b && addDays(ds[i - 1], 1) === ds[i] && a.hp === b.hp && a.hc === b.hc) { delete idx[ds[i]]; stale++; }
    }
    return { type: 'index', idx, count: Object.keys(idx).length, stale };
  }

  /* Les horodatages du distributeur marquent la FIN de chaque tranche de 30 min,
     et « 00:00 » est la dernière tranche de la journée (23:30 -> 00:00).
     Les créneaux sont stockés à leur DÉBUT. Le jour du changement d'heure d'automne,
     une heure murale apparaît deux fois : la première rencontrée (liste décroissante)
     est la plus tardive, l'autre reçoit le suffixe « |1 ». */
  function parsePower(lines) {
    const slots = {};
    let cur = null, seen = null, count = 0, estimated = 0;
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) continue;
      let m = l.match(/^(\d{2}\/\d{2}\/\d{4});*$/);
      if (m) { cur = frToIso(m[1]); seen = new Set(); continue; }
      m = l.match(/^(\d{2}):(\d{2}):\d{2};(\d+(?:[.,]\d+)?);?(.*)$/);
      if (!m || !cur) continue;
      let sm = Number(m[1]) * 60 + Number(m[2]) - 30;
      if (sm < 0) sm += 1440;
      let key = cur + ' ' + fromMin(sm);
      if (seen.has(key)) key += '|1'; else seen.add(key);
      slots[key] = num(m[3]);
      count++;
      if (/estim/i.test(m[4])) estimated++;
    }
    return { type: 'power', slots, count, estimated };
  }


  /* ---------- zip (méthodes 0 « stocké » et 8 « deflate ») ---------- */
  async function inflateRaw(data) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(data); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  async function parseZip(buf) {
    const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let e = -1;
    for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('zip illisible');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const out = [];
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip illisible');
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const lo = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + el + cl;
      if (name.endsWith('/')) continue;
      if (flags & 1) throw new Error('zip protégé par mot de passe');
      if (csize === 0xffffffff || lo === 0xffffffff) throw new Error('zip trop volumineux');
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      let data = u.subarray(start, start + csize);
      if (method === 8) data = await inflateRaw(data);
      else if (method !== 0) throw new Error('compression du zip non gérée');
      out.push({ name, bytes: data });
    }
    return out;
  }

  /* ---------- modèle ---------- */
  function defaultState() {
    return {
      v: 1, shift: 0, kva: 12, kva2: 9,
      slots: {}, idx: {}, over: {}, pmax: {},
      equip: [], eqOver: {}, eqMeas: [], pmax: {},
      schedules: [
        { from: '04-01', to: '10-31', ranges: [['00:38', '05:38'], ['14:38', '17:38']] },
        { from: '11-01', to: '03-31', ranges: [['01:38', '07:08'], ['13:38', '16:08']] },
      ],
      contracts: [
        { id: 'ref', name: 'Vert Électrique Auto', type: 'hphc', abo: 23.76, hp: 0.2404, hc: 0.1386, base: 0, weekendHC: false, ref: true },
      ],
    };
  }

  function mergeImport(state, parsed) {
    if (parsed.type === 've') return state; /* à rattacher à un équipement : voir importVe */
    if (parsed.type === 'enedis') { Object.assign(state.slots, parsed.slots); Object.assign(state.idx, parsed.idx); Object.assign(state.pmax, parsed.pmax); }
    else if (parsed.type === 'power') Object.assign(state.slots, parsed.slots);
    else if (parsed.type === 'index') Object.assign(state.idx, parsed.idx);
    else if (parsed.type === 'pmax') Object.assign(state.pmax, parsed.pmax);
    return state;
  }

  function cmpKey(a, b) {
    const ka = a.replace('|1', ''), kb = b.replace('|1', '');
    if (ka !== kb) return ka < kb ? -1 : 1;
    return (a.endsWith('|1') ? 0 : 1) - (b.endsWith('|1') ? 0 : 1);
  }

  /* { 'YYYY-MM-DD': [ {key, min, w, raw, forced} ] } triés dans l'ordre du jour */
  function buildByDate(state) {
    const by = {};
    for (const key of Object.keys(state.slots).sort(cmpKey)) {
      const date = key.slice(0, 10);
      const raw = state.slots[key];
      const forced = Object.prototype.hasOwnProperty.call(state.over, key);
      (by[date] = by[date] || []).push({
        key, min: hm(key.slice(11, 16)), w: forced ? state.over[key] : raw, raw, forced,
      });
    }
    for (const d of Object.keys(by)) markShares(state, by[d], d, state.shift);
    return by;
  }

  /* Part d'énergie en heures creuses de chaque créneau (s.hs).
     Un créneau à cheval sur une frontière HP/HC n'est pas réparti au prorata des minutes quand une charge
     pilotée par le contacteur du compteur (chauffe-eau, recharge VE) démarre ou s'arrête pile à la frontière :
     cette charge ne tourne qu'en heures creuses, donc toute son énergie est creuse.
     Estimation : niveau de base = créneau voisin entièrement en heures pleines ; l'excédent du créneau est la charge
     pilotée si elle atteint au moins 1500 W pendant sa durée en heures creuses ; le reste du créneau est réparti au prorata.
     Désactivable : state.relayFix === false. */
  function markShares(state, sl, date, shift) {
    const on = state.relayFix !== false;
    for (let i = 0; i < sl.length; i++) {
      const s = sl[i];
      const f = hcShare(date, s.min, state.schedules, shift);
      s.hs = f;
      if (!on || f <= 0 || f >= 1 || !(s.w > 0)) continue;
      const pv = sl[i - 1], nx = sl[i + 1];
      let b = null;
      if (pv && pv.min === s.min - 30 && hcShare(date, pv.min, state.schedules, shift) === 0) b = pv.w;
      else if (nx && nx.min === s.min + 30 && hcShare(date, nx.min, state.schedules, shift) === 0) b = nx.w;
      if (b === null || s.key.indexOf('|') >= 0) continue;
      const e = (s.w * 0.5) / 1000, eb = (b * 0.5) / 1000, l = e - eb;
      if (l > 0 && (l / (f * 0.5)) * 1000 >= 1500) s.hs = Math.min(e, l + f * eb) / e;
    }
  }

  function scheduleFor(date, schedules) {
    const md = Number(date.slice(5, 7)) * 100 + Number(date.slice(8, 10));
    const code = (s) => Number(s.slice(0, 2)) * 100 + Number(s.slice(3, 5));
    for (const s of schedules) {
      const a = code(s.from), b = code(s.to);
      if (a <= b ? md >= a && md <= b : md >= a || md <= b) return s;
    }
    return schedules[0];
  }

  function hcMinutes(s, e, ranges) {
    let t = 0;
    for (const [a, b] of ranges) {
      if (a <= b) t += Math.max(0, Math.min(e, b) - Math.max(s, a));
      else {
        t += Math.max(0, Math.min(e, 1440) - Math.max(s, a));
        t += Math.max(0, Math.min(e, b) - Math.max(s, 0));
      }
    }
    return t;
  }

  const wrap = (x) => ((x % 1440) + 1440) % 1440;
  function rangesOf(date, schedules, shift) {
    const sh = shift || 0;
    return scheduleFor(date, schedules).ranges.map(([a, b]) => [wrap(hm(a) + sh), wrap(hm(b) + sh)]);
  }

  /* Part HC (0..1) d'un créneau commençant à `min` ce jour-là. */
  function hcShare(date, min, schedules, shift) {
    return hcMinutes(min, min + 30, rangesOf(date, schedules, shift)) / 30;
  }

  /* Énergie d'une journée : 30 min si la journée est complète, sinon différence d'index. */
  function dayStats(state, byDate, date) {
    const sl = byDate[date];
    if (sl && sl.length >= 46) {
      let hp = 0, hc = 0, forced = 0;
      for (const s of sl) {
        const k = (s.w * 0.5) / 1000;
        const f = s.hs;
        hc += k * f; hp += k * (1 - f);
        if (s.forced) forced++;
      }
      return { date, hp, hc, kwh: hp + hc, src: '30min', n: sl.length, forced };
    }
    const a = state.idx[date], b = state.idx[addDays(date, 1)];
    if (a && b) {
      const hp = b.hp - a.hp, hc = b.hc - a.hc;
      return { date, hp, hc, kwh: hp + hc, src: 'index', n: 0, forced: 0 };
    }
    if (sl && sl.length) {
      let hp = 0, hc = 0;
      for (const s of sl) {
        const k = (s.w * 0.5) / 1000, f = s.hs;
        hc += k * f; hp += k * (1 - f);
      }
      return { date, hp, hc, kwh: hp + hc, src: 'partiel', n: sl.length, forced: 0 };
    }
    return null;
  }


  /* Compare, pour chaque jour complet, l'énergie HP calculée avec celle des index,
     et cherche le décalage (en minutes) des plages creuses qui colle le mieux. */
  function calibrate(state, byDate) {
    const days = [];
    for (const d of Object.keys(byDate)) {
      const a = state.idx[d], b = state.idx[addDays(d, 1)];
      if (a && b && byDate[d].length >= 46) days.push({ d, hpIdx: b.hp - a.hp });
    }
    if (days.length < 3) return null;
    const errAt = (sh) => {
      let e = 0;
      for (const { d, hpIdx } of days) {
        let hp = 0;
        const tmp = byDate[d].map((s) => ({ key: s.key, min: s.min, w: s.w }));
        markShares(state, tmp, d, sh);
        for (const s of tmp) hp += ((s.w * 0.5) / 1000) * (1 - s.hs);
        e += Math.abs(hp - hpIdx);
      }
      return e / days.length;
    };
    let best = 0, eb = Infinity;
    for (let sh = -60; sh <= 60; sh += 2) { const e = errAt(sh); if (e < eb - 1e-9) { eb = e; best = sh; } }
    return { best, errBest: eb, errNow: errAt(state.shift || 0), n: days.length };
  }

  function allDates(state, byDate) {
    const set = new Set(Object.keys(byDate));
    const ix = Object.keys(state.idx).sort();
    for (let i = 0; i < ix.length - 1; i++) if (addDays(ix[i], 1) === ix[i + 1]) set.add(ix[i]);
    return [...set].sort();
  }

  function periodStats(state, byDate, from, to) {
    const out = [];
    for (const d of allDates(state, byDate)) {
      if (d < from || d > to) continue;
      const s = dayStats(state, byDate, d);
      if (s && s.kwh >= 0) out.push(s);
    }
    return out;
  }

  /* ---------- coûts ---------- */
  function costFor(c, list) {
    let hp = 0, hc = 0;
    for (const d of list) {
      let h = d.hp, k = d.hc;
      const w = dow(d.date);
      if (c.weekendHC && (w === 0 || w === 6)) { k += h; h = 0; }
      hp += h; hc += k;
    }
    const energy = c.type === 'base' ? (hp + hc) * c.base : hp * c.hp + hc * c.hc;
    const abo = ((c.abo * 12) / 365) * list.length;
    return { hp, hc, energy, abo, total: energy + abo };
  }


  /* ---------- équipements ---------- */
  /* mode : 'h24' (en continu), 'hc' (heures creuses), 'hp' (heures pleines), 'range' (plage horaire + jours). */
  /* Règles précédentes d'un équipement (eq.past = [{until:'AAAA-MM-JJ HH:MM', mode, ranges, days}], dans l'ordre) :
     avant « until », c'est cette ancienne règle qui s'applique ; après la dernière, la règle actuelle de l'équipement. */
  function ruleAt(eq, date, min) {
    if ((eq.periods && eq.periods.length) || (eq.past && eq.past.length)) {
      const k = date + ' ' + fromMin(min);
      /* périodes choisies (la dernière créée l'emporte), puis anciennes règles « avant le… » */
      if (eq.periods) for (let i = eq.periods.length - 1; i >= 0; i--) { const p = eq.periods[i]; if ((!p.from || k >= p.from) && (!p.to || k < p.to)) return p; }
      if (eq.past) for (const p of eq.past) if (k < p.until) return p;
    }
    return eq;
  }
  /* Fonctionnement en vigueur maintenant (règle de la période en cours, sinon règle de base) : sert aux calculs de puissance. */
  function curMode(e) {
    const t = new Date(), z = (n) => String(n).padStart(2, '0');
    return ruleAt(e, t.getFullYear() + '-' + z(t.getMonth() + 1) + '-' + z(t.getDate()), t.getHours() * 60 + t.getMinutes()).mode || e.mode;
  }
  /* Équipement dont des créneaux viennent d'une règle (et non seulement de croix cochées à la main) : règle en vigueur ou une de ses périodes. */
  function hasRule(e) {
    return curMode(e) !== 'manual' || (e.periods || []).some((p) => p.mode !== 'manual' && p.mode !== 'off');
  }
  function eqRuleOn(eq0, date, min, share) {
    const eq = ruleAt(eq0, date, min);
    if (eq.mode === 'h24') return true;
    if (eq.mode === 'hc') return share >= 0.5;
    if (eq.mode === 'hp') return share < 0.5;
    if (eq.mode === 'range') {
      /* chaque plage a ses propres jours (à défaut, ceux de l'équipement, sinon tous) */
      return eqRanges(eq).some((r) => {
        const days = r.days && r.days.length ? r.days : eq.days && eq.days.length ? eq.days : [0, 1, 2, 3, 4, 5, 6];
        if (!days.includes(dow(date))) return false;
        const a = hm(r.from), b = hm(r.to);
        return a <= b ? min >= a && min < b : min >= a || min < b;
      });
    }
    return false; /* 'manual' : aucune règle, les créneaux se précisent dans l'onglet Jour */
  }
  /* Plages d'un équipement ; les anciennes données (from/to) sont reprises. */
  function eqRanges(eq) {
    if (eq.ranges && eq.ranges.length) return eq.ranges;
    return eq.from && eq.to ? [{ from: eq.from, to: eq.to }] : [];
  }
  /* Règle du mode, sauf case cochée ou décochée à la main pour ce créneau. */
  function eqSet(state, eq, key) {
    const o = state.eqOver && state.eqOver[key];
    return o && Object.prototype.hasOwnProperty.call(o, eq.id) ? o[eq.id] : null;
  }
  /* Croix forcée à la main : un import ne la modifie pas tant que le cadenas n'est pas ouvert. */
  function eqLocked(state, eqId, key) {
    const l = state.eqLock && state.eqLock[key];
    return !!(l && l[eqId]);
  }
  function setLock(state, eqId, key, on) {
    state.eqLock = state.eqLock || {};
    if (on) (state.eqLock[key] = state.eqLock[key] || {})[eqId] = true;
    else if (state.eqLock[key]) { delete state.eqLock[key][eqId]; if (!Object.keys(state.eqLock[key]).length) delete state.eqLock[key]; }
  }
  function eqOn(state, eq, key, share) {
    const o = state.eqOver && state.eqOver[key];
    if (o && Object.prototype.hasOwnProperty.call(o, eq.id)) return o[eq.id];
    return eqRuleOn(eq, key.slice(0, 10), hm(key.slice(11, 16)), share);
  }
  /* pin : garde le choix même quand il est identique à la règle (un « oui » l'emporte alors sur l'analyse, un « non » refuse une proposition). */
  function setEqOn(state, eq, key, share, on, pin) {
    state.eqOver = state.eqOver || {};
    const rule = eqRuleOn(eq, key.slice(0, 10), hm(key.slice(11, 16)), share);
    const o = state.eqOver[key] || (state.eqOver[key] = {});
    if (on === rule && !pin) delete o[eq.id]; else o[eq.id] = on;
    if (!Object.keys(o).length) delete state.eqOver[key];
  }

  /* Puissance moyenne en HP et en HC (pondérée par la part de chaque créneau), jours complets à la demi-heure. */
  function avgPowers(state, byDate, from, to) {
    let wp = 0, hp = 0, wc = 0, hc = 0, n = 0;
    for (const r of slotRows(state, byDate, from, to)) { wp += r.w * (1 - r.share); hp += 1 - r.share; wc += r.w * r.share; hc += r.share; n++; }
    return { hp: hp > 0 ? wp / hp : null, hc: hc > 0 ? wc / hc : null, all: n ? (wp + wc) / n : null, slots: n };
  }

  /* Créneaux des journées complètes, avec leur part HC. */
  function slotRows(state, byDate, from, to) {
    const rows = [];
    for (const d of Object.keys(byDate).sort()) {
      if ((from && d < from) || (to && d > to)) continue;
      const sl = byDate[d];
      if (sl.length < 46) continue;
      for (const s of sl) rows.push({ key: s.key, date: d, min: s.min, w: s.w, share: hcShare(d, s.min, state.schedules, state.shift), hs: s.hs });
    }
    return rows;
  }

  function hoursBetween(a, b) {
    let x = hm(b) - hm(a);
    if (x <= 0) x += 1440;
    return x / 60;
  }
  function measuredW(state, id) {
    let k = 0, h = 0;
    for (const m of state.eqMeas || []) if (m.eq === id && m.from && m.to) { k += m.kwh; h += hoursBetween(m.from, m.to); }
    return h > 0 && k > 0 ? (k * 1000) / h : null;
  }

  /* Moindres carrés sous contrainte de positivité (descente par coordonnées) :
     puissance de fond (équipements en continu inclus) + une puissance par équipement non continu. */
  function estimate(state, byDate) {
    const eqs = (state.equip || []).filter((e) => curMode(e) !== 'h24' && !e.rest);
    const rows = slotRows(state, byDate);
    const n = rows.length;
    if (n < 48) return null;
    const m = eqs.length;
    const X = rows.map((r) => eqs.map((e) => (eqOn(state, e, r.key, r.share) ? 1 : 0)));
    const cnt = new Array(m + 1).fill(0);
    cnt[0] = n;
    X.forEach((x) => x.forEach((v, j) => { cnt[j + 1] += v; }));
    const p = new Array(m + 1).fill(0);
    p[0] = Math.min(...rows.map((r) => r.w));
    const resid = rows.map((r) => r.w - p[0]);
    for (let it = 0; it < 400; it++) {
      let delta = 0;
      for (let j = 0; j <= m; j++) {
        if (!cnt[j]) continue;
        let sum = 0;
        for (let i = 0; i < n; i++) if (j === 0 || X[i][j - 1]) sum += resid[i];
        const nv = Math.max(0, (sum + cnt[j] * p[j]) / cnt[j]), dv = nv - p[j];
        if (dv !== 0) {
          for (let i = 0; i < n; i++) if (j === 0 || X[i][j - 1]) resid[i] -= dv;
          p[j] = nv;
          if (Math.abs(dv) > delta) delta = Math.abs(dv);
        }
      }
      if (delta < 0.05) break;
    }
    const sig = eqs.map((e, j) => X.map((x) => x[j]).join(''));
    /* Fond permanent (veille, frigo, box…) : moyenne des 10 % de créneaux les plus bas, donc sans autre appareil. */
    const low = rows.map((r) => r.w).sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(n * 0.1)));
    const floor = low.reduce((a, b) => a + b, 0) / low.length;
    const out = { base: p[0], floor, n, eq: {} };
    eqs.forEach((e, j) => {
      let w = p[j + 1], nAct = null;
      /* Seuls comptent les créneaux où l'appareil tourne vraiment : au-dessus du fond d'au moins la moitié de sa puissance. */
      if (hasRule(e)) {
        const thr = e.wmax > 0 ? 0.5 * e.wmax : Math.max(40, 0.5 * p[j + 1]);
        const act = [];
        for (let i = 0; i < n; i++) {
          if (!X[i][j]) continue;
          let r = rows[i].w - floor;
          for (let k = 0; k < m; k++) if (k !== j && X[i][k]) r -= p[k + 1];
          if (r >= thr) act.push(e.wmax > 0 ? Math.min(r, e.wmax) : r);
        }
        if (act.length >= 3) {
          /* médiane : un autre usage sur les mêmes heures (cafetière, cuisson…) ne gonfle pas la valeur */
          act.sort((x, y) => x - y);
          w = e.wmax > 0 ? act.reduce((x, y) => x + y, 0) / act.length : act[Math.floor(act.length / 2)];
          nAct = act.length;
        }
      }
      out.eq[e.id] = {
        w, nOn: cnt[j + 1], nOff: n - cnt[j + 1], nAct,
        twins: eqs.filter((f, k) => k !== j && sig[k] === sig[j]).map((f) => f.id),
      };
    });
    return out;
  }

  /* Puissance retenue par équipement : mesure réelle, puis valeur saisie, puis estimation. */
  function powers(state, est) {
    const res = {}, eqs = state.equip || [];
    let declH24 = 0, freeH24 = 0;
    for (const e of eqs.filter((q) => curMode(q) === 'h24')) {
      const mw = measuredW(state, e.id), w = mw != null ? mw : e.watts > 0 ? e.watts : null;
      if (w != null) declH24 += w; else freeH24++;
    }
    for (const e of eqs) {
      if (e.rest) { res[e.id] = { w: 0, src: 'variable' }; continue; }
      const mw = measuredW(state, e.id);
      if (mw != null) { res[e.id] = { w: mw, src: 'mesure' }; continue; }
      if (e.watts > 0) { res[e.id] = { w: e.watts, src: 'saisie' }; continue; }
      if (curMode(e) === 'h24') {
        res[e.id] = est && freeH24 ? { w: Math.max(0, est.floor - declH24) / freeH24, src: 'estimée', shared: freeH24 > 1 } : { w: 0, src: 'aucune' };
        continue;
      }
      const x = est && est.eq[e.id];
      if (x && x.w >= 1) res[e.id] = { w: x.w, src: 'estimée', nOn: x.nOn, nOff: x.nOff, nAct: x.nAct, twins: x.twins };
      else if (e.wmax > 0) res[e.id] = { w: e.wmax, src: 'max', nOn: x ? x.nOn : 0, nOff: x ? x.nOff : 0, twins: x ? x.twins : [] };
      else res[e.id] = x ? { w: 0, src: 'estimée', nOn: x.nOn, nOff: x.nOff, twins: x.twins } : { w: 0, src: 'aucune' };
    }
    let h24 = 0;
    for (const e of eqs) if (curMode(e) === 'h24') h24 += res[e.id].w || 0;
    Object.defineProperty(res, '_base', { value: est ? Math.max(0, est.floor - h24) : 0, enumerable: false });
    Object.defineProperty(res, '_floor', { value: est ? est.floor : 0, enumerable: false });
    return res;
  }

  /* Répartition d'un créneau : chaque équipement en route réclame sa puissance, réduite
     proportionnellement si le total dépasse ce qui a été mesuré. */
  /* Un équipement prioritaire garde sa valeur : les autres s'ajustent autour (par défaut, ceux en continu). */
  function veSlotW(state, eqId, key) {
    const k = key.slice(0, 16);
    for (const m of state.eqMeas || []) {
      if (m.src !== 've' || m.eq !== eqId || !m.from || !m.to || !m.win) continue;
      const a = absMin(m.win.start), b = absMin(m.win.end), x = absMin(k);
      const ov = Math.min(x + 30, b) - Math.max(x, a);
      if (ov > 0 && b > a) return (((m.kwh * 1000) / ((b - a) / 60)) * ov) / 30;
    }
    return null;
  }
  const isPrio = (e) => e.prio === true || (curMode(e) === 'h24' && e.prio !== false);

  function splitSlot(state, row, pw) {
    const items = [], fixed = [], gated = [], idle = [], rest = [];
    const floor = pw._floor || 0, base = pw._base || 0;
    let left = row.w;
    for (const e of state.equip || []) {
      if (!eqOn(state, e, row.key, row.share)) continue;
      let w = (pw[e.id] || {}).w || 0;
      const forced = eqSet(state, e, row.key) === true, vs = veSlotW(state, e.id, row.key);
      if (vs != null) w = vs; /* recharge courte de l'export : l'énergie exacte du chargeur, étalée sur ses créneaux */
      if (e.rest) { rest.push(e.id); continue; }
      if (isPrio(e)) {
        /* prioritaire : sa valeur est prise en premier, sauf si la mesure du créneau la contredit (appareil prévu par la règle) */
        if (w > 0 && curMode(e) !== 'h24' && !forced && left - base < 0.5 * w) { idle.push(e.id); continue; }
        if (w > 0) { const c = Math.min(w, left); items.push({ id: e.id, w: c }); left -= c; }
        continue;
      }
      if (curMode(e) === 'h24' || forced) { if (w > 0) fixed.push({ id: e.id, w }); continue; }
      if (w > 0) gated.push({ id: e.id, w });
      else if (floor > 0 && row.w - floor < 40) idle.push(e.id);
    }
    const D = fixed.reduce((a, f) => a + f.w, 0), k = D > left && D > 0 ? left / D : 1;
    for (const f of fixed) { items.push({ id: f.id, w: f.w * k }); }
    left -= D * k;
    gated.sort((a, b) => b.w - a.w);
    for (const g of gated) {
      const avail = left - base;
      if (avail >= 0.5 * g.w) { const c = Math.min(g.w, avail); items.push({ id: g.id, w: c }); left -= c; }
      else idle.push(g.id);
    }
    /* puissance variable (cuisson…) : tout ce qui reste une fois déduits le fond et les autres équipements */
    if (rest.length) {
      const avail = left - base;
      if (avail >= 40) { for (const id of rest) items.push({ id, w: avail / rest.length }); left -= avail; }
      else idle.push(...rest);
    }
    return { items, idle, unexplained: Math.max(0, left), avail: Math.max(0, left - base) };
  }

  const dayN = (d) => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5);
  const absMin = (k) => dayN(k.slice(0, 10)) * 1440 + hm(k.slice(11, 16));
  /* Plage d'un jour (la fin passe au lendemain si elle est avant le début). */
  function spanOf(date, from, to) {
    return { start: date + ' ' + from, end: (hm(to) <= hm(from) ? addDays(date, 1) : date) + ' ' + to };
  }
  /* Clés des créneaux recouverts au moins 15 min par la plage. */
  function spanKeys(span) {
    const a = absMin(span.start), b = absMin(span.end), keys = [];
    let d = span.start.slice(0, 10), m = Math.floor(hm(span.start.slice(11, 16)) / 30) * 30;
    for (let i = 0; i < 600; i++) {
      const abs = dayN(d) * 1440 + m;
      if (abs >= b) break;
      if (Math.min(abs + 30, b) - Math.max(abs, a) >= 5) keys.push(d + ' ' + pad2(Math.floor(m / 60)) + ':' + pad2(m % 60));
      m += 30; if (m >= 1440) { m = 0; d = addDays(d, 1); }
    }
    return keys;
  }

  /* Recharges du chargeur de VE → mesures. Une recharge dont la puissance moyenne est proche du maximum
     a une plage fiable (créneaux cochés) ; sinon la prise est restée branchée : on garde les kWh et la
     fenêtre, et les créneaux seront seulement proposés. */
  function importVe(state, parsed, eqId, force) {
    const e = state.equip.find((q) => q.id === eqId);
    const cap = e.wmax > 0 ? e.wmax : 3700;
    state.eqMeas = state.eqMeas || [];
    let exact = 0, loose = 0;
    for (const v of parsed.sessions) {
      const id = 've-' + eqId + '-' + v.start;
      state.eqMeas = state.eqMeas.filter((m) => m.id !== id);
      const avg = (v.kwh * 1000) / (v.mins / 60);
      const meas = { id, eq: eqId, date: v.date, from: '', to: '', kwh: v.kwh, src: 've', win: { start: v.start, end: v.end } };
      if (avg >= 0.75 * cap && v.mins < 1440) { meas.from = v.start.slice(11); meas.to = v.end.slice(11); exact++; } else loose++;
      state.eqMeas.push(meas);
    }
    applyVeRules(state, e, force);
    return { exact, loose };
  }

  /* Recharge VE autour d'un créneau : fenêtre de l'export du chargeur qui le contient. */
  function veWindow(state, eqId, key) {
    const k = key.slice(0, 16);
    for (const m of state.eqMeas || []) if (m.src === 've' && m.eq === eqId && m.win && k >= m.win.start && k < m.win.end) return m;
    return null;
  }

  /* Croix du VE d'après l'export du chargeur, sur la période qu'il couvre :
     - recharge courte et fiable : croix seulement sur ses créneaux ;
     - recharge longue (prise restée branchée) : la règle du mode (ex. heures creuses) dans la fenêtre ;
     - jour sans recharge : aucune croix, même en heures creuses. */
  function applyVeRules(state, e, force) {
    const ms = (state.eqMeas || []).filter((m) => m.src === 've' && m.eq === e.id && m.win);
    if (!ms.length) return;
    const sure = new Set(), wide = new Set();
    for (const m of ms) for (const k of spanKeys(m.win)) (m.from && m.to ? sure : wide).add(k);
    const d0 = ms.reduce((x, m) => (m.win.start < x ? m.win.start : x), ms[0].win.start).slice(0, 10);
    const d1 = ms.reduce((x, m) => (m.win.end > x ? m.win.end : x), ms[0].win.end).slice(0, 10);
    state.eqOver = state.eqOver || {};
    for (let d = d0; d <= d1; d = addDays(d, 1)) {
      for (let min = 0; min < 1440; min += 30) {
        const base = d + ' ' + pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
        /* jour de passage à l'heure d'hiver : la même heure existe deux fois (clé « |1 » pour la première) */
        for (const key of state.slots && state.slots[base + '|1'] !== undefined ? [base, base + '|1'] : [base]) {
          if (force) setLock(state, e.id, key, false);
          else if (eqLocked(state, e.id, key)) continue;
          const o = state.eqOver[key];
          if (o) { delete o[e.id]; if (!Object.keys(o).length) delete state.eqOver[key]; }
          const share = hcShare(d, min, state.schedules, state.shift);
          if (sure.has(base)) setEqOn(state, e, key, share, true, true);
          else if (wide.has(base)) continue;
          else if (eqRuleOn(e, d, min, share)) setEqOn(state, e, key, share, false, true);
        }
      }
    }
    state.veRules = 3;
  }

  /* Recoupement : énergie réellement relevée par EDF sur la plage d'une recharge. */
  function crossCheck(state, byDate) {
    const out = [];
    for (const m of state.eqMeas || []) {
      if (m.src !== 've' || !m.win) continue;
      const a = absMin(m.win.start), b = absMin(m.win.end);
      let kwh = 0, cov = 0;
      for (let d = m.win.start.slice(0, 10); d <= m.win.end.slice(0, 10); d = addDays(d, 1)) {
        for (const s of byDate[d] || []) {
          const x = dayN(d) * 1440 + s.min, ov = Math.max(0, Math.min(x + 30, b) - Math.max(x, a));
          if (ov > 0) { kwh += (s.w * ov) / 60 / 1000; cov += ov; }
        }
      }
      const span = b - a, covered = cov / span;
      let status = covered < 0.9 ? 'sans données EDF' : kwh < m.kwh * 0.95 ? 'écart' : 'cohérent';
      out.push({ id: m.id, win: m.win, kwh: m.kwh, edf: kwh, exact: !!(m.from && m.to), status, restW: covered >= 0.9 ? Math.max(0, ((kwh - m.kwh) * 1000) / (span / 60)) : null });
    }
    return out.sort((x, y) => (x.win.start < y.win.start ? 1 : -1));
  }

  /* Créneaux des mesures sans heures (ex. kWh d'une recharge dont la plage est trop longue) :
     on propose les créneaux qui tirent le plus, de préférence dans la plage habituelle. */
  function looseSlots(state, byDate, pw) {
    const out = {};
    for (const m of state.eqMeas || []) {
      if (m.from && m.to) continue;
      const e = (state.equip || []).find((q) => q.id === m.eq);
      if (!e) continue;
      const cap = e.wmax > 0 ? e.wmax : (pw[e.id] || {}).w > 0 ? pw[e.id].w : 3700;
      const need = Math.ceil((m.kwh * 1000) / (0.5 * cap));
      const cand = [];
      const w0 = m.win ? m.win.start : m.date + ' 12:00', w1 = m.win ? m.win.end : addDays(m.date, 1) + ' 12:00';
      for (let d = w0.slice(0, 10); d <= w1.slice(0, 10); d = addDays(d, 1)) {
        for (const s of byDate[d] || []) {
          const share = hcShare(d, s.min, state.schedules, state.shift);
          const k = d + ' ' + pad2(Math.floor(s.min / 60)) + ':' + pad2(s.min % 60);
          if (k < w0.slice(0, 16) || k >= w1.slice(0, 16)) continue;
          const r = s.w - (pw._base || 0);
          if (r >= 0.4 * cap) cand.push({ key: s.key, r, pref: eqRuleOn(e, d, s.min, share) ? 1 : 0 });
        }
      }
      cand.sort((a, b) => b.pref - a.pref || b.r - a.r);
      for (const c of cand.slice(0, need)) (out[c.key] = out[c.key] || {})[e.id] = true;
    }
    return out;
  }

  /* Équipement probablement en route sur ce créneau sans que ce soit établi (croix en pointillé). */
  function suggestFor(state, row, pw, loose) {
    const lo = loose && loose[row.key];
    let best = null, bd = Infinity;
    const sp = splitSlot(state, row, pw);
    for (const e of state.equip || []) {
      if (curMode(e) === 'h24' || e.rest || eqOn(state, e, row.key, row.share) || eqSet(state, e, row.key) !== null) continue;
      if (ruleAt(e, row.key.slice(0, 10), hm(row.key.slice(11, 16))).mode === 'off') continue; /* période « éteint » : aucune proposition */
      if (lo && lo[e.id]) return e.id;
      if (curMode(e) !== 'manual') continue; /* une plage est une tendance : pas de suggestion hors plage, sauf exception indiquée par l'utilisateur */
      const w = (pw[e.id] || {}).w || 0;
      if (w < 300) continue;
      if (sp.avail >= 0.6 * w && sp.avail <= 1.6 * w && Math.abs(sp.avail - w) < bd) { best = e.id; bd = Math.abs(sp.avail - w); }
    }
    return best;
  }

  function slotPrice(c, date, share) {
    if (c.type === 'base') return c.base;
    let f = share;
    if (c.weekendHC) { const w = dow(date); if (w === 0 || w === 6) f = 1; }
    return f * c.hc + (1 - f) * c.hp;
  }

  function attribute(state, byDate, from, to, pw, contract) {
    const out = { eq: {}, unexplained: { kwh: 0, eur: 0 }, total: { kwh: 0, eur: 0 }, slots: 0 };
    for (const e of state.equip || []) out.eq[e.id] = { kwh: 0, eur: 0 };
    for (const r of slotRows(state, byDate, from, to)) {
      const k = (r.w * 0.5) / 1000, pr = slotPrice(contract, r.date, r.hs !== undefined ? r.hs : r.share), sp = splitSlot(state, r, pw);
      out.slots++;
      out.total.kwh += k; out.total.eur += k * pr;
      for (const it of sp.items) { const kk = (it.w * 0.5) / 1000; out.eq[it.id].kwh += kk; out.eq[it.id].eur += kk * pr; }
      const ku = (sp.unexplained * 0.5) / 1000;
      out.unexplained.kwh += ku; out.unexplained.eur += ku * pr;
    }
    return out;
  }

  const api = {
    addDays, dow, frToIso, hm, fromMin, decode, parseCsv, parseIndex, parsePower, parsePmax, parsePmax, parseZip,
    defaultState, mergeImport, buildByDate, scheduleFor, hcMinutes, hcShare,
    dayStats, calibrate, rangesOf, allDates, periodStats, costFor, cmpKey,
    avgPowers, eqLocked, setLock, parseVe, importVe, applyVeRules, veWindow, crossCheck, spanOf, spanKeys, eqRuleOn, eqRanges, ruleAt, curMode, eqSet, looseSlots, suggestFor, eqOn, setEqOn, slotRows, hoursBetween, measuredW, estimate, powers, splitSlot, slotPrice, attribute,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
