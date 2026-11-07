(function () {
  'use strict';
  const C = window.Core;
  const KEY = 'conso-elec-v1';
  const TABS = [
    { id: 'tableau', label: 'Tableau', icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
    { id: 'jour', label: 'Jour', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>' },
    { id: 'equipements', label: 'Équipements', icon: '<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>' },
    { id: 'contrats', label: 'Contrats', icon: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1"/>' },
    { id: 'donnees', label: 'Données', icon: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>' },
  ];

  let S, storageOk = true;
  const ui = { tab: 'tableau', preset: 'all', from: '', to: '', day: '', sel: null, msg: '', backup: '', confirm: false, eqMsg: '', confirmEq: '', siteDel: 0, siteTyped: '', cat: 'auto', veEq: '', force: false, open: {}, gran: 'day', bsel: null };

  /* Sections repliables : l'état ouvert/fermé est gardé d'un affichage à l'autre. */
  const op = (k, def) => ((k in ui.open ? ui.open[k] : !!def) ? ' open' : '');

  /* ---------- utilitaires ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (d) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const f1 = (x) => nf(1).format(x), f2 = (x) => nf(2).format(x);
  const eur = (x) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(x);
  const signed = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + eur(Math.abs(x));
  const dmy = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const dmyFull = (d) => dmy(d) + '/' + d.slice(0, 4);
  const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const parseNum = (v) => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : null; };

  /* Plusieurs sites (maisons, compteurs) : chacun garde sa propre base. Le premier garde l'ancienne clé. */
  const APP_VERSION = '31', APP_DATE = '6 novembre 2026';
  const SKEY = 'conso-sites-v1';
  let sites = { cur: 's1', list: [{ id: 's1', name: 'Maison' }] };
  const siteKey = (id) => (id === 's1' ? KEY : 'conso-site-' + id);
  function loadSites() {
    try { const r = localStorage.getItem(SKEY); if (r) { const v = JSON.parse(r); if (v && Array.isArray(v.list) && v.list.length) sites = v; } } catch (e) { /* mémoire indisponible */ }
    if (!sites.list.some((x) => x.id === sites.cur)) sites.cur = sites.list[0].id;
  }
  function saveSites() { try { localStorage.setItem(SKEY, JSON.stringify(sites)); } catch (e) { storageOk = false; } }
  const curSite = () => sites.list.find((x) => x.id === sites.cur);
  function switchSite(id) {
    save(); sites.cur = id; saveSites(); S = load();
    Object.assign(ui, { preset: 'all', from: '', to: '', day: '', sel: null, msg: '', backup: '', confirm: false, eqMsg: '', confirmEq: '', siteDel: 0, siteTyped: '' });
  }

  function load() {
    let st = null;
    try { const r = localStorage.getItem(siteKey(sites.cur)); if (r) st = JSON.parse(r); } catch (e) { /* mémoire indisponible */ }
    const base = C.defaultState();
    if (!st) {
      if (window.SEED && sites.cur === 's1') { Object.assign(base.slots, window.SEED.slots); Object.assign(base.idx, window.SEED.idx); Object.assign(base.pmax, window.SEED.pmax || {}); }
      return base;
    }
    return Object.assign(base, st);
  }
  function save() {
    try {
      const k = siteKey(sites.cur), j = JSON.stringify(S);
      if (localStorage.getItem(k) !== j) { localStorage.setItem(k, j); localStorage.setItem('conso-lastedit', String(Date.now())); }
      storageOk = true;
    } catch (e) { storageOk = false; }
  }

  function model() {
    const by = C.buildByDate(S);
    const dates = C.allDates(S, by);
    const ref = S.contracts.find((c) => c.ref) || S.contracts[0];
    let p = null;
    if (dates.length) {
      const last = dates[dates.length - 1], first = dates[0];
      if (ui.preset === '7') p = { from: C.addDays(last, -6), to: last };
      else if (ui.preset === 'custom' && ui.from && ui.to && ui.from <= ui.to) p = { from: ui.from, to: ui.to };
      else if (ui.preset === 'month') { const ms = todayIso().slice(0, 7) + '-01'; p = { from: ms, to: last >= ms ? last : todayIso() }; }
      else if (ui.preset === 'year') { const ys = todayIso().slice(0, 4) + '-01-01'; p = { from: ys, to: last >= ys ? last : todayIso() }; }
      else p = { from: first, to: last };
      if (p.from < first) p.from = first;
    }
    const list = p && p.from <= p.to ? C.periodStats(S, by, p.from, p.to) : [];
    const est = S.equip.length ? C.estimate(S, by) : null;
    const pw = C.powers(S, est);
    const loose = S.equip.length ? C.looseSlots(S, by, pw) : {};
    let at = null, unp = null;
    if (S.equip.length && p && list.length) {
      at = C.attribute(S, by, p.from, p.to, pw, ref);
      if (at.slots) {
        const acc = new Map();
        for (const r of C.slotRows(S, by, p.from, p.to)) { const a = acc.get(r.min) || { s: 0, n: 0 }; a.s += C.splitSlot(S, r, pw).unexplained; a.n++; acc.set(r.min, a); }
        unp = [];
        for (let mn = 0; mn < 1440; mn += 30) { const a = acc.get(mn); unp.push({ min: mn, w: a ? a.s / a.n : 0 }); }
      }
    }
    return { by, dates, ref, p, list, est, pw, loose, at, unp };
  }

  /* ---------- graphiques ---------- */
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function axis(max) {
    const step = niceStep(Math.max(max, 0.001) / 4);
    const top = Math.ceil(max / step - 1e-9) * step || step;
    const ticks = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
    return { top, ticks };
  }
  const tickFmt = (v) => (v >= 10 || Number.isInteger(v) ? String(Math.round(v * 10) / 10) : f1(v));

  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function isoWeek(d) {
    const dt = new Date(d + 'T00:00:00Z'), day = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - day + 3);
    const y = dt.getUTCFullYear(), j4 = new Date(Date.UTC(y, 0, 4));
    return { y, w: 1 + Math.round(((dt - j4) / 864e5 - 3 + ((j4.getUTCDay() + 6) % 7)) / 7) };
  }
  const daysInMonth = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate();

  /* Regroupe les jours en barres : jour, semaine (n° ISO), mois ou année. */
  function buckets(list, gran) {
    const map = new Map();
    for (const d of list) {
      let key, label, sub = '', start = d.date, full = true, ref = d.date;
      if (gran === 'week') {
        const iw = isoWeek(d.date), mon = C.addDays(d.date, -((C.dow(d.date) + 6) % 7));
        key = iw.y + '-' + iw.w; label = 'S' + iw.w; sub = dmy(mon); start = mon; ref = mon;
      } else if (gran === 'month') {
        key = d.date.slice(0, 7); label = MOIS[+d.date.slice(5, 7) - 1]; sub = d.date.slice(0, 4); start = key + '-01';
      } else if (gran === 'year') { key = d.date.slice(0, 4); label = key; start = key + '-01-01'; }
      else { key = d.date; label = dmy(d.date); }
      if (!map.has(key)) map.set(key, { key, label, sub, start, ref, hp: 0, hc: 0, kwh: 0, days: [], gran });
      const b = map.get(key); b.hp += d.hp; b.hc += d.hc; b.kwh += d.kwh; b.days.push(d);
    }
    const out = [...map.values()];
    for (const b of out) {
      const n = b.days.length;
      b.full = b.gran === 'day' ? true : b.gran === 'week' ? n === 7 : b.gran === 'month' ? n === daysInMonth(b.start) : n >= 365;
      b.first = b.days[0].date; b.last = b.days[n - 1].date;
    }
    return out;
  }

  function stackedBars(list, gran) {
    const bs = buckets(list, gran || 'day');
    const two = gran === 'week' || gran === 'month';
    const W = 360, H = two ? 214 : 200, L = 30, R = 6, T = 14, B = two ? 38 : 24, iw = W - L - R, ih = H - T - B;
    const ax = axis(Math.max(1, ...bs.map((d) => d.kwh)));
    const y = (v) => T + ih - (v / ax.top) * ih;
    const n = bs.length, slot = iw / n, bw = Math.min(gran === 'day' || !gran ? 26 : 44, slot * 0.72);
    const what = { day: 'jour', week: 'semaine', month: 'mois', year: 'année' }[gran || 'day'];
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Consommation par ${what}, en kWh, répartie entre heures pleines et heures creuses">`;
    for (const t of ax.ticks) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 4}" y="${y(t) + 3}" text-anchor="end">${tickFmt(t)}</text>`;
    const every = Math.ceil(n / (two ? 7 : 8));
    bs.forEach((d, i) => {
      const cx = L + slot * i + slot / 2, x = cx - bw / 2;
      const yh = y(d.hp), yt = y(d.hp + d.hc), sel = ui.bsel === d.key;
      const op = d.full ? '' : ' opacity="0.55"';
      s += `<rect x="${x}" y="${yh}" width="${bw}" height="${Math.max(0, y(0) - yh)}" fill="var(--hp)"${op}/>`;
      s += `<rect x="${x}" y="${yt}" width="${bw}" height="${Math.max(0, yh - yt)}" fill="var(--hc)"${op}${sel ? ' stroke="var(--ink)" stroke-width="1.6"' : ''}/>`;
      if (i % every === 0) {
        s += `<text x="${cx}" y="${H - (two ? 20 : 8)}" text-anchor="middle">${esc(d.label)}</text>`;
        if (two && d.sub) s += `<text x="${cx}" y="${H - 8}" text-anchor="middle" style="font-size:8px">${esc(d.sub)}</text>`;
      }
      /* changement de mois entre deux semaines : trait pointillé et nom du mois */
      if (gran === 'week' && i > 0 && d.start.slice(0, 7) !== bs[i - 1].start.slice(0, 7)) {
        const mx = L + slot * i;
        s += `<line x1="${mx}" x2="${mx}" y1="${T - 4}" y2="${T + ih}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3"/><text x="${mx + 3}" y="${T + 6}" text-anchor="start" style="font-size:8.5px">${MOIS[+d.start.slice(5, 7) - 1]}</text>`;
      }
      s += (gran && gran !== 'day')
        ? `<rect class="hit" data-act="bucket" data-k="${d.key}" x="${L + slot * i}" y="${T}" width="${slot}" height="${ih}"/>`
        : `<rect class="hit" data-act="goday" data-date="${d.key}" x="${L + slot * i}" y="${T}" width="${slot}" height="${ih}"/>`;
    });
    return s + '</svg>';
  }

  function bucketCard(list, ref) {
    const gran = ui.gran;
    const chips = [['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois'], ['year', 'Année']].map(([k, l]) => `<button class="chip" aria-pressed="${gran === k}" data-act="gran" data-v="${k}">${l}</button>`).join('');
    let h = `<div class="card"><h2>Consommation (kWh)</h2><div class="chips" role="group" aria-label="Regroupement">${chips}</div>${stackedBars(list, gran)}<div class="legend">${LEG_HPHC}${gran === 'day' ? '' : '<span>Barre pâle : période incomplète</span>'}</div>`;
    const b = gran === 'day' ? null : buckets(list, gran).find((x) => x.key === ui.bsel);
    if (b) {
      const cr = C.costFor(ref, b.days), nd = b.days.length;
      h += `<div class="slot"><div class="row between"><h3>${esc(b.label)}${b.sub && gran === 'month' ? ' ' + esc(b.sub) : ''}</h3><span class="tag">${nd} jour${nd > 1 ? 's' : ''}${b.full ? '' : ' · incomplet'}</span></div>
        <p class="num" style="margin:4px 0 0">${f1(b.kwh)} kWh · ${eur(cr.total)} <span class="muted">(${f1(b.kwh / nd)} kWh et ${eur(cr.total / nd)} par jour)</span></p>
        <p class="num small" style="margin:4px 0 0"><span class="dot hp"></span> HP ${f1(b.hp)} · <span class="dot hc"></span> HC ${f1(b.hc)} <span class="muted">· du ${dmy(b.first)} au ${dmy(b.last)}</span></p></div>`;
    } else h += `<p class="note">${gran === 'day' ? 'Touche une barre pour ouvrir le jour.' : 'Touche une barre pour voir son détail. Une barre est un total ; le détail donne aussi la moyenne par jour.'}</p>`;
    return h + '</div>';
  }

  const LEG_HPHC = '<span><i class="dot hp"></i>Heures pleines</span><span><i class="dot hc"></i>Heures creuses</span>';

  /* barres de puissance par créneau ; pts : [{min, w, forced}], date sert à la part HC (couleur de la barre) */
  function powerBars(pts, date, selIdx, label, inert) {
    const W = 360, H = 190, L = 30, R = 6, T = 10, B = 24, iw = W - L - R, ih = H - T - B;
    const ax = axis(Math.max(500, ...pts.map((p) => p.w)) / 1000);
    const y = (v) => T + ih - (v / ax.top) * ih;
    const n = pts.length, slot = iw / n, bw = Math.max(1.5, slot * 0.78);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
    for (const t of ax.ticks) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 4}" y="${y(t) + 3}" text-anchor="end">${tickFmt(t)}</text>`;
    s += `<text x="${L}" y="${T - 1}" text-anchor="start" style="font-size:8.5px">kW</text>`;
    pts.forEach((p, i) => {
      const f = p.hs !== undefined ? p.hs : C.hcShare(date, p.min, S.schedules, S.shift);
      const h = Math.max(0, y(0) - y(p.w / 1000)), x = L + slot * i + (slot - bw) / 2;
      const stroke = i === selIdx ? ' stroke="var(--ink)" stroke-width="2"' : p.forced ? ' stroke="var(--ink)" stroke-width="1.2" stroke-dasharray="2 1.5"' : '';
      s += `<rect x="${x}" y="${y(p.w / 1000)}" width="${bw}" height="${h}" fill="${f >= 0.5 ? 'var(--hc)' : 'var(--hp)'}"${stroke}/>`;
      if (!inert || inert === 'unx') s += `<rect class="hit" data-act="${inert === 'unx' ? 'unxgo' : 'slot'}" data-i="${i}" x="${L + slot * i}" y="${T}" width="${slot}" height="${ih}"/>`;
    });
    for (let hr = 0; hr <= 24; hr += 4) {
      const i = Math.min(n, (hr * 60) / (1440 / 48));
      s += `<text x="${L + slot * i}" y="${H - 8}" text-anchor="middle">${hr === 24 ? '24h' : hr + 'h'}</text>`;
    }
    return s + '</svg>';
  }

  function profile(by, p) {
    const sum = new Array(48).fill(0), cnt = new Array(48).fill(0);
    for (const d of Object.keys(by)) {
      if (d < p.from || d > p.to) continue;
      for (const s of by[d]) { const k = Math.min(47, Math.floor(s.min / 30)); sum[k] += s.w; cnt[k]++; }
    }
    return sum.map((v, k) => ({ min: k * 30, w: cnt[k] ? v / cnt[k] : 0, forced: false }));
  }

  /* ---------- vues ---------- */
  function header(sub, compact) {
    const sel = sites.list.length > 1 ? `<select class="sitesel" data-ch="site" aria-label="Site">${sites.list.map((x) => `<option value="${x.id}"${x.id === sites.cur ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : '';
    return `<div class="top${compact ? ' compact' : ''}"><div class="grow"><h1>Ma conso électrique</h1>${sel}</div><small>${esc(sub || '')}</small></div>`;
  }
  const hasData = (m) => m.dates.length > 0;
  function empty() {
    return `<div class="card"><h3>Aucune donnée pour l'instant</h3><p class="muted" style="margin-top:6px">Importe tes fichiers CSV dans l'onglet Données : les index quotidiens et les puissances à la demi-heure.</p><div style="margin-top:12px"><button class="btn" data-act="tab" data-tab="donnees">Ouvrir Données</button></div></div>`;
  }

  /* Titre compact + choix de la période, figés en haut (Tableau et Équipements). */
  function periodBar(m) {
    const { p, list } = m;
    let h = '<div class="stick">' + header(dmy(p.from) + ' → ' + dmy(p.to) + ' · ' + list.length + ' j', true);
    h += `<div class="chips" role="group" aria-label="Période">
      <button class="chip" aria-pressed="${ui.preset === 'all'}" data-act="preset" data-v="all">Tout</button>
      <button class="chip" aria-pressed="${ui.preset === '7'}" data-act="preset" data-v="7">7 j</button>
      <button class="chip" aria-pressed="${ui.preset === 'month'}" data-act="preset" data-v="month">Ce mois</button>
      <button class="chip" aria-pressed="${ui.preset === 'year'}" data-act="preset" data-v="year">Cette année</button>
      <button class="chip" aria-pressed="${ui.preset === 'custom'}" data-act="preset" data-v="custom">Dates</button></div>`;
    if (ui.preset === 'custom') h += `<div class="range"><label class="f grow">Du<input type="date" id="pfrom" value="${p.from}" data-ch="pfrom"></label><label class="f grow">Au<input type="date" id="pto" value="${p.to}" data-ch="pto"></label></div>`;
    h += '</div>';
    return h;
  }

  function viewDash(m) {
    if (!hasData(m)) return header() + empty();
    const { p, list, ref } = m;
    const tot = list.reduce((a, d) => ({ hp: a.hp + d.hp, hc: a.hc + d.hc }), { hp: 0, hc: 0 });
    const kwh = tot.hp + tot.hc, cr = C.costFor(ref, list);
    const nIdx = list.filter((d) => d.src !== '30min').length;
    let h = periodBar(m);
    if (!list.length) return h + `<div class="card"><h3>Aucune donnée sur cette période</h3><p class="muted" style="margin-top:6px">Du ${dmyFull(p.from)} au ${dmyFull(p.to)}, l'appli n'a encore aucun relevé. Importe un export plus récent dans l'onglet Données, ou choisis une autre période.</p></div>`;
    h += `<div class="card hero"><span class="lbl">Coût sur la période · ${esc(ref.name)}</span><span class="big">${eur(cr.total)}</span>
      <span class="lbl">dont abonnement ${eur(cr.abo)} · énergie ${eur(cr.energy)}</span>
      <div class="stats"><div class="stat"><div class="v">${f1(kwh)} kWh</div><div class="l">Total</div></div>
      <div class="stat"><div class="v">${f1(tot.hp)}</div><div class="l"><span class="dot hp"></span>HP</div></div>
      <div class="stat"><div class="v">${f1(tot.hc)}</div><div class="l"><span class="dot hc"></span>HC</div></div></div>
      <div class="stats" style="margin-top:10px;padding-top:10px"><div class="stat"><div class="v">${f1(kwh / list.length)}</div><div class="l">kWh par jour (moy.)</div></div>
      <div class="stat"><div class="v">${f1(tot.hp / list.length)}</div><div class="l"><span class="dot hp"></span>HP par jour</div></div>
      <div class="stat"><div class="v">${f1(tot.hc / list.length)}</div><div class="l"><span class="dot hc"></span>HC par jour</div></div></div>
      <p class="note">Moyennes par jour sur la période sélectionnée (${dmy(p.from)} → ${dmy(p.to)}, ${list.length} jour${list.length > 1 ? 's' : ''}) : ${eur(cr.total / list.length)} par jour, ${kwh ? Math.round((tot.hc / kwh) * 100) : 0} % de la consommation en heures creuses.</p></div>`;
    if (nIdx) h += `<div class="warn">${nIdx} jour${nIdx > 1 ? 's' : ''} sans détail à la demi-heure : calculé à partir des index quotidiens.</div>`;
    h += bucketCard(list, ref);
    h += `<div class="card"><h2>Comparaison des contrats</h2><div class="list">${contractRows(list, ref)}</div><p class="note">${S.contracts.length < 2 ? 'Ajoute un ou deux contrats dans l\'onglet Contrats pour voir l\'écart de coût sur la même consommation.' : 'Même consommation, mêmes heures creuses, prix de chaque contrat. Abonnement ramené au nombre de jours.'}</p></div>`;
    h += pmaxCard(m);
    h += `<div class="card"><h2>Journée type · moyenne du ${dmy(p.from)} au ${dmy(p.to)}</h2>${powerBars(profile(m.by, p), p.to, -1, 'Puissance moyenne par demi-heure sur la période sélectionnée')}<div class="legend">${LEG_HPHC}</div><p class="note">Chaque barre est la moyenne de cette demi-heure sur la période choisie en haut de page. Les blocs réguliers montrent les gros appareils programmés.</p></div>`;
    return h;
  }

  function contractRows(list, ref) {
    const cr = C.costFor(ref, list);
    return S.contracts.map((c) => {
      const r = C.costFor(c, list), d = r.total - cr.total;
      const meta = c.type === 'base' ? `Base ${nf(4).format(c.base)} €/kWh` : `HP ${nf(4).format(c.hp)} · HC ${nf(4).format(c.hc)}${c.weekendHC ? ' · week-end HC' : ''}`;
      return `<div class="item"><div class="grow"><h3>${esc(c.name)} ${c.ref ? '<span class="tag">référence</span>' : ''}</h3><div class="small muted num">${meta} · abo ${f2(c.abo)} €/mois</div></div>
        <div style="text-align:right"><div class="num" style="font-size:17px">${eur(r.total)}</div>${c.ref ? '' : `<span class="delta ${d < 0 ? 'good' : 'bad'}">${signed(d)}</span>`}</div></div>`;
    }).join('');
  }

  function pmaxCard(m) {
    const days = Object.keys(S.pmax || {}).filter((d) => m.p && d >= m.p.from && d <= m.p.to).sort();
    if (!days.length) return '';
    const kva = S.kva || 12, kva2 = S.kva2 || 9, lim = kva * 1000, alt = kva2 * 1000;
    const vals = days.map((d) => S.pmax[d]), top = Math.max(...vals), dTop = days[vals.indexOf(top)];
    const W = 360, H = 200, L = 30, R = 6, T = 14, B = 24, iw = W - L - R, ih = H - T - B;
    const ax = axis(Math.max(lim, alt, top) / 1000), y = (v) => T + ih - (v / ax.top) * ih;
    const n = days.length, slot = iw / n, bw = Math.min(24, slot * 0.72), every = Math.ceil(n / 8);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Puissance maximale atteinte chaque jour, en kVA, face à ${kva} kVA souscrits et ${kva2} kVA à comparer">`;
    for (const t of ax.ticks) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 4}" y="${y(t) + 3}" text-anchor="end">${tickFmt(t)}</text>`;
    days.forEach((d, i) => {
      const cx = L + slot * i + slot / 2, v = vals[i] / 1000;
      s += `<rect x="${cx - bw / 2}" y="${y(v)}" width="${bw}" height="${Math.max(0, y(0) - y(v))}" fill="var(--accent)"/>`;
      if (i % every === 0) s += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${dmy(d)}</text>`;
    });
    const hiFirst = lim >= alt;
    const line = (v, color, dash, label, above) => {
      const yy = y(v / 1000);
      return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${color}" stroke-width="1.8" stroke-dasharray="${dash}"/><text x="${W - R}" y="${above ? yy - 4 : yy + 11}" text-anchor="end" style="fill:${color};font-size:10px;font-weight:600">${label}</text>`;
    };
    s += line(alt, 'var(--alt)', '2 3', `${tickFmt(kva2)} kVA · à comparer`, true);
    s += line(lim, 'var(--bad)', '6 3', `${tickFmt(kva)} kVA · ton contrat`, hiFirst);
    s += '</svg>';
    const over = vals.filter((v) => v > alt).length;
    return `<div class="card"><h2>Puissance max par jour (kVA)</h2>${s}
      <p class="note">Pic de ${f1(top / 1000)} kVA le ${dmy(dTop)} : ${Math.round((top / lim) * 100)} % de tes ${tickFmt(kva)} kVA souscrits et ${Math.round((top / alt) * 100)} % de ${tickFmt(kva2)} kVA. ${over ? `${over} jour${over > 1 ? 's' : ''} sur ${n} au-dessus de ${tickFmt(kva2)} kVA.` : `Aucun des ${n} jours ne dépasse ${tickFmt(kva2)} kVA.`} Un hiver plus froid peut monter plus haut.</p></div>`;
  }

  /* Somme de la journée par équipement (kWh) quand aucun créneau n'est sélectionné. */
  function daySplit(m, d, sl) {
    if (!S.equip.length) return '';
    const acc = {}; let unx = 0, tot = 0;
    for (const s of sl) {
      const row = { key: s.key, date: d, min: s.min, w: s.w, share: C.hcShare(d, s.min, S.schedules, S.shift), hs: s.hs };
      const sp = C.splitSlot(S, row, m.pw);
      for (const it of sp.items) acc[it.id] = (acc[it.id] || 0) + (it.w * 0.5) / 1000;
      unx += (sp.unexplained * 0.5) / 1000; tot += (s.w * 0.5) / 1000;
    }
    if (!(tot > 0)) return '';
    const rows = [{ name: 'Non expliqué', kwh: unx, grey: true }].concat(S.equip.map((e) => ({ name: e.name, kwh: acc[e.id] || 0 })).filter((r) => r.kwh >= 0.005).sort((x, y) => y.kwh - x.kwh));
    return `<details class="fold" data-k="dayrep"${op('dayrep', true)} style="margin-top:10px"><summary class="foldh small">Répartition de la journée (${nf(1).format(tot)} kWh)</summary><div class="list" style="margin-top:8px">${rows.map((r) => {
      const pc = (r.kwh / tot) * 100;
      return `<div class="shr"><div class="row between"><span>${esc(r.name)}</span><span class="num">${nf(2).format(r.kwh)} kWh · ${Math.round(pc)} %</span></div><div class="bar"><i style="width:${pc.toFixed(1)}%;${r.grey ? 'background:var(--line)' : ''}"></i></div></div>`;
    }).join('')}</div><p class="note">Somme des demi-heures du jour, d'après les équipements en route et leurs puissances. Touche une barre pour voir un créneau précis.</p></details>`;
  }

  function viewDay(m) {
    if (!hasData(m)) return header() + empty();
    if (!ui.day) ui.day = todayIso();
    const d = ui.day, i = m.dates.indexOf(d), has = i >= 0;
    const maxDay = todayIso() > m.dates[m.dates.length - 1] ? todayIso() : m.dates[m.dates.length - 1];
    const st = has ? C.dayStats(S, m.by, d) : null, sl = m.by[d];
    const wd = JOURS[C.dow(d)];
    let h = '<div class="stick">' + header(wd + ' ' + dmyFull(d), true);
    h += `<div class="daynav"><button class="iconbtn" data-act="dayprev" aria-label="Jour précédent" ${d <= m.dates[0] ? 'disabled' : ''}>‹</button>
      <input type="date" id="dayin" value="${d}" min="${m.dates[0]}" max="${maxDay}" data-ch="dayin" aria-label="Choisir un jour">
      <button class="iconbtn" data-act="daynext" aria-label="Jour suivant" ${d >= maxDay ? 'disabled' : ''}>›</button></div></div>`;
    if (!has) return h + `<div class="card"><p class="muted">Pas de relevé EDF pour le ${dmyFull(d)}. Tu peux quand même indiquer quels équipements ont tourné : ces plages serviront aux estimations dès que les données arriveront.</p></div>` + dayEquipCard(d) + assignCard(m);
    const cr = C.costFor(m.ref, [st]);
    h += `<div class="card"><div class="stats" style="margin:0;padding:0;border:0"><div class="stat"><div class="v">${f1(st.kwh)} kWh</div><div class="l">Total du jour</div></div>
      <div class="stat"><div class="v" style="color:var(--hp)">${f1(st.hp)}</div><div class="l"><span class="dot hp"></span>HP</div></div>
      <div class="stat"><div class="v" style="color:var(--hc)">${f1(st.hc)}</div><div class="l"><span class="dot hc"></span>HC</div></div></div>
      <p class="note">${eur(cr.total)} avec ${esc(m.ref.name)}, abonnement inclus.${st.forced ? ` ${st.forced} créneau${st.forced > 1 ? 'x' : ''} corrigé${st.forced > 1 ? 's' : ''} à la main.` : ''}</p></div>`;
    if (st.src === '30min') {
      const sel = ui.sel != null && sl[ui.sel] ? ui.sel : null;
      h += `<div class="card"><h2>Puissance par demi-heure</h2>${powerBars(sl, d, sel, 'Puissance moyenne par demi-heure ce jour')}
        <div class="legend">${LEG_HPHC}<span>Contour pointillé : valeur corrigée</span></div>`;
      if (sel != null) {
        const s = sl[sel], k = (s.w * 0.5) / 1000, f = s.hs !== undefined ? s.hs : C.hcShare(d, s.min, S.schedules, S.shift);
        h += `<div class="slot"><div class="row between"><h3 class="num">${C.fromMin(s.min)} – ${C.fromMin(s.min + 30)}</h3><span class="tag">${f >= 0.995 ? 'heures creuses' : f <= 0.005 ? 'heures pleines' : Math.round(f * 100) + ' % creuses'}</span></div>
          <p class="num" style="margin:4px 0 10px">${Math.round(s.w)} W · ${nf(3).format(k)} kWh${s.forced ? ` <span class="muted">(relevé : ${Math.round(s.raw)} W)</span>` : ''}</p>
          <details class="fold" data-k="dayrep"${op('dayrep', true)} style="margin-top:8px"><summary class="foldh small">Répartition de ce créneau : équipements en route</summary>${equipChecks({ key: s.key, date: d, min: s.min, w: s.w, share: f }, m)}</details>
          <div class="row" style="margin-top:12px"><label class="f grow">Forcer la valeur (W)<input id="forcew" inputmode="decimal" value="${Math.round(s.w)}"></label>
          <button class="btn" data-act="force" data-key="${esc(s.key)}">Appliquer</button>${s.forced ? `<button class="btn ghost" data-act="unforce" data-key="${esc(s.key)}">Rétablir</button>` : ''}</div></div>`;
      } else h += `<p class="note">Touche une barre pour voir le créneau et corriger sa valeur.</p>` + daySplit(m, d, sl);
      h += '</div>';
      h += dayEquipCard(d) + assignCard(m);
    } else {
      h += `<div class="card"><p class="muted">Pas de détail à la demi-heure pour ce jour : le total vient des index quotidiens (arrondis au kWh). Importe le fichier de puissances pour voir la courbe.</p></div>`;
    }
    return h;
  }

  /* Croix pleine : en route (règle du mode ou confirmé). Croix en pointillé : proposé par l'estimation, à confirmer. */
  function eqIcon(st) {
    if (st === 'auto') return '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="3 2.5"/></svg>';
    const box = st === 'on' ? '<rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="var(--accent)" stroke="var(--accent)" stroke-width="1.5"/>'
      : `<rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="none" stroke="${st === 'sug' ? 'var(--accent)' : 'var(--muted)'}" stroke-width="1.5"${st === 'sug' ? ' stroke-dasharray="3 2.5"' : ''}/>`;
    const cross = st === 'on' ? '<path d="M7 7l10 10M17 7 7 17" stroke="var(--accent-ink)" stroke-width="2.4" stroke-linecap="round"/>'
      : st === 'sug' ? '<path d="M7 7l10 10M17 7 7 17" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="butt" stroke-dasharray="2.6 2.4"/>' : '';
    return `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${box}${cross}</svg>`;
  }

  function equipChecks(row, m) {
    if (!S.equip.length) return `<p class="note">Liste tes équipements dans l'onglet Équipements pour les cocher ici.</p>`;
    const sp = C.splitSlot(S, row, m.pw), byId = {};
    sp.items.forEach((it) => { byId[it.id] = it.w; });
    const sug = C.suggestFor(S, row, m.pw, m.loose);
    let h = `<div class="eqchecks"><div class="eqrow"><span class="grow"><b>Non expliqué</b><br><span class="small muted">part de la conso qu'aucun équipement n'explique</span></span><span class="num"><b>${Math.round(sp.unexplained)} W</b></span></div>`;
    for (const e of S.equip) {
      const on = C.eqOn(S, e, row.key, row.share), forced = C.eqSet(S, e, row.key) === true;
      const vw = on ? C.veWindow(S, e.id, row.key) : null, fl = m.pw._floor || 0;
      const locked = C.eqLocked(S, e.id, row.key), exact = !!(vw && vw.from && vw.to);
      /* Valeurs sûres : fond en continu, relevé du chargeur, plage sûre (ex. chauffe-eau), forçage manuel. Le reste d'une plage = tendance (pointillé). */
      const sureOn = on && (e.mode === 'h24' || forced || locked || exact || e.sure);
      const auto = on && !forced && sp.idle.includes(e.id);
      const trend = on && !sureOn && !auto;
      const st = auto ? 'auto' : on ? (sureOn ? 'on' : 'sug') : sug === e.id ? 'sug' : 'off';
      let how = forced ? 'confirmé' : st === 'on' ? (e.mode === 'h24' ? 'continu' : exact ? '' : e.sure ? 'plage sûre' : 'plage définie') : trend ? 'tendance de la plage · touche pour confirmer' : st === 'sug' ? 'estimé · touche pour confirmer' : '';
      const w = on && st !== 'auto' && byId[e.id] ? Math.round(byId[e.id]) + ' W' : st === 'sug' && m.pw[e.id] ? '≈ ' + Math.round(m.pw[e.id].w) + ' W' : '—';
      if (vw) {
        const r = (byId[e.id] || 0) + sp.avail, ref = m.pw[e.id].w || 3700;
        if (vw.from && vw.to) how = 'recharge confirmée par le chargeur';
        if (st === 'auto') how = `plage prévue, mais peu probable : puissance trop faible pour une recharge (≈ ${Math.round(r)} W au-dessus du fond)`;
        else how += (how ? ' · ' : '') + (r >= 0.5 * ref ? `cohérent avec une recharge (≈ ${Math.round(r)} W au-dessus du fond)` : `peu probable : puissance trop faible pour une recharge (≈ ${Math.round(r)} W au-dessus du fond)`);
      } else if (st === 'auto') how = `désactivé par l'analyse : consommation proche du fond (≈ ${Math.round(fl)} W). Touche pour forcer en route.`;
      if (locked) how += (how ? ' · ' : '') + 'forcé par toi';
      h += `<div class="eqrow"><button class="eqx" data-act="eqtap" data-eq="${e.id}" data-key="${esc(row.key)}" data-st="${st}" role="checkbox" aria-checked="${st === 'on' ? 'true' : st === 'sug' ? 'mixed' : 'false'}" aria-label="${esc(e.name)} : ${st === 'on' ? 'en route' : st === 'sug' ? 'estimé en route, à confirmer' : st === 'auto' ? 'désactivé par l\'analyse' : 'à l\'arrêt'}">${eqIcon(st)}</button><span class="grow">${esc(e.name)}${how ? `<br><span class="small muted">${how}</span>` : ''}</span><span class="num muted">${w}</span>${locked ? `<button class="eqx" data-act="eqlock" data-eq="${e.id}" data-key="${esc(row.key)}" aria-label="Déverrouiller : ${esc(e.name)} sera de nouveau mis à jour par les imports" title="Verrouillé : touche pour déverrouiller"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" fill="var(--ink)"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="var(--ink)" stroke-width="2"/></svg></button>` : ''}</div>`;
    }
    return h + `<div class="legend"><span>${eqIcon('on').replace('width="24" height="24"', 'width="16" height="16"')}Croix pleine : sûr (relevé, fond, plage sûre ou forcé par toi)</span><span>${eqIcon('sug').replace('width="24" height="24"', 'width="16" height="16"')}Croix pointillée : tendance ou estimé</span><span>${eqIcon('auto').replace('width="24" height="24"', 'width="16" height="16"')}Carré pointillé : désactivé par l'analyse</span><span>Cadenas : forcé par toi, protégé des imports</span></div></div>`;
  }

  const todayIso = () => { const t = new Date(), z = (n) => String(n).padStart(2, '0'); return t.getFullYear() + '-' + z(t.getMonth() + 1) + '-' + z(t.getDate()); };

  /* Plages d'un jour pour chaque équipement, lues sur les croix (utile même sans relevé EDF). */
  function dayEquipCard(d) {
    if (!S.equip.length) return `<div class="card"><p class="note">Liste tes équipements dans l'onglet Équipements pour indiquer leurs plages.</p></div>`;
    const z = (n) => String(n).padStart(2, '0');
    const rows = S.equip.map((e) => {
      const runs = []; let cur = null;
      for (let min = 0; min < 1440; min += 30) {
        const key = d + ' ' + z(Math.floor(min / 60)) + ':' + z(min % 60);
        const on = C.eqOn(S, e, key, C.hcShare(d, min, S.schedules, S.shift));
        if (on && !cur) cur = { a: min, locked: false };
        if (on) cur.locked = cur.locked || C.eqLocked(S, e.id, key);
        if (!on && cur) { cur.b = min; runs.push(cur); cur = null; }
      }
      if (cur) { cur.b = 1440; runs.push(cur); }
      const t = (x) => z(Math.floor((x % 1440) / 60)) + ':' + z(x % 60);
      return `<div class="item"><span>${esc(e.name)}</span><span class="num small" style="text-align:right">${runs.length ? runs.map((r) => `${t(r.a)} → ${t(r.b)}${r.locked ? ' 🔒' : ''}`).join('<br>') : '<span class="muted">aucune plage</span>'}</span></div>`;
    });
    return `<div class="card"><h2>Équipements ce jour</h2><div class="list">${rows.join('')}</div><p class="note">🔒 : plage forcée par toi. Les autres viennent de la règle de l'équipement. Modifie-les avec la carte ci-dessous.</p></div>`;
  }

  /* Heure : sélecteur d'origine du téléphone par défaut ; liste en option (réglage dans Données). */
  const PKEY = 'conso-prefs-v1';
  function prefs() { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch (e) { return {}; } }
  function setPref(k, v) { try { const p = prefs(); p[k] = v; localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) { /* ignoré */ } }
  function tsel(attrs, val, step, blank, end) {
    if (prefs().timeList !== true) return `<input type="time" ${attrs} value="${val || ''}">`;
    const set = new Set(); for (let m = 0; m < 1440; m += step) set.add(C.fromMin(m));
    if (end) set.add('24:00'); /* fin de journée */
    if (val) set.add(val);
    const list = Array.from(set).sort();
    return `<select ${attrs}>${blank ? `<option value=""${val ? '' : ' selected'}>—</option>` : ''}${list.map((t) => `<option value="${t}"${t === val ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  }

  function assignCard(m) {
    if (!S.equip.length) return '';
    return `<div class="card"><h2>Affecter des équipements à une plage</h2>
      <div class="grid2"><label class="f">De${tsel('id="asf"', '01:00', 30)}</label><label class="f">À${tsel('id="ast"', '05:30', 30, false, true)}</label>
      <label class="f" style="grid-column:1/-1">Jours concernés<select id="asscope"><option value="day">Ce jour seulement (${dmy(ui.day)})</option><option value="all">Tous les jours de la période du tableau de bord</option><option value="wk">Du lundi au vendredi de cette période</option><option value="we">Les week-ends de cette période</option></select></label></div>
      <div class="eqpick">${S.equip.map((e) => `<label class="row" style="gap:8px"><input type="checkbox" class="aseq" data-id="${e.id}">${esc(e.name)}</label>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="btn" data-act="assign" data-v="on">En route</button><button class="btn ghost" data-act="assign" data-v="off">À l'arrêt</button><button class="btn ghost" data-act="assign" data-v="rule">Règle du mode</button></div>
      <p class="note">Coche les équipements, choisis la plage et les jours, puis indique s'ils fonctionnaient. « Règle du mode » annule tes choix manuels sur cette plage.</p>
      ${ui.eqMsg ? `<div class="msg">${esc(ui.eqMsg)}</div>` : ''}</div>`;
  }

  function contractForm(c, n) {
    const base = c.type === 'base';
    return `<div class="card" data-cid="${c.id}">
      <div class="row between"><h3>${c.ref ? 'Contrat de référence' : 'Contrat alternatif'}</h3>
        ${c.ref ? '<span class="tag">référence</span>' : `<span class="row" style="gap:6px"><button class="btn ghost" data-act="setref" data-id="${c.id}">Définir comme référence</button>${n > 1 ? `<button class="btn danger" data-act="delc" data-id="${c.id}">Supprimer</button>` : ''}</span>`}</div>
      <div class="grid2" style="margin-top:10px">
        <label class="f" style="grid-column:1/-1">Nom<input id="n-${c.id}" value="${esc(c.name)}" data-ch="cname" data-id="${c.id}"></label>
        <label class="f">Type<select id="t-${c.id}" data-ch="ctype" data-id="${c.id}"><option value="hphc"${base ? '' : ' selected'}>Heures pleines / creuses</option><option value="base"${base ? ' selected' : ''}>Base (prix unique)</option></select></label>
        <label class="f">Abonnement (€ TTC/mois)<input id="a-${c.id}" inputmode="decimal" value="${c.abo}" data-ch="cnum" data-f="abo" data-id="${c.id}"></label>
        ${base ? `<label class="f" style="grid-column:1/-1">Prix du kWh (€ TTC)<input id="b-${c.id}" inputmode="decimal" value="${c.base}" data-ch="cnum" data-f="base" data-id="${c.id}"></label>`
          : `<label class="f">Prix HP (€ TTC/kWh)<input id="p-${c.id}" inputmode="decimal" value="${c.hp}" data-ch="cnum" data-f="hp" data-id="${c.id}"></label>
        <label class="f">Prix HC (€ TTC/kWh)<input id="h-${c.id}" inputmode="decimal" value="${c.hc}" data-ch="cnum" data-f="hc" data-id="${c.id}"></label>
        <label class="row" style="grid-column:1/-1;gap:8px;font-size:14px"><input type="checkbox" id="w-${c.id}" ${c.weekendHC ? 'checked' : ''} data-ch="cwe" data-id="${c.id}">Week-end entièrement au tarif heures creuses</label>`}
      </div></div>`;
  }

  function viewContracts(m) {
    let h = header();
    if (hasData(m)) h += `<div class="card"><h2>Coût sur ${dmy(m.p.from)} → ${dmy(m.p.to)}</h2><div class="list">${contractRows(m.list, m.ref)}</div><p class="note">Les jours fériés ne sont pas pris en compte dans l'option week-end.</p></div>`;
    h += S.contracts.map((c) => contractForm(c, S.contracts.length)).join('');
    h += `<div class="card"><h2>Puissance</h2><div class="grid2"><label class="f">Souscrite (kVA)<input id="kva" inputmode="decimal" value="${S.kva || 12}" data-ch="kva"></label><label class="f">À comparer (kVA)<input id="kva2" inputmode="decimal" value="${S.kva2 || 9}" data-ch="kva2"></label></div><p class="note">Les deux lignes apparaissent sur le graphique des pics de puissance du tableau de bord.</p></div>`;
    h += S.contracts.length < 4 ? `<button class="btn" data-act="addc">Ajouter un contrat à comparer</button>` : `<p class="note">Quatre contrats au maximum : référence + trois alternatives.</p>`;
    return h;
  }

  function viewData(m) {
    const nSl = Object.keys(S.slots).length, nIdx = Object.keys(S.idx).length;
    const hd = Object.keys(m.by).sort();
    let h = header();
    if (!storageOk) h += `<div class="warn">Ce navigateur ne garde pas les données entre deux ouvertures. Utilise la sauvegarde ci-dessous après chaque modification.</div>`;
    h += `<p class="small muted" style="margin:0 0 10px">Version de l'appli : <b>${APP_VERSION}</b> · ${APP_DATE}</p>`;
    h += syncCard();
    h += siteCard();
    h += `<div class="card"><h2>Affichage</h2><label class="f">Choix des heures<select id="timemode" data-ch="timemode"><option value="native"${prefs().timeList ? '' : ' selected'}>Sélecteur d'heure du téléphone</option><option value="list"${prefs().timeList ? ' selected' : ''}>Liste d'heures (si les boutons du sélecteur sont coupés)</option></select></label></div>`;
    const eqOpts = S.equip.length > 1 && ui.cat !== 'edf' ? `<label class="f" style="margin-top:10px">Équipement concerné par une recharge VE<select id="veeq" data-ch="veeq"><option value="">Choisi automatiquement</option>${S.equip.map((e) => `<option value="${e.id}"${ui.veEq === e.id ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>` : '';
    h += `<div class="card"><h2>Importer</h2><div class="row" style="margin-bottom:6px"><button class="btn" data-act="drvenedis"${sync.rbusy ? ' disabled' : ''}>Récupérer le dernier fichier Enedis (Drive)</button></div><p class="note" style="margin-top:0;margin-bottom:12px">Cherche conso-enedis.json sur ton Drive (déposé par le script du PC) et l'importe. Google te demande l'autorisation de lire ton Drive la première fois.</p><label class="f" style="margin-bottom:10px">Catégorie du fichier<select id="cat" data-ch="cat"><option value="auto"${ui.cat === 'auto' ? ' selected' : ''}>Détection automatique</option><option value="edf"${ui.cat === 'edf' ? ' selected' : ''}>EDF / distributeur (zip ou CSV)</option><option value="ve"${ui.cat === 've' ? ' selected' : ''}>Recharge VE (export du chargeur)</option></select></label>${eqOpts}<label class="row" style="gap:8px;margin-top:10px"><input type="checkbox" id="force" ${ui.force ? 'checked' : ''} data-ch="force"><span class="small">Écraser aussi mes croix forcées à la main (recharge VE)</span></label><label class="f" style="margin-top:10px">Un zip d'export, ou des fichiers CSV<input type="file" id="files" multiple data-ch="files"></label>
      <details open style="margin-top:10px"><summary class="small">Si « Choisir un fichier » ne réagit pas : coller le texte d'un CSV</summary><label class="f" style="margin-top:8px">Contenu du CSV (ouvre-le dans une appli de fichiers, copie tout, colle ici)<textarea id="pastecsv" placeholder="Nom,Heure,Début :,Fin :…"></textarea></label><div class="row" style="margin-top:8px"><button class="btn" data-act="pastecsv">Importer ce texte</button></div></details><p class="note">Chaque fichier est reconnu tout seul, zip compris. Choisir la catégorie évite qu'un fichier soit rangé au mauvais endroit. Réimporter met à jour les valeurs sans créer de doublons, et tes corrections manuelles sont conservées. Pour la recharge VE : une recharge courte coche seulement ses créneaux ; une recharge longue (prise restée branchée) coche les créneaux de la règle de l'équipement dans sa fenêtre, avec un avis « cohérent » ou « peu probable » ; un jour sans recharge n'a pas de croix. Tes croix forcées à la main (cadenas) sont protégées ; coche « Écraser » pour les remplacer.</p>${ui.msg ? `<div class="msg">${esc(ui.msg)}</div>` : ''}</div>`;
    h += `<div class="card"><h2>Données en mémoire</h2><div class="list">
      <div class="item"><span>Créneaux à la demi-heure</span><span class="num">${nSl}</span></div>
      <div class="item"><span>Jours couverts</span><span class="num">${m.dates.length ? dmy(m.dates[0]) + ' → ' + dmyFull(m.dates[m.dates.length - 1]) : '—'}</span></div>
      <div class="item"><span>Relevés d'index quotidiens</span><span class="num">${nIdx}</span></div>
      <div class="item"><span>Jours de puissance max</span><span class="num">${Object.keys(S.pmax || {}).length}</span></div>
      <div class="item"><span>Créneaux corrigés à la main</span><span class="num">${Object.keys(S.over).length}</span></div></div></div>`;
    h += scheduleCard(m);
    h += checkCard(m);
    h += `<div class="card"><h2>Sauvegarde</h2><p class="small muted">Les données restent dans ce navigateur. Copie la sauvegarde pour la garder ailleurs ou changer de téléphone.</p>
      <div class="row" style="margin-top:10px"><button class="btn" data-act="mkbackup">Préparer la sauvegarde</button></div>
      ${ui.backup ? `<textarea id="bk" readonly aria-label="Sauvegarde">${esc(ui.backup)}</textarea><div class="row" style="margin-top:8px"><button class="btn" data-act="copybk">Copier</button></div>` : ''}
      <label class="f" style="margin-top:14px">Restaurer : colle une sauvegarde ici<textarea id="restore" placeholder='{"v":1,...}'></textarea></label>
      <div class="row" style="margin-top:8px"><button class="btn ghost" data-act="restore">Restaurer</button></div></div>`;
    h += `<div class="card"><h2>Tout effacer</h2>${ui.confirm ? `<p class="small">Cela supprime les relevés, les corrections et les contrats de ce navigateur.</p><div class="row" style="margin-top:10px"><button class="btn danger" data-act="wipe">Oui, tout effacer</button><button class="btn ghost" data-act="nowipe">Annuler</button></div>`
      : `<button class="btn danger" data-act="askwipe">Effacer les données</button>`}</div>`;
    return h;
  }


  /* Ancien test Enedis (v23) retiré : on efface le jeton et le numéro de compteur qui pouvaient rester dans ce navigateur. */
  try { localStorage.removeItem('conso-enedis-v1'); } catch (e) { /* ignoré */ }

  function siteCard() {
    const cur = curSite(), nSl = Object.keys(S.slots).length, nDays = Math.round(nSl / 48);
    let h = `<div class="card"><h2>Sites</h2><div class="list">${sites.list.map((x) => `<div class="item"><span>${esc(x.name)}${x.id === sites.cur ? ' <span class="tag">affiché</span>' : ''}</span>${x.id === sites.cur ? '' : `<button class="btn ghost" data-act="opensite" data-id="${x.id}">Ouvrir</button>`}</div>`).join('')}</div>
      <label class="f" style="margin-top:12px">Nom du site affiché<input id="sitename" value="${esc(cur.name)}" data-ch="sitename"></label>
      <div class="grid2" style="margin-top:12px;align-items:end"><label class="f">Nouveau site<input id="newsite" placeholder="Résidence secondaire"></label><button class="btn" data-act="addsite">Ajouter</button></div>
      <p class="note">Chaque site a ses propres relevés, équipements, contrats et heures creuses.</p>`;
    if (sites.list.length < 2) h += `<p class="note">Le seul site ne peut pas être supprimé.</p>`;
    else if (ui.siteDel === 0) h += `<div class="row" style="margin-top:12px"><button class="btn danger" data-act="sitedel1">Supprimer « ${esc(cur.name)} »…</button></div>`;
    else if (ui.siteDel === 1) h += `<div class="warn" style="margin-top:12px">Tu vas supprimer définitivement « ${esc(cur.name)} » : environ ${nDays} jour${nDays > 1 ? 's' : ''} de relevés (${nSl} créneaux), ${S.equip.length} équipement${S.equip.length > 1 ? 's' : ''} et toutes les corrections de ce site. Prépare d'abord une sauvegarde dans l'onglet Données si tu hésites.</div>
      <div class="row"><button class="btn danger" data-act="sitedel2">Je veux continuer</button><button class="btn ghost" data-act="sitedel0">Annuler</button></div>`;
    else h += `<div class="warn" style="margin-top:12px">Dernière confirmation : recopie le nom exact du site pour valider la suppression.</div>
      <label class="f">Nom à recopier : ${esc(cur.name)}<input id="siteconf" autocomplete="off" value="${esc(ui.siteTyped || '')}" data-ch="siteconf"></label>
      <div class="row" style="margin-top:10px"><button class="btn danger" data-act="sitedel3"${ui.siteTyped === cur.name ? '' : ' disabled'}>Supprimer définitivement</button><button class="btn ghost" data-act="sitedel0">Annuler</button></div>`;
    return h + '</div>';
  }

  function scheduleCard(m) {
    const cal = C.calibrate(S, m.by);
    let h = `<div class="card"><h2>Heures creuses</h2>`;
    S.schedules.forEach((s, i) => {
      const r = (k) => s.ranges[k] || ['', ''];
      h += `<div style="margin-bottom:12px"><div class="row" style="margin-bottom:6px"><h3 class="small">Période ${i + 1}</h3>
        <label class="f" style="flex-direction:row;align-items:center;gap:6px">du<input style="width:76px" id="sf${i}" value="${s.from.slice(3, 5)}/${s.from.slice(0, 2)}" data-ch="sched" data-i="${i}" data-f="from"></label>
        <label class="f" style="flex-direction:row;align-items:center;gap:6px">au<input style="width:76px" id="st${i}" value="${s.to.slice(3, 5)}/${s.to.slice(0, 2)}" data-ch="sched" data-i="${i}" data-f="to"></label></div>
        <div class="ranges">${[0, 1].map((k) => `<div class="rg"><span class="tag">Plage ${k + 1}</span><input type="time" id="r${i}${k}a" value="${r(k)[0]}" data-ch="range" data-i="${i}" data-k="${k}" data-e="0" aria-label="Début plage ${k + 1}"><span aria-hidden="true">–</span><input type="time" id="r${i}${k}b" value="${r(k)[1]}" data-ch="range" data-i="${i}" data-k="${k}" data-e="1" aria-label="Fin plage ${k + 1}"></div>`).join('')}</div></div>`;
    });
    h += `<p class="note">Dates au format JJ/MM. Ces horaires servent à séparer heures pleines et creuses dans chaque demi-heure, au prorata des minutes.</p>
      <label class="row" style="margin-top:12px;gap:8px;align-items:flex-start"><input type="checkbox" data-ch="relayfix" ${S.relayFix === false ? '' : 'checked'} style="margin-top:3px"><span class="small">Charges pilotées par le compteur (chauffe-eau, recharge VE) : dans un créneau à cheval entre heures pleines et creuses, compter en heures creuses toute la charge qui démarre ou s'arrête à la frontière, au lieu de la répartir au prorata des minutes. S'applique à tout l'historique.</span></label>
      <label class="f" style="margin-top:10px;max-width:220px">Décalage appliqué (minutes)<input id="shift" inputmode="decimal" value="${S.shift || 0}" data-ch="shift"></label>`;
    if (cal) {
      const better = cal.best !== (S.shift || 0) && cal.errBest < cal.errNow * 0.85;
      h += better
        ? `<div class="msg">Les index quotidiens collent mieux avec un décalage de ${cal.best} min : écart moyen de ${f2(cal.errBest)} kWh/jour sur les heures pleines, contre ${f2(cal.errNow)} actuellement (${cal.n} jours comparés). <div style="margin-top:8px"><button class="btn" data-act="applycal" data-v="${cal.best}">Appliquer ${cal.best} min</button></div></div>`
        : `<div class="msg">Écart moyen avec les index : ${f2(cal.errNow)} kWh/jour sur les heures pleines (${cal.n} jours comparés).</div>`;
    }
    return h + '</div>';
  }

  function checkCard(m) {
    const rows = [];
    for (const d of m.dates) {
      const st = C.dayStats(S, m.by, d), a = S.idx[d], b = S.idx[C.addDays(d, 1)];
      if (!st || st.src !== '30min' || !a || !b) continue;
      const ih = b.hp - a.hp, ic = b.hc - a.hc;
      rows.push({ d, kwh: st.kwh, ik: ih + ic, e: st.kwh - (ih + ic) });
    }
    if (!rows.length) return '';
    const avg = rows.reduce((s, r) => s + Math.abs(r.e), 0) / rows.length;
    return `<div class="card"><h2>Contrôle avec les index</h2><p class="small muted">Énergie totale calculée depuis les demi-heures, comparée à la différence d'index du jour. Les index sont arrondis au kWh : un écart de 1 kWh est normal.</p>
      <p class="num" style="margin:8px 0">Écart moyen : ${f2(avg)} kWh/jour</p>
      <div class="tscroll"><table class="t num"><thead><tr><th>Jour</th><th>½ h</th><th>Index</th><th>Écart</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${dmy(r.d)}</td><td>${f1(r.kwh)}</td><td>${r.ik}</td><td>${(r.e > 0 ? '+' : '') + f1(r.e)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  /* ---------- équipements ---------- */
  const MODES = { h24: 'En continu (24 h/24)', hc: 'Heures creuses', hp: 'Heures pleines', range: 'Plages répétitives', manual: 'Sans plage fixe' };
  const MODE_SHORT = { h24: '24 h/24', hc: 'Heures creuses', hp: 'Heures pleines', range: 'Plages', manual: 'Sans plage fixe' };
  function rangesOf(e) {
    if (!e.ranges) { e.ranges = C.eqRanges(e).map((r) => ({ from: r.from, to: r.to })); delete e.from; delete e.to; }
    return e.ranges;
  }
  const TPL = {
    frigo: { name: 'Frigo, box et veilles', mode: 'h24' },
    eau: { name: 'Chauffe-eau', mode: 'hc', sure: true },
    ve: { name: 'Chargeur de voiture électrique', mode: 'hc', wmax: 3700 },
    cuisson: { name: 'Cuisson', mode: 'range', rest: true, ranges: [{ from: '11:30', to: '14:00' }, { from: '18:30', to: '21:00' }] },
    menager: { name: 'Électroménager (lave-linge, four…)', mode: 'manual' },
    autre: { name: 'Nouvel équipement', mode: 'manual' },
  };
  const DAYS_ORDER = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
  const eqName = (id) => { const e = S.equip.find((x) => x.id === id); return e ? e.name : '?'; };

  function quickAdd() {
    return `<div class="chips">${Object.entries(TPL).map(([k, t]) => `<button class="chip" data-act="addeq" data-tpl="${k}">+ ${k === 'autre' ? 'Autre équipement' : k === 'cuisson' ? 'Cuisson (prend le reste)' : esc(t.name)}</button>`).join('')}</div>`;
  }

  function splitCard(m) {
    if (!hasData(m)) return '';
    const at = m.at;
    if (!at || !at.slots) return '';
    const rows = S.equip.map((e) => ({ name: e.name, kwh: at.eq[e.id].kwh, eur: at.eq[e.id].eur })).sort((a, b) => b.kwh - a.kwh);
    rows.push({ name: 'Non expliqué', kwh: at.unexplained.kwh, eur: at.unexplained.eur, grey: true });
    const days = Math.round(at.slots / 48);
    const hrs = [];
    for (let hh = 0; hh < 24; hh++) { const a = m.unp[hh * 2].w, b = m.unp[hh * 2 + 1].w; hrs.push({ h: hh, w: (a + b) / 2, hc: C.hcShare(m.p.to, hh * 60, S.schedules, S.shift) >= 0.5 }); }
    const top = hrs.slice().sort((x, y) => y.w - x.w).slice(0, 3).filter((x) => x.w >= 100);
    const unx = `<details class="fold" data-k="unx"${op('unx', true)} style="margin-top:10px"><summary class="foldh small">Non attribué : à quelles heures ?</summary>${powerBars(m.unp, m.p.to, -1, 'Puissance moyenne non attribuée par demi-heure', 'unx')}<div class="legend">${LEG_HPHC}</div>
      <p class="note">Touche une barre pour ouvrir, dans l'onglet Jour, le créneau de cette heure où il reste le plus de conso non expliquée sur la période.</p>
      <p class="note">${top.length ? 'Là où il reste le plus : ' + top.map((x) => `${String(x.h).padStart(2, '0')} h (≈ ${Math.round(x.w)} W, ${x.hc ? 'HC' : 'HP'})`).join(', ') + '. ' : ''}Ajoute un équipement sur ces heures (ou une « puissance variable » comme la cuisson sur ses plages) pour les attribuer.</p></details>`;
    return `<details class="card fold" data-k="split"${op('split', true)}><summary class="foldh"><h2 style="margin:0">Répartition · ${dmy(m.p.from)} → ${dmy(m.p.to)}</h2></summary>${unx}<div class="list" style="margin-top:14px">${rows.map((r) => {
      const pc = at.total.kwh ? (r.kwh / at.total.kwh) * 100 : 0;
      return `<div class="shr"><div class="row between"><span>${esc(r.name)}</span><span class="num">${f1(r.kwh)} kWh · ${eur(r.eur)} · ${Math.round(pc)} %</span></div><div class="bar"><i style="width:${pc.toFixed(1)}%;${r.grey ? 'background:var(--line)' : ''}"></i></div></div>`;
    }).join('')}</div>
      <p class="note">Calculé sur ${days} jour${days > 1 ? 's' : ''} avec détail à la demi-heure. Coût de l'énergie seule, au prix de « ${esc(m.ref.name)} », sans abonnement. Plus tu précises les créneaux et les mesures réelles, plus la part « non expliqué » se réduit.${m.est ? ` Fond permanent estimé : ${Math.round(m.est.floor)} W (moyenne des 10 % de créneaux les plus bas).` : ''}</p></details>`;
  }

  function crossCard(m) {
    const rows = C.crossCheck(S, m.by);
    if (!rows.length) return '';
    const tag = (r) => r.status === 'cohérent' ? '<span class="delta good">cohérent</span>' : r.status === 'écart' ? '<span class="delta bad">écart</span>' : '<span class="delta">hors données EDF</span>';
    return `<details class="card fold" data-k="cross"${op('cross', false)}><summary class="foldh"><h2 style="margin:0">Recoupement chargeur / EDF (${rows.length})</h2></summary><div class="list" style="margin-top:10px">${rows.map((r) => `<div class="item"><span class="small">${dmy(r.win.start.slice(0, 10))} ${r.win.start.slice(11)} → ${r.win.end.slice(11)}${r.exact ? '' : ' · plage large'}<br><span class="muted">chargeur ${f1(r.kwh)} kWh · EDF ${r.status === 'sans données EDF' ? '—' : f1(r.edf) + ' kWh'}${r.restW != null && r.exact ? ' · reste ' + Math.round(r.restW) + ' W' : ''}</span></span>${tag(r)}</div>`).join('')}</div>
      <p class="note">EDF mesure toute la maison : sur une plage, il doit relever au moins les kWh du chargeur. « Reste » est la consommation du reste de la maison pendant la charge. Un écart signale une plage ou une heure mal alignée.</p></details>`;
  }

  function equipForm(e, m) {
    const pw = m.pw[e.id] || { w: 0, src: 'aucune' };
    const days = e.days && e.days.length ? e.days : [0, 1, 2, 3, 4, 5, 6];
    let info;
    if (pw.src === 'variable') {
      const kk = m.at && m.at.eq[e.id] ? m.at.eq[e.id].kwh : null;
      info = 'Puissance variable : à chaque créneau où il est prévu, l\'appli lui attribue ce qui reste une fois déduits le fond (veilles) et les autres équipements. Une plage plus longue ne change donc pas sa valeur.'
        + (kk != null ? ` Sur la période affichée : ${f1(kk)} kWh attribués.` : '')
        + (e.mode === 'manual' ? ' Attention : sans plage, rien ne lui est attribué. Choisis « Plage(s) répétitive(s) » ou coche ses créneaux dans l\'onglet Jour.' : (C.eqRanges(e).length || e.mode !== 'range' ? '' : ' Aucune plage définie.'));
    }
    else if (pw.src === 'mesure') info = `Puissance retenue : ${Math.round(pw.w)} W, d'après tes mesures réelles.`;
    else if (pw.src === 'saisie') info = `Puissance retenue : ${Math.round(pw.w)} W, celle que tu as saisie.`;
    else if (pw.src === 'estimée') {
      info = `Puissance estimée : ${Math.round(pw.w)} W`;
      if (e.mode === 'h24') info += ` (part du fond permanent${pw.shared ? ', partagé entre tes équipements en continu' : ''}).`;
      else {
        info += ` d'après ${pw.nOn} créneaux en route et ${pw.nOff} à l'arrêt${pw.nOn < 10 || pw.nOff < 10 ? ' : estimation peu fiable' : ''}.`;
        if (pw.twins && pw.twins.length) info += ` Même fonctionnement que ${pw.twins.map(eqName).join(', ')} : impossible de les séparer, précise des créneaux ou une mesure.`;
      }
    } else if (pw.src === 'max') info = `Puissance retenue : ${Math.round(pw.w)} W (ta puissance max, en attendant une meilleure estimation).`;
    else info = 'Pas de puissance pour l\'instant : saisis-la, indique une puissance max ou précise des créneaux.';
    if (pw.src === 'estimée' && pw.nAct) info += ` Détecté réellement actif sur ${pw.nAct} créneaux.`;
    info += e.rest ? '' : e.mode === 'manual' ? ' Sans plage fixe : indique les créneaux dans l\'onglet Jour ; l\'appli propose en pointillé ceux qui semblent cohérents (puissance saisie ou max requise).'
      : e.mode === 'h24' ? '' : e.wmax > 0 ? ' Avec une puissance max, la plage dit seulement où il peut tourner : l\'appli ne lui attribue que les créneaux où la mesure le justifie.' : ' Ajoute une puissance max pour que la plage ne soit pas comptée en entier.';
    const meas = (S.eqMeas || []).filter((x) => x.eq === e.id);
    const lastDay = m.dates.length ? m.dates[m.dates.length - 1] : '';
    return `<details class="card fold" data-k="eq-${e.id}" data-eid="${e.id}"${op('eq-' + e.id, false)}>
      <summary class="foldh"><div class="grow"><h3>${esc(e.name)}</h3><div class="row" style="gap:8px;margin-top:3px;flex-wrap:nowrap"><span class="tag">${MODE_SHORT[e.mode] || e.mode}</span><span class="num muted small">${pw.src === 'variable' ? 'variable' : pw.w >= 1 ? Math.round(pw.w) + ' W' : ''}</span></div></div></summary>
      <div class="grid2" style="margin-top:10px">
        <label class="f" style="grid-column:1/-1">Nom<input id="en-${e.id}" value="${esc(e.name)}" data-ch="ename" data-id="${e.id}"></label>
        <label class="f" style="grid-column:1/-1">Fonctionnement<select id="em-${e.id}" data-ch="emode" data-id="${e.id}">${Object.entries(MODES).map(([k, v]) => `<option value="${k}"${e.mode === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        ${e.rest ? '' : `<label class="f">Puissance (W, facultatif)<input id="ew-${e.id}" inputmode="decimal" value="${e.watts > 0 ? e.watts : ''}" placeholder="${pw.w ? Math.round(pw.w) : ''}" data-ch="ewatts" data-id="${e.id}"></label>`}
        ${e.mode !== 'h24' ? `<label class="row" style="grid-column:1/-1;gap:8px;align-items:flex-start"><input type="checkbox" id="er-${e.id}" ${e.rest ? 'checked' : ''} data-ch="erest" data-id="${e.id}" style="margin-top:3px"><span class="small">Puissance variable : prend ce qui reste (cuisson, bricolage…)</span></label>` : ''}
        ${e.rest ? '' : `<label class="row" style="grid-column:1/-1;gap:8px;align-items:flex-start"><input type="checkbox" id="ep-${e.id}" ${e.prio === true || (e.mode === 'h24' && e.prio !== false) ? 'checked' : ''} data-ch="eprio" data-id="${e.id}" style="margin-top:3px"><span class="small">Valeur prioritaire : ma valeur (ou la moyenne estimée) est respectée, les autres équipements s'ajustent autour</span></label>`}
        ${e.mode !== 'h24' ? `<label class="row" style="grid-column:1/-1;gap:8px;align-items:flex-start"><input type="checkbox" id="es-${e.id}" ${e.sure ? 'checked' : ''} data-ch="esure" data-id="${e.id}" style="margin-top:3px"><span class="small">Plage sûre : il tourne vraiment sur sa plage (ex. chauffe-eau). Sinon la plage n'est qu'une tendance, affichée en pointillé dans l'onglet Jour.</span></label>` : ''}
        ${e.mode !== 'h24' && !e.rest ? `<label class="f">Puissance max (W)<input id="ex-${e.id}" inputmode="decimal" value="${e.wmax > 0 ? e.wmax : ''}" placeholder="ex. 3700" data-ch="ewmax" data-id="${e.id}"></label>` : ''}
        ${e.mode === 'range' ? `<div class="ranges" style="grid-column:1/-1">${rangesOf(e).map((r, i) => {
          const rd = r.days && r.days.length ? r.days : days;
          return `<div class="rgblock"><div class="rg"><span class="tag">Plage ${i + 1}</span>${tsel(`id="rf-${e.id}-${i}" data-ch="rfrom" data-id="${e.id}" data-i="${i}" aria-label="Début plage ${i + 1}"`, r.from, 15)}${tsel(`id="rt-${e.id}-${i}" data-ch="rto" data-id="${e.id}" data-i="${i}" aria-label="Fin plage ${i + 1}"`, r.to, 15, false, true)}<button class="iconbtn" style="width:34px;height:34px;font-size:15px;flex:none" data-act="delrange" data-id="${e.id}" data-i="${i}" aria-label="Supprimer la plage ${i + 1}">×</button></div>
          <div class="row" style="gap:6px;margin-top:6px" role="group" aria-label="Jours de la plage ${i + 1}">${DAYS_ORDER.map(([d, l]) => `<label class="dchip"><input type="checkbox" id="rd-${e.id}-${i}-${d}" ${rd.includes(d) ? 'checked' : ''} data-ch="rday" data-id="${e.id}" data-i="${i}" data-d="${d}"><span>${l}</span></label>`).join('')}</div></div>`;
        }).join('')}<div><button class="btn ghost" data-act="addrange" data-id="${e.id}">+ Ajouter une plage</button></div></div>` : ''}
      </div>
      <p class="note">${info}</p>
      ${(pw.src === 'estimée' || pw.src === 'max') && pw.w >= 1 ? `<div class="row" style="margin-top:8px"><button class="btn ghost" data-act="usew" data-id="${e.id}" data-w="${Math.round(pw.w)}">Fixer à ${Math.round(pw.w)} W</button></div>` : ''}
      <details style="margin-top:12px" data-k="ms-${e.id}"${op('ms-' + e.id, false)}><summary class="foldh small">Mesures réelles (${meas.length})</summary>
        <p class="note" style="margin-top:6px">Par exemple l'énergie affichée par ton chargeur pour une recharge. Avec les heures, les créneaux sont cochés. Sans heures (plage trop longue pour être fiable), les kWh sont notés et l'appli propose en pointillé, dans l'onglet Jour, les créneaux les plus cohérents.</p>
        ${meas.length ? `<details style="margin-top:6px" data-k="ml-${e.id}"${op('ml-' + e.id, false)}><summary class="foldh small">Détail des ${meas.length} mesures</summary>${meas.map((x) => `<div class="eqrow"><span class="grow num small">${x.from && x.to ? `${dmy(x.date)} ${x.from}–${x.to} · ${f1(x.kwh)} kWh · ${Math.round((x.kwh * 1000) / C.hoursBetween(x.from, x.to))} W` : `${x.win ? `${dmy(x.win.start.slice(0, 10))} ${x.win.start.slice(11)} → ${dmy(x.win.end.slice(0, 10))} ${x.win.end.slice(11)} · plage trop longue` : dmy(x.date) + ' sans heures'} · ${f1(x.kwh)} kWh`}</span><button class="iconbtn" style="width:34px;height:34px;font-size:15px" data-act="delmeas" data-id="${x.id}" aria-label="Supprimer cette mesure">×</button></div>`).join('')}</details>` : ''}
        <div class="grid2" style="margin-top:8px"><label class="f">Jour<input type="date" id="md-${e.id}" value="${ui.day || lastDay}"></label><label class="f">Énergie (kWh)<input id="mk-${e.id}" inputmode="decimal" placeholder="22"></label>
        <label class="f">De (facultatif)${tsel(`id="mf-${e.id}"`, '', 5, true)}</label><label class="f">À (facultatif)${tsel(`id="mt-${e.id}"`, '', 5, true, true)}</label></div>
        <div class="row" style="margin-top:8px"><button class="btn" data-act="addmeas" data-id="${e.id}">Ajouter la mesure</button></div></details>
      <div class="row" style="margin-top:12px">${ui.confirmEq === e.id ? `<button class="btn danger" data-act="deleq" data-id="${e.id}">Confirmer la suppression</button><button class="btn ghost" data-act="keepeq">Annuler</button>` : `<button class="btn danger" data-act="askdeleq" data-id="${e.id}">Supprimer</button>`}</div></details>`;
  }

  function viewEquip(m) {
    let h = hasData(m) && m.p ? periodBar(m) : header();
    if (ui.eqMsg) h += `<div class="msg" style="margin:0 0 12px">${esc(ui.eqMsg)}</div>`;
    if (!S.equip.length) {
      return h + `<div class="card"><h3>Liste tes équipements</h3><p class="muted" style="margin-top:6px">Pour chacun, indique s'il tourne en continu, en heures creuses, en heures pleines ou sur une plage horaire. Dans l'onglet Jour, tu cocheras ensuite ceux qui étaient en route à chaque demi-heure, et l'appli en déduit leur puissance.</p><div style="margin-top:12px">${quickAdd()}</div></div>`;
    }
    h += splitCard(m);
    h += crossCard(m);
    h += S.equip.map((e) => equipForm(e, m)).join('');
    return h + `<div class="card"><h2>Ajouter</h2>${quickAdd()}</div>`;
  }

  /* ---------- rendu ---------- */
  function render() {
    const m = model();
    const root = document.getElementById('app');
    const views = { tableau: viewDash, jour: viewDay, equipements: viewEquip, contrats: viewContracts, donnees: viewData };
    const scroll = window.scrollY;
    root.innerHTML = (views[ui.tab] || viewDash)(m);
    document.getElementById('tabs').innerHTML = TABS.map((t) =>
      `<button data-act="tab" data-tab="${t.id}" ${t.id === ui.tab ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg>${t.label}${t.id === 'donnees' && syncDirty() ? '<i class="tabdot" title="Modifications non envoyées sur le Drive"></i>' : ''}</button>`).join('');
    window.scrollTo(0, scroll);
  }
  /* ---------- synchronisation Google Drive (espace caché de l'appli) ---------- */
  const GCLIENT = '163280160875-e3ml082aeieji23312rj1cad07u87fcv.apps.googleusercontent.com';
  const GSCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const DFILE = 'conso-donnees.json';
  const SYKEY = 'conso-sync-v1';
  const sync = { busy: false, msg: '', conflict: null, tok: '', exp: 0 };
  const syncInfo = () => { try { return JSON.parse(localStorage.getItem(SYKEY)) || {}; } catch (e) { return {}; } };
  const devName = () => { try { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'téléphone' : 'PC'; } catch (e) { return 'appareil'; } };
  const setSyncInfo = (o) => { try { localStorage.setItem(SYKEY, JSON.stringify(Object.assign(syncInfo(), o))); } catch (e) { /* ignoré */ } };
  const hashStr = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h + ':' + s.length; };
  const fmtDT = (v) => { try { return new Date(v).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return String(v || ''); } };
  function allData(noSave) {
    if (!noSave) save();
    const data = {};
    for (const s of sites.list) { try { const r = localStorage.getItem(siteKey(s.id)); data[s.id] = r ? JSON.parse(r) : null; } catch (e) { data[s.id] = null; } }
    return { sites: JSON.parse(JSON.stringify(sites)), data };
  }
  const coreStr = (noSave) => JSON.stringify(allData(noSave));
  let dirtyAt = 0, dirtyV = false;
  function syncDirty() {
    if (Date.now() - dirtyAt < 2000) return dirtyV;
    dirtyAt = Date.now();
    try { dirtyV = !!syncInfo().at && hashStr(coreStr(true)) !== syncInfo().hash; } catch (e) { dirtyV = false; }
    return dirtyV;
  }
  function localEmpty() {
    return Object.values(allData().data).every((d) => !d || (!Object.keys(d.slots || {}).length && !Object.keys(d.idx || {}).length && !(d.equip || []).length));
  }
  function applyPayload(p) {
    try { localStorage.setItem('conso-before-sync', JSON.stringify(allData())); } catch (e) { /* trop gros : on continue */ }
    for (const s of p.sites.list) if (p.data[s.id]) localStorage.setItem(siteKey(s.id), JSON.stringify(p.data[s.id]));
    sites = p.sites; if (!sites.list.some((x) => x.id === sites.cur)) sites.cur = sites.list[0].id;
    saveSites(); S = load();
    Object.assign(ui, { preset: 'all', from: '', to: '', day: '', sel: null, backup: '', eqMsg: '', confirmEq: '', siteDel: 0, siteTyped: '' });
  }
  function loadGsi() {
    return new Promise((res, rej) => {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => res(); s.onerror = () => rej(new Error('offline')); document.head.appendChild(s);
    });
  }
  function gToken() {
    if (sync.tok && Date.now() < sync.exp) return Promise.resolve(sync.tok);
    return new Promise((resolve, reject) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: GCLIENT, scope: GSCOPE,
        callback: (r) => { if (r && r.access_token) { sync.tok = r.access_token; sync.exp = Date.now() + ((r.expires_in || 3600) - 120) * 1000; resolve(sync.tok); } else reject(new Error((r && r.error) || 'auth')); },
        error_callback: (e) => reject(new Error((e && e.type) || 'auth')),
      });
      tc.requestAccessToken({ prompt: '' });
    });
  }
  /* Lecture du Drive (v31) : autorisation demandée seulement quand on touche « Récupérer… ». */
  const RSCOPE = 'https://www.googleapis.com/auth/drive.readonly';
  function gTokenRead() {
    if (sync.rtok && Date.now() < sync.rexp) return Promise.resolve(sync.rtok);
    return new Promise((resolve, reject) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: GCLIENT, scope: RSCOPE,
        callback: (r) => { if (r && r.access_token) { sync.rtok = r.access_token; sync.rexp = Date.now() + ((r.expires_in || 3600) - 120) * 1000; resolve(sync.rtok); } else reject(new Error((r && (r.error_description || r.error)) || 'auth')); },
        error_callback: (e) => reject(new Error((e && e.type) || 'auth')),
      });
      tc.requestAccessToken({ prompt: '' });
    });
  }
  async function importFromDrive() {
    if (sync.rbusy) return;
    sync.rbusy = true; ui.msg = 'Connexion à Google…'; render();
    try {
      await loadGsi(); const tok = await gTokenRead();
      ui.msg = 'Recherche du fichier sur le Drive…'; render();
      const q = "name='conso-enedis.json' and trashed=false";
      const r = await dFetch(tok, 'https://www.googleapis.com/drive/v3/files?pageSize=1&orderBy=' + encodeURIComponent('modifiedTime desc') + '&fields=files(id,name,modifiedTime)&q=' + encodeURIComponent(q));
      const j = await r.json(); const f = (j.files || [])[0];
      if (!f) ui.msg = 'Aucun fichier conso-enedis.json trouvé sur ton Drive. Vérifie que le script du PC l\'a bien copié dans le dossier « Conso » et que Google Drive pour ordinateur a fini de se synchroniser.';
      else {
        const buf = await (await dFetch(tok, 'https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media')).arrayBuffer();
        await importFiles([{ name: 'conso-enedis.json (Drive, modifié le ' + fmtDT(f.modifiedTime) + ')', __buf: buf }]);
      }
    } catch (e) {
      const m = String((e && e.message) || e);
      ui.msg = /invalid_scope|admin_policy|access_denied|scope/i.test(m) ? 'Google n\'a pas accordé la lecture du Drive (' + m + '). Si c\'est la première fois, l\'autorisation « lecture du Drive » n\'est peut-être pas encore ajoutée dans le projet Google Cloud.' : syncErr(e);
    }
    sync.rbusy = false; render();
  }
  async function dFetch(tok, url, opt) {
    const r = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ Authorization: 'Bearer ' + tok }, (opt && opt.headers) || {}) }));
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('drive ' + r.status + ' ' + t.slice(0, 160)); }
    return r;
  }
  async function dFind(tok) {
    const r = await dFetch(tok, 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,modifiedTime)&orderBy=' + encodeURIComponent('modifiedTime desc') + '&q=' + encodeURIComponent("name='" + DFILE + "'"));
    const j = await r.json(); const arr = j.files || [];
    if (!arr.length) return null;
    arr[0].count = arr.length; return arr[0];
  }
  async function dPut(tok, id, body) {
    if (id) { const r = await dFetch(tok, 'https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media&fields=id,modifiedTime', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }); return r.json(); }
    const b = 'conso' + Date.now();
    const mp = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: DFILE, parents: ['appDataFolder'] }) + '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + b + '--';
    const r = await dFetch(tok, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: mp });
    return r.json();
  }
  function syncErr(e) {
    const m = String((e && e.message) || e);
    if (m === 'offline' || /Failed to fetch|NetworkError/i.test(m)) return 'Pas de connexion : réessaie quand le téléphone est en ligne.';
    if (/popup_closed|popup_failed/.test(m)) return 'La fenêtre Google a été fermée avant la fin.';
    if (/access_denied/.test(m)) return 'Autorisation refusée.';
    if (/drive 403/.test(m)) return 'Google refuse l\'accès : vérifie que « Google Drive API » est activée dans le projet Google Cloud. (' + m + ')';
    if (/drive 401/.test(m)) { sync.tok = ''; return 'La connexion Google a expiré : touche de nouveau « Synchroniser ».'; }
    return 'Échec de la synchronisation : ' + m;
  }
  async function doSync(mode) {
    if (sync.busy) return;
    sync.busy = true; sync.msg = 'Connexion à Google…'; sync.conflict = null; render();
    try {
      await loadGsi(); const tok = await gToken();
      sync.msg = 'Lecture du Drive…'; render();
      const f = await dFind(tok), info = syncInfo();
      const h = hashStr(coreStr()), localChanged = h !== info.hash && !localEmpty();
      const up = async () => {
        sync.msg = 'Envoi vers le Drive…'; render();
        const body = JSON.stringify(Object.assign({ v: 2, savedAt: new Date().toISOString(), device: devName() }, allData()));
        const res = await dPut(tok, f ? f.id : null, body);
        setSyncInfo({ hash: h, remote: res.modifiedTime, at: Date.now(), by: devName() });
        sync.msg = 'Données envoyées sur le Drive (' + fmtDT(Date.now()) + ').';
      };
      const down = async () => {
        if (!f) { sync.msg = 'Aucune sauvegarde sur le Drive pour l\'instant.'; return; }
        sync.msg = 'Récupération depuis le Drive…'; render();
        const p = await (await dFetch(tok, 'https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media')).json();
        if (!p || p.v !== 2 || !p.sites || !p.data) throw new Error('fichier du Drive illisible');
        applyPayload(p);
        setSyncInfo({ hash: hashStr(coreStr()), remote: f.modifiedTime, at: Date.now(), by: p.device || 'un autre appareil' });
        sync.msg = 'Données récupérées depuis le Drive (sauvegarde du Drive du ' + fmtDT(p.savedAt || f.modifiedTime) + ').';
      };
      if (mode === 'up') await up();
      else if (mode === 'down') await down();
      else if (!f) { if (localEmpty()) sync.msg = 'Rien à synchroniser : aucune donnée ici ni sur le Drive.'; else await up(); }
      else {
        const remoteChanged = f.modifiedTime !== info.remote;
        if (!remoteChanged && !localChanged) sync.msg = 'Déjà à jour : le Drive (modifié le ' + fmtDT(f.modifiedTime) + (info.by ? ', envoyé depuis ' + (info.by === 'téléphone' ? 'le téléphone' : info.by === 'PC' ? 'le PC' : info.by) : '') + ') est identique à cet appareil.';
        else if (!remoteChanged) await up();
        else if (!localChanged) await down();
        else {
          /* Les deux côtés ont changé : on fusionne les deux versions (voir core.mergeSites), puis on envoie le résultat. */
          try {
            sync.msg = 'Fusion des deux versions…'; render();
            const p = await (await dFetch(tok, 'https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media')).json();
            if (!p || p.v !== 2 || !p.sites || !p.data) throw new Error('fichier du Drive illisible');
            const le = Number(localStorage.getItem('conso-lastedit')) || Date.now();
            const m = C.mergeSites(allData(), p, le > Date.parse(f.modifiedTime));
            applyPayload(m);
            const body = JSON.stringify(Object.assign({ v: 2, savedAt: new Date().toISOString(), device: devName() }, allData()));
            const res = await dPut(tok, f.id, body);
            setSyncInfo({ hash: hashStr(coreStr()), remote: res.modifiedTime, at: Date.now(), by: devName() });
            sync.msg = 'Les modifications faites ici et sur le Drive ont été fusionnées (' + fmtDT(Date.now()) + ') : cet appareil et le Drive sont maintenant identiques.';
          } catch (e2) { sync.conflict = { remote: f.modifiedTime }; sync.msg = ''; }
        }
      }
      if (sync.conflict) sync.msg = '';
      else if (f && f.count > 1) sync.msg += ' Attention : ' + f.count + ' fichiers de sauvegarde trouvés sur le Drive, le plus récent est utilisé.';
    } catch (e) { sync.msg = syncErr(e); }
    sync.busy = false; render();
  }
  function syncCard() {
    const info = syncInfo();
    let changed = false;
    try { changed = hashStr(coreStr(true)) !== info.hash && !localEmpty(); } catch (e) { /* ignoré */ }
    return `<div class="card"><h2>Synchronisation Google Drive</h2>
      <p class="small muted">Sauvegarde automatique de toutes tes données dans un espace caché de ton Drive, visible seulement par cette appli. Utilise le même compte Google sur ton téléphone et sur ton PC.</p>
      <p class="small" style="margin-top:8px">${info.at ? 'Dernière synchronisation de cet appareil (' + devName() + ') : ' + fmtDT(info.at) + (changed ? ' · <b>modifications pas encore envoyées</b>' : '') : 'Jamais synchronisé sur cet appareil.'}</p>
      ${info.at && info.by ? '<p class="small muted" style="margin-top:4px">Drive à cette dernière synchronisation : envoyé depuis ' + (info.by === devName() ? 'cet appareil (' + devName() + ')' : (info.by === 'téléphone' ? 'le téléphone' : info.by === 'PC' ? 'le PC' : info.by)) + (info.remote ? ', le ' + fmtDT(info.remote) : '') + '. Cette indication date de la dernière synchronisation : touche Synchroniser pour voir l\'état actuel du Drive.</p>' : ''}
      <div class="row" style="margin-top:10px"><button class="btn" data-act="sync"${sync.busy ? ' disabled' : ''}>${sync.busy ? 'Synchronisation…' : 'Synchroniser'}</button></div>
      ${sync.msg ? `<div class="msg" style="margin-top:10px">${esc(sync.msg)}</div>` : ''}
      ${sync.conflict ? `<div class="warn" style="margin-top:10px">Les données ont changé à la fois ici et sur le Drive (sauvegarde du Drive : ${fmtDT(sync.conflict.remote)}). Choisis celles à garder : l'autre version sera remplacée. Avant un remplacement ici, une copie de sécurité est gardée sur ce téléphone.<div class="row" style="margin-top:10px;gap:8px"><button class="btn" data-act="syncdown">Garder le Drive</button><button class="btn ghost" data-act="syncup">Garder ce téléphone</button></div></div>` : ''}
      <label class="row" style="margin-top:12px;gap:8px;align-items:flex-start"><input type="checkbox" data-ch="autosync" ${prefs().autoSync ? 'checked' : ''} style="margin-top:3px"><span class="small">Synchroniser à la première touche après l'ouverture de l'appli, si des modifications n'ont pas été envoyées ou après plusieurs heures. Une fenêtre Google s'ouvre alors brièvement.</span></label>
      <details style="margin-top:12px"><summary class="small">Forcer un sens</summary><div class="row" style="margin-top:8px;gap:8px"><button class="btn ghost" data-act="syncup"${sync.busy ? ' disabled' : ''}>Envoyer ce téléphone vers le Drive</button><button class="btn ghost" data-act="syncdown"${sync.busy ? ' disabled' : ''}>Récupérer depuis le Drive</button></div></details></div>`;
  }

  function go(tab) {
    ui.tab = tab; ui.sel = null; ui.eqMsg = ''; ui.confirmEq = ''; ui.siteDel = 0; ui.siteTyped = '';
    try { if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab); } catch (e) { /* ignoré */ }
    render(); window.scrollTo(0, 0);
  }

  /* ---------- import ---------- */
  function readFile(f) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = () => rej(new Error('lecture impossible'));
      r.readAsArrayBuffer(f);
    });
  }
  const describe = (name, p) => ({
    power: `${name} : ${p.count} créneaux à la demi-heure${p.estimated ? ` (dont ${p.estimated} estimés)` : ''}.`,
    index: `${name} : ${p.count} relevés d'index${p.stale ? ` (${p.stale} relevé identique à la veille ignoré)` : ''}.`,
    pmax: `${name} : ${p.count} jours de puissance max.`,
    enedis: `${name} : données Enedis : ${p.count} créneaux, ${p.nIdx} index, ${p.nPmax} jours de puissance max.`,
    daily: `${name} : consommation quotidienne, déjà couverte par les index (ignorée).`,
    monthly: `${name} : consommation mensuelle, déjà couverte par les index (ignorée).`,
  }[p.type]);
  async function importBuffer(name, buf, lines) {
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0x50 && u8[1] === 0x4b) {
      const files = (await C.parseZip(buf)).filter((f) => /\.csv$/i.test(f.name) && !/__MACOSX/.test(f.name));
      if (!files.length) throw new Error('aucun fichier CSV dans le zip');
      lines.push(`${name} : ${files.length} fichiers CSV.`);
      for (const f of files) await importBuffer(f.name.split('/').pop(), f.bytes, lines);
      return;
    }
    const p = C.parseCsv(C.decode(buf));
    C.mergeImport(S, p);
    lines.push(describe(name, p));
  }
  const shortName = (n) => n.replace(/-\d{6,}(-\d+)?(?=\.)/, '');

  /* Lit une archive zip (méthodes « stockée » et « deflate »), sans bibliothèque. */
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let e = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    }
    if (e < 0) throw new Error('archive zip illisible');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const out = [];
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'windows-1252').decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (name.endsWith('/') || name.includes('__MACOSX/') || /(^|\/)\.[^/]*$/.test(name)) continue;
      if (flags & 1) { out.push({ name, error: 'protégé par mot de passe' }); continue; }
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const raw = u8.subarray(start, start + csize);
      if (method === 0) out.push({ name, data: raw.slice().buffer });
      else if (method === 8 && typeof DecompressionStream !== 'undefined') {
        const res = new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
        out.push({ name, data: await res.arrayBuffer() });
      } else out.push({ name, error: 'compression non prise en charge' });
    }
    return out;
  }

  async function importFiles(files) {
    const rep = [];
    ui.msg = 'Lecture de ' + files.map((f) => shortName(f.name)).join(', ') + '…'; render();
    const take = (name, buf) => {
      const nm = shortName(name);
      try {
        const p = C.parseCsv(C.decode(buf));
        if (p.type === 've') {
          if (ui.cat === 'edf') { rep.push(`${nm} : export de chargeur ignoré (catégorie EDF choisie).`); return; }
          let e = (ui.veEq && S.equip.find((x) => x.id === ui.veEq)) || S.equip.find((x) => /\bve\b|voiture|v[ée]hicule|charg/i.test(x.name)) || S.equip.find((x) => x.wmax >= 1500);
          if (!e) { e = { id: 'e' + Date.now().toString(36), name: 'Chargeur de voiture électrique', mode: 'hc', wmax: 3700 }; S.equip.push(e); }
          const r = C.importVe(S, p, e.id, ui.force);
          rep.push(`${nm} : ${p.count} recharges pour « ${e.name} » : ${r.exact} à plage fiable (créneaux cochés), ${r.loose} sur une plage trop longue (kWh notés, créneaux proposés en pointillé).`);
          return;
        }
        if (ui.cat === 've') { rep.push(`${nm} : ce n'est pas un export de recharge VE.`); return; }
        if (p.type === 'info') { rep.push(`${nm} : ${p.label}, déjà couverte par les autres fichiers.`); return; }
        C.mergeImport(S, p);
        if (p.type === 'enedis') rep.push(`${nm} : données Enedis : ${p.count} créneaux à la demi-heure, ${p.nIdx} relevés d'index, ${p.nPmax} jours de puissance max.`);
        else if (p.type === 'power') rep.push(`${nm} : ${p.count} créneaux à la demi-heure${p.estimated ? ` (dont ${p.estimated} estimés)` : ''}.`);
        else if (p.type === 'index') rep.push(`${nm} : ${p.count} relevés d'index${p.stale ? ` (${p.stale} relevé identique à la veille ignoré)` : ''}.`);
        else rep.push(`${nm} : ${p.count} jours de puissance max.`);
      } catch (e) { rep.push(`${nm} : ignoré (${e.message}).`); }
    };
    for (const f of files) {
      try {
        const buf = f.__buf || await readFile(f);
        const u = new Uint8Array(buf, 0, 2);
        if (u[0] === 0x50 && u[1] === 0x4b) {
          const ents = await unzip(buf);
          if (!ents.length) rep.push(`${f.name} : archive vide.`);
          for (const en of ents) { if (en.error) rep.push(`${shortName(en.name)} : ${en.error}.`); else take(en.name, en.data); }
        } else take(f.name, buf);
      } catch (e) { rep.push(`${f.name} : ${e.message}.`); }
    }
    ui.msg = rep.length ? rep.join(' ') : 'Aucun fichier lu.'; ui.force = false; save(); render();
    const mb = document.querySelector('#app .msg'); if (mb && mb.scrollIntoView) mb.scrollIntoView({ block: 'center' });
  }
  /* Import d'un texte collé : repli quand le sélecteur de fichiers du navigateur ne répond pas. */
  async function importText(txt) {
    const f = { name: 'texte collé.csv', size: txt.length, text: txt };
    ui.msg = 'Lecture du texte collé…'; render();
    const buf = new TextEncoder().encode(txt).buffer;
    await importFiles([{ name: f.name, __buf: buf }]);
  }

  /* ---------- actions ---------- */
  function setContract(id, fn) { const c = S.contracts.find((x) => x.id === id); if (c) { fn(c); save(); render(); } }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act;
    if (a === 'tab') go(el.dataset.tab);
    else if (a === 'gran') { ui.gran = el.dataset.v; ui.bsel = null; render(); }
    else if (a === 'bucket') { ui.bsel = ui.bsel === el.dataset.k ? null : el.dataset.k; render(); }
    else if (a === 'preset') { ui.bsel = null; ui.preset = el.dataset.v; if (ui.preset === 'custom' && !ui.from) { const m = model(); if (m.p) { ui.from = m.p.from; ui.to = m.p.to; } } render(); }
    else if (a === 'goday') { ui.day = el.dataset.date; ui.sel = null; go('jour'); }
    else if (a === 'dayprev' || a === 'daynext') { const m = model(), i = m.dates.indexOf(ui.day) + (a === 'dayprev' ? -1 : 1); if (m.dates.length) { const nd = C.addDays(ui.day, a === 'dayprev' ? -1 : 1), top = todayIso() > m.dates[m.dates.length - 1] ? todayIso() : m.dates[m.dates.length - 1]; if (nd >= m.dates[0] && nd <= top) { ui.day = nd; ui.sel = null; render(); } } }
    else if (a === 'unxgo') {
      const m = model(), h = Math.floor(Number(el.dataset.i) / 2);
      if (m.p) {
        let best = null;
        for (const r of C.slotRows(S, m.by, m.p.from, m.p.to)) {
          if (Math.floor(r.min / 60) !== h) continue;
          const u = C.splitSlot(S, r, m.pw).unexplained;
          if (!best || u > best.u) best = { u, r };
        }
        if (best) { const ix = m.by[best.r.date].findIndex((x) => x.key === best.r.key); ui.day = best.r.date; go('jour'); ui.sel = ix < 0 ? null : ix; render(); window.scrollTo(0, 0); }
      }
    }
    else if (a === 'slot') { ui.sel = Number(el.dataset.i); render(); }
    else if (a === 'force') {
      const v = parseNum(document.getElementById('forcew').value);
      if (v !== null && v >= 0) { S.over[el.dataset.key] = Math.round(v); save(); render(); }
    } else if (a === 'unforce') { delete S.over[el.dataset.key]; save(); render(); }
    else if (a === 'setref') { S.contracts.forEach((c) => { c.ref = c.id === el.dataset.id; }); save(); render(); }
    else if (a === 'delc') { S.contracts = S.contracts.filter((c) => c.id !== el.dataset.id); if (!S.contracts.some((c) => c.ref)) S.contracts[0].ref = true; save(); render(); }
    else if (a === 'addc') {
      const r = S.contracts.find((c) => c.ref) || S.contracts[0];
      S.contracts.push({ id: 'c' + Date.now().toString(36), name: 'Contrat à comparer', type: 'hphc', abo: r.abo, hp: r.hp, hc: r.hc, base: 0.2, weekendHC: false, ref: false });
      save(); render();
    }
    else if (a === 'addeq') {
      const t = TPL[el.dataset.tpl] && JSON.parse(JSON.stringify(TPL[el.dataset.tpl]));
      if (t) { const ne = Object.assign({ id: 'e' + Date.now().toString(36) + Math.floor(Math.random() * 99) }, t); S.equip.push(ne); ui.open['eq-' + ne.id] = true; ui.eqMsg = ''; save(); render(); }
    }
    else if (a === 'askdeleq') { ui.confirmEq = el.dataset.id; render(); }
    else if (a === 'keepeq') { ui.confirmEq = ''; render(); }
    else if (a === 'deleq') {
      const id = el.dataset.id;
      S.equip = S.equip.filter((x) => x.id !== id); S.eqMeas = (S.eqMeas || []).filter((x) => x.eq !== id);
      for (const k of Object.keys(S.eqLock || {})) C.setLock(S, id, k, false);
      for (const k of Object.keys(S.eqOver)) { delete S.eqOver[k][id]; if (!Object.keys(S.eqOver[k]).length) delete S.eqOver[k]; }
      ui.confirmEq = ''; save(); render();
    }
    else if (a === 'usew') { const e = S.equip.find((x) => x.id === el.dataset.id); if (e) { e.watts = Number(el.dataset.w); save(); render(); } }
    else if (a === 'delmeas') { S.eqMeas = (S.eqMeas || []).filter((x) => x.id !== el.dataset.id); save(); render(); }
    else if (a === 'addmeas') {
      const id = el.dataset.id, e = S.equip.find((x) => x.id === id);
      const date = document.getElementById('md-' + id).value, from = document.getElementById('mf-' + id).value, to = document.getElementById('mt-' + id).value;
      const kwh = parseNum(document.getElementById('mk-' + id).value);
      if (!e || !date || !(kwh > 0) || !!from !== !!to || (from && from === to)) { ui.eqMsg = 'Mesure incomplète : renseigne le jour et l\'énergie en kWh, et soit les deux heures, soit aucune.'; render(); return; }
      S.eqMeas = S.eqMeas || [];
      S.eqMeas.push({ id: 'm' + Date.now().toString(36), eq: id, date, from: from || '', to: to || '', kwh, win: from ? C.spanOf(date, from, to) : null });
      if (!from) { ui.eqMsg = 'Mesure sans heures enregistrée : les créneaux cohérents apparaissent en pointillé dans l\'onglet Jour.'; save(); render(); return; }
      const keys = C.spanKeys(C.spanOf(date, from, to));
      for (const key of keys) { C.setEqOn(S, e, key, C.hcShare(key.slice(0, 10), C.hm(key.slice(11, 16)), S.schedules, S.shift), true, true); C.setLock(S, id, key, true); }
      const n = keys.length;
      ui.eqMsg = `Mesure ajoutée${n ? ` : ${n} créneaux cochés pour « ${e.name} ».` : ' (aucun créneau ce jour-là dans tes données).'}`;
      save(); render();
    }
    else if (a === 'assign') {
      const m = model(), from = document.getElementById('asf').value, to = document.getElementById('ast').value, scope = document.getElementById('asscope').value;
      const ids = [...document.querySelectorAll('.aseq:checked')].map((x) => x.dataset.id);
      if (!from || !to || from === to || !ids.length) { ui.eqMsg = 'Choisis une plage horaire et au moins un équipement.'; render(); return; }
      const a0 = C.hm(from), b0 = C.hm(to);
      const dates = scope === 'day' ? [ui.day] : m.dates.filter((d) => m.p && d >= m.p.from && d <= m.p.to && (scope === 'all' || (scope === 'wk') === (C.dow(d) >= 1 && C.dow(d) <= 5)));
      let n = 0;
      const z2 = (n) => String(n).padStart(2, '0');
      const slotsOf = (d) => (m.by[d] && m.by[d].length ? m.by[d] : Array.from({ length: 48 }, (_, q) => ({ key: d + ' ' + z2(Math.floor(q / 2)) + ':' + (q % 2 ? '30' : '00'), min: q * 30 })));
      for (const d of dates) for (const s2 of slotsOf(d)) {
        if (!(a0 <= b0 ? s2.min >= a0 && s2.min < b0 : s2.min >= a0 || s2.min < b0)) continue;
        const sh = C.hcShare(d, s2.min, S.schedules, S.shift);
        for (const id of ids) { const e = S.equip.find((x) => x.id === id); if (e) { C.setEqOn(S, e, s2.key, sh, el.dataset.v === 'on' ? true : el.dataset.v === 'off' ? false : C.eqRuleOn(e, d, s2.min, sh), el.dataset.v !== 'rule'); C.setLock(S, id, s2.key, el.dataset.v !== 'rule'); } }
        n++;
      }
      ui.eqMsg = `${n} créneau${n > 1 ? 'x' : ''} mis à jour pour ${ids.length} équipement${ids.length > 1 ? 's' : ''}.`;
      save(); render();
    }
    else if (a === 'eqtap') {
      const e = S.equip.find((x) => x.id === el.dataset.eq), key = el.dataset.key;
      if (e) {
        const sh = C.hcShare(key.slice(0, 10), C.hm(key.slice(11, 16)), S.schedules, S.shift);
        if (el.dataset.st === 'on') C.setEqOn(S, e, key, sh, false, true); else C.setEqOn(S, e, key, sh, true, true);
        C.setLock(S, e.id, key, true);
        save(); render();
      }
    }
    else if (a === 'eqlock') { C.setLock(S, el.dataset.eq, el.dataset.key, false); save(); render(); }
    else if (a === 'addrange') { const e = S.equip.find((x) => x.id === el.dataset.id); if (e) { { const rs = rangesOf(e), last = rs[rs.length - 1]; rs.push({ from: '12:00', to: '14:00', days: last && last.days ? last.days.slice() : e.days && e.days.length ? e.days.slice() : [0, 1, 2, 3, 4, 5, 6] }); } save(); render(); } }
    else if (a === 'delrange') { const e = S.equip.find((x) => x.id === el.dataset.id); if (e) { const r = rangesOf(e); r.splice(Number(el.dataset.i), 1); if (!r.length) r.push({ from: '18:00', to: '22:00' }); save(); render(); } }
    else if (a === 'pastecsv') {
      const t = document.getElementById('pastecsv').value;
      if (t.trim().length < 20) { ui.msg = 'Colle d\'abord le contenu du fichier CSV.'; render(); return; }
      importText(t);
    }
    else if (a === 'opensite') { switchSite(el.dataset.id); render(); }
    else if (a === 'addsite') {
      const name = document.getElementById('newsite').value.trim();
      if (!name) { ui.msg = 'Donne un nom au nouveau site.'; render(); return; }
      save();
      const id = 's' + Date.now().toString(36);
      sites.list.push({ id, name }); sites.cur = id; saveSites();
      S = C.defaultState(); save();
      Object.assign(ui, { preset: 'all', from: '', to: '', day: '', sel: null, backup: '', eqMsg: '', confirmEq: '', siteDel: 0, siteTyped: '', msg: 'Site « ' + name + ' » créé. Importe maintenant ses fichiers.' });
      render();
    }
    else if (a === 'sitedel1') { ui.siteDel = 1; render(); }
    else if (a === 'sitedel2') { ui.siteDel = 2; ui.siteTyped = ''; render(); }
    else if (a === 'sitedel0') { ui.siteDel = 0; ui.siteTyped = ''; render(); }
    else if (a === 'sitedel3') {
      const cur = curSite();
      if (sites.list.length < 2 || ui.siteTyped !== cur.name) return;
      try { localStorage.removeItem(siteKey(cur.id)); } catch (e) { /* ignoré */ }
      sites.list = sites.list.filter((x) => x.id !== cur.id); sites.cur = sites.list[0].id; saveSites();
      S = load();
      Object.assign(ui, { preset: 'all', from: '', to: '', day: '', sel: null, backup: '', eqMsg: '', confirmEq: '', siteDel: 0, siteTyped: '', msg: 'Site « ' + cur.name + ' » supprimé.' });
      render();
    }
    else if (a === 'applycal') { S.shift = Number(el.dataset.v); save(); render(); }
    else if (a === 'drvenedis') importFromDrive();
    else if (a === 'sync') doSync('auto');
    else if (a === 'syncup') doSync('up');
    else if (a === 'syncdown') doSync('down');
    else if (a === 'mkbackup') { ui.backup = JSON.stringify(S); render(); }
    else if (a === 'copybk') {
      const ta = document.getElementById('bk');
      const done = () => { ui.msg = ''; el.textContent = 'Copié'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ui.backup).then(done, () => { ta.select(); });
      else ta.select();
    }
    else if (a === 'restore') {
      try {
        const st = JSON.parse(document.getElementById('restore').value);
        if (!st || typeof st !== 'object' || !st.slots || !st.idx || !Array.isArray(st.contracts)) throw new Error('format');
        S = Object.assign(C.defaultState(), st); save(); ui.msg = 'Sauvegarde restaurée.'; render();
      } catch (err) { ui.msg = 'Sauvegarde illisible : colle le texte complet copié depuis l\'onglet Données.'; render(); }
    }
    else if (a === 'askwipe') { ui.confirm = true; render(); }
    else if (a === 'nowipe') { ui.confirm = false; render(); }
    else if (a === 'wipe') { S = C.defaultState(); ui.confirm = false; ui.msg = 'Données effacées.'; ui.backup = ''; save(); render(); }
  });

  document.addEventListener('change', (e) => {
    const el = e.target, k = el.dataset && el.dataset.ch;
    if (!k) return;
    if (k === 'files') { if (el.files && el.files.length) importFiles([...el.files]); return; }
    if (k === 'pfrom') { ui.from = el.value; render(); return; }
    if (k === 'pto') { ui.to = el.value; render(); return; }
    if (k === 'dayin') { if (el.value) { ui.day = el.value; ui.sel = null; render(); } return; }
    const id = el.dataset.id;
    if (k === 'cname') setContract(id, (c) => { c.name = el.value.trim() || 'Contrat'; });
    else if (k === 'ctype') setContract(id, (c) => { c.type = el.value; });
    else if (k === 'cwe') setContract(id, (c) => { c.weekendHC = el.checked; });
    else if (k === 'cnum') { const v = parseNum(el.value); setContract(id, (c) => { if (v !== null && v >= 0) c[el.dataset.f] = v; }); }
    else if (k === 'cat') { ui.cat = el.value; render(); }
    else if (k === 'relayfix') { S.relayFix = el.checked; save(); render(); }
    else if (k === 'autosync') { setPref('autoSync', el.checked); }
    else if (k === 'timemode') { setPref('timeList', el.value === 'list'); render(); }
    else if (k === 'force') { ui.force = el.checked; }
    else if (k === 'veeq') { ui.veEq = el.value; render(); }
    else if (k === 'site') { switchSite(el.value); render(); }
    else if (k === 'sitename') { const v = el.value.trim(); if (v) { curSite().name = v; saveSites(); } render(); }
    else if (k === 'siteconf') { ui.siteTyped = el.value; render(); }
    else if (k === 'eqon') {
      const e = S.equip.find((x) => x.id === el.dataset.eq), key = el.dataset.key;
      if (e) { C.setEqOn(S, e, key, C.hcShare(key.slice(0, 10), C.hm(key.slice(11, 16)), S.schedules, S.shift), el.checked); save(); render(); }
    }
    else if (k === 'ename' || k === 'erest' || k === 'eprio' || k === 'esure' || k === 'emode' || k === 'rfrom' || k === 'rto' || k === 'rday' || k === 'eday' || k === 'ewatts' || k === 'ewmax') {
      const e = S.equip.find((x) => x.id === id);
      if (e) {
        if (k === 'ename') e.name = el.value.trim() || 'Équipement';
        else if (k === 'erest') { e.rest = el.checked; if (e.rest) { delete e.watts; delete e.wmax; } }
        else if (k === 'eprio') e.prio = el.checked;
        else if (k === 'esure') e.sure = el.checked;
        else if (k === 'emode') { e.mode = el.value; if (e.mode === 'range') { const r = rangesOf(e); if (!r.length) r.push({ from: '18:00', to: '22:00' }); e.days = e.days && e.days.length ? e.days : [0, 1, 2, 3, 4, 5, 6]; } }
        else if (k === 'rday') {
          const r = rangesOf(e)[Number(el.dataset.i)];
          if (r) { const cur = new Set(r.days && r.days.length ? r.days : e.days && e.days.length ? e.days : [0, 1, 2, 3, 4, 5, 6]), d = Number(el.dataset.d); if (el.checked) cur.add(d); else cur.delete(d); r.days = [...cur]; }
        }
        else if (k === 'rfrom' || k === 'rto') { const r = rangesOf(e)[Number(el.dataset.i)]; if (r && el.value) r[k === 'rfrom' ? 'from' : 'to'] = el.value; }
        else if (k === 'ewmax') { const v = parseNum(el.value); if (v !== null && v > 0) e.wmax = v; else delete e.wmax; }
        else if (k === 'eday') { const d = Number(el.dataset.d), cur = new Set(e.days && e.days.length ? e.days : [0, 1, 2, 3, 4, 5, 6]); if (el.checked) cur.add(d); else cur.delete(d); e.days = [...cur]; }
        else { const v = parseNum(el.value); if (v !== null && v > 0) e.watts = v; else delete e.watts; }
        save(); render();
      }
    }
    else if (k === 'kva2') { const v = parseNum(el.value); if (v !== null && v > 0) { S.kva2 = v; save(); } render(); }
    else if (k === 'kva') { const v = parseNum(el.value); if (v !== null && v > 0) { S.kva = v; save(); } render(); }
    else if (k === 'shift') { const v = parseNum(el.value); if (v !== null) { S.shift = Math.max(-120, Math.min(120, Math.round(v))); save(); } render(); }
    else if (k === 'sched') {
      const s = S.schedules[Number(el.dataset.i)], mm = el.value.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
      if (s && mm) { const dd = String(mm[1]).padStart(2, '0'), mo = String(mm[2]).padStart(2, '0'); s[el.dataset.f] = mo + '-' + dd; save(); }
      render();
    } else if (k === 'range') {
      const s = S.schedules[Number(el.dataset.i)], kk = Number(el.dataset.k), ee = Number(el.dataset.e);
      if (s) {
        s.ranges[kk] = s.ranges[kk] || ['', '']; s.ranges[kk][ee] = el.value;
        s.ranges = s.ranges.filter((r) => r && r[0] && r[1]); save();
      }
      render();
    }
  });

  document.addEventListener('toggle', (e) => { const el = e.target; if (el && el.dataset && el.dataset.k) ui.open[el.dataset.k] = el.open; }, true);

  window.addEventListener('hashchange', () => {
    const t = location.hash.slice(1);
    if (TABS.some((x) => x.id === t) && t !== ui.tab) { ui.tab = t; ui.sel = null; render(); }
  });

  loadSites();
  S = load();
  if (window.SEED && sites.cur === 's1' && window.SEED.pmax && !Object.keys(S.pmax || {}).length) S.pmax = Object.assign({}, window.SEED.pmax);
  if (!S.pmax) S.pmax = {};
  /* Recharges VE déjà fournies : appliquées une seule fois sur le premier site, puis modifiables librement. */
  if (window.SEED && window.SEED.ve && sites.cur === 's1' && !S.seedVe) {
    let e = S.equip.find((x) => /\bve\b|voiture|v[ée]hicule|charg/i.test(x.name)) || S.equip.find((x) => x.wmax >= 1500);
    if (!e) { e = { id: 'e' + Date.now().toString(36), name: 'Chargeur de voiture électrique', mode: 'hc', wmax: 3700 }; S.equip.push(e); }
    C.importVe(S, window.SEED.ve, e.id);
    S.seedVe = true;
  }
  if ((S.veRules || 0) < 3) {
    const ids = [...new Set((S.eqMeas || []).filter((x) => x.src === 've').map((x) => x.eq))];
    for (const id of ids) {
      const e = S.equip.find((x) => x.id === id);
      if (!e) continue;
      /* horaires exacts de l'export (secondes comprises) : on relit les recharges d'origine */
      if (window.SEED && window.SEED.ve && sites.cur === 's1') C.importVe(S, window.SEED.ve, id); else C.applyVeRules(S, e);
    }
    S.veRules = 3;
  }
  const h0 = (location.hash || '').slice(1);
  if (TABS.some((x) => x.id === h0)) ui.tab = h0;
  save();
  render();
  document.addEventListener('pointerdown', function once() {
    document.removeEventListener('pointerdown', once, true);
    try { if (prefs().autoSync && navigator.onLine && syncInfo().at && (syncDirty() || Date.now() - syncInfo().at > 6 * 3600e3)) doSync('auto'); } catch (e) { /* ignoré */ }
  }, true);
  setTimeout(() => { loadGsi().catch(() => { /* hors connexion */ }); }, 1500);
})();
