'use strict';
/* Grafici SVG senza dipendenze, costruiti con h()/s() (mai innerHTML).
 *
 * Regole seguite (metodo dataviz): una sola scala per grafico, barre sottili con
 * estremità arrotondata e base squadrata, 2px di "aria" tra i segmenti, linee da 2px,
 * punti con anello del colore della superficie, griglia hairline recessiva, tooltip
 * al passaggio/tocco e una vista tabella equivalente per ogni grafico.
 * Colori: giuste = teal, sbagliate = arancio (coppia validata per daltonismo). */

import { h, s, mount, icon } from './dom.js';

/* ------------------------------------------------------------ utilità */
const fmtDay = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtWhen = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const parseDay = str => { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pct = v => Math.round(v * 100) + '%';
export const MODE_NAMES = {
  sim: 'Simulazione esame', smart: 'Ripasso intelligente', wrongest: 'Le più sbagliate',
  unseen: 'Mai viste', topic: 'Per argomento', free: 'Libera', ids: 'Rifai gli errori',
};

/** Estremo "tondo" per l'asse y (conteggi interi) e relativi tick */
function niceScale(maxValue, target = 4) {
  const v = Math.max(1, maxValue);
  const raw = v / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
  const max = Math.ceil(v / step) * step;
  const ticks = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  return { max, ticks };
}

/** Rettangolo con i due angoli superiori arrotondati e base squadrata */
function roundTop(x, y, w, hgt, r, cls) {
  const rr = Math.max(0, Math.min(r, hgt, w / 2));
  const d = `M${x},${y + hgt}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt}Z`;
  return s('path', { d, class: cls });
}

/** Ridisegna il grafico quando cambia la larghezza del contenitore */
function responsive(host, draw) {
  let lastW = 0;
  const run = () => {
    const w = Math.floor(host.clientWidth);
    if (!w || w === lastW) return;
    lastW = w;
    host.replaceChildren();
    draw(w);
  };
  new ResizeObserver(run).observe(host);
  run();
}

/* ------------------------------------------------------------ tooltip */
let activeTip = null;
document.addEventListener('pointerdown', e => {
  if (activeTip && !activeTip.host.contains(e.target)) { activeTip.hide(); activeTip = null; }
});

function makeTip(host) {
  const el = h('div', { class: 'tip', hidden: true, role: 'status' });
  host.appendChild(el);
  const api = {
    host,
    hide() { el.hidden = true; },
    show(nodes, x, y) {
      mount(el, nodes);
      el.hidden = false;
      const w = el.offsetWidth, hh = el.offsetHeight, hw = host.clientWidth;
      let left = x + 14;
      if (left + w > hw) left = x - w - 14;
      el.style.left = clamp(left, 0, Math.max(0, hw - w)) + 'px';
      el.style.top = clamp(y - hh - 12, 0, Math.max(0, host.clientHeight - hh)) + 'px';
      activeTip = api;
    },
  };
  return api;
}
const tipHead = text => h('div', { class: 'tip-h' }, text);
const tipRow = (cls, label, value) => h('div', { class: 'tip-row' },
  h('i', { class: 'key ' + cls }), h('span', { class: 'tip-l' }, label), h('b', null, value));

/** x relativo all'svg (in unità del viewBox, che coincidono con i pixel) */
function localPoint(svgEl, e) {
  const r = svgEl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function emptyNote(text) { return h('div', { class: 'chart-empty' }, text); }

/** Etichette dell'asse x: indici da mostrare, spaziati di almeno `minGap` px */
function labelIndexes(n, innerW, minGap) {
  if (n <= 1) return [0];
  const slots = Math.max(2, Math.floor(innerW / minGap));
  const out = new Set();
  for (let k = 0; k < slots; k++) out.add(Math.round(k * (n - 1) / (slots - 1)));
  return [...out].sort((a, b) => a - b);
}

/* ------------------------------------------------------------ andamento punteggi (linea) */
/** points: [{ts, mode, total, correct, passed}] in ordine cronologico */
export function lineChart(host, { points, threshold }) {
  responsive(host, W => {
    const n = points.length;
    const H = 210, m = { l: 36, r: 18, t: 16, b: 26 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const xAt = i => (n === 1 ? m.l + iw / 2 : m.l + i * iw / (n - 1));
    const yAt = v => m.t + ih * (1 - v / 100);
    const vals = points.map(p => (p.total ? p.correct / p.total * 100 : 0));
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
      'aria-label': `Percentuale di risposte corrette negli ultimi ${n} quiz. Ultimo: ${Math.round(vals[n - 1])}%.` });

    for (const t of [0, 25, 50, 75, 100]) {
      svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: yAt(t), y2: yAt(t), class: t === 0 ? 'axis' : 'grid' }));
      svg.appendChild(s('text', { x: m.l - 8, y: yAt(t) + 4, 'text-anchor': 'end' }, String(t)));
    }
    if (threshold != null) {
      svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: yAt(threshold), y2: yAt(threshold), class: 'ref' }));
      svg.appendChild(s('text', { x: m.l + 6, y: yAt(threshold) - 6, 'text-anchor': 'start', class: 'ref-label' }, `Soglia esame ${threshold}%`));
    }
    if (n > 1) {
      const top = vals.map((v, i) => `${i ? 'L' : 'M'}${xAt(i)},${yAt(v)}`).join('');
      svg.appendChild(s('path', { d: `${top}L${xAt(n - 1)},${yAt(0)}L${xAt(0)},${yAt(0)}Z`, class: 'area-ok' }));
      svg.appendChild(s('path', { d: top, class: 'line-ok', fill: 'none' }));
    }
    const dotIdx = n <= 30 ? vals.map((_, i) => i) : [n - 1];
    for (const i of dotIdx) svg.appendChild(s('circle', { cx: xAt(i), cy: yAt(vals[i]), r: 4, class: 'dot-ok' }));

    // etichetta diretta sull'ultimo punto
    const ly = yAt(vals[n - 1]);
    svg.appendChild(s('text', { x: xAt(n - 1), y: ly < m.t + 16 ? ly + 20 : ly - 10, 'text-anchor': n === 1 ? 'middle' : 'end', class: 'end-label' },
      Math.round(vals[n - 1]) + '%'));

    for (const i of labelIndexes(n, iw, 78)) {
      const anchor = n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      svg.appendChild(s('text', { x: xAt(i), y: H - 6, 'text-anchor': anchor }, fmtDay.format(new Date(points[i].ts * 1000))));
    }

    // hover: linea guida + punto evidenziato
    const guide = s('line', { y1: m.t, y2: yAt(0), class: 'guide', visibility: 'hidden' });
    const mark = s('circle', { r: 6, class: 'dot-ok hot', visibility: 'hidden' });
    svg.append(guide, mark);
    const tip = makeTip(host);
    const move = e => {
      const p = localPoint(svg, e);
      const i = n === 1 ? 0 : clamp(Math.round((p.x - m.l) / (iw / (n - 1))), 0, n - 1);
      const q = points[i];
      guide.setAttribute('x1', xAt(i)); guide.setAttribute('x2', xAt(i)); guide.setAttribute('visibility', 'visible');
      mark.setAttribute('cx', xAt(i)); mark.setAttribute('cy', yAt(vals[i])); mark.setAttribute('visibility', 'visible');
      const rows = [
        tipHead(`${MODE_NAMES[q.mode] || 'Quiz'} · ${fmtWhen.format(new Date(q.ts * 1000))}`),
        h('div', { class: 'tip-big' }, `${q.correct}/${q.total}`, h('span', null, ` · ${Math.round(vals[i])}%`)),
      ];
      if (q.passed === 1) rows.push(h('div', { class: 'tip-note ok' }, 'Esame superato'));
      else if (q.passed === 0) rows.push(h('div', { class: 'tip-note bad' }, 'Esame non superato'));
      tip.show(rows, xAt(i), yAt(vals[i]));
    };
    const leave = e => { if (e.pointerType === 'mouse') { tip.hide(); guide.setAttribute('visibility', 'hidden'); mark.setAttribute('visibility', 'hidden'); } };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', leave);
    host.insertBefore(svg, tip.host.firstChild);
  });
}

/* ------------------------------------------------------------ risposte al giorno (barre impilate) */
/** days: [{day, correct, wrong}] */
export function stackedColumns(host, { days }) {
  responsive(host, W => {
    const n = days.length;
    const H = 210, m = { l: 34, r: 6, t: 14, b: 26 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, base = m.t + ih;
    const peak = Math.max(1, ...days.map(d => d.correct + d.wrong));
    const sc = niceScale(peak);
    const slot = iw / n, bw = clamp(slot * 0.66, 2, 24), GAP = 2;
    const yv = v => (v / sc.max) * ih;
    const total = days.reduce((a, d) => a + d.correct + d.wrong, 0);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
      'aria-label': `Risposte giuste e sbagliate per giorno, ultimi ${n} giorni: ${total} risposte in totale.` });

    for (const t of sc.ticks) {
      const y = base - yv(t);
      svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: t === 0 ? 'axis' : 'grid' }));
      svg.appendChild(s('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end' }, String(t)));
    }
    const band = s('rect', { y: m.t, height: ih, width: slot, class: 'hover-band', visibility: 'hidden' });
    svg.appendChild(band);

    days.forEach((d, i) => {
      const x = m.l + slot * i + (slot - bw) / 2;
      const hc = d.correct ? Math.max(3, yv(d.correct)) : 0;
      const hw = d.wrong ? Math.max(3, yv(d.wrong)) : 0;
      if (hc) svg.appendChild(hw ? s('rect', { x, y: base - hc, width: bw, height: hc, class: 'fill-ok' })
        : roundTop(x, base - hc, bw, hc, 4, 'fill-ok'));
      if (hw) svg.appendChild(roundTop(x, base - hc - (hc ? GAP : 0) - hw, bw, hw, 4, 'fill-bad'));
    });

    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 58))));
    for (let i = n - 1; i >= 0; i -= step) {
      const cx = m.l + slot * (i + 0.5);
      const anchor = cx > W - 30 ? 'end' : cx < m.l + 22 ? 'start' : 'middle';
      svg.appendChild(s('text', { x: anchor === 'end' ? W - m.r : cx, y: H - 6, 'text-anchor': anchor },
        i === n - 1 ? 'oggi' : fmtDay.format(parseDay(days[i].day))));
    }
    if (!total) svg.appendChild(s('text', { x: m.l + iw / 2, y: m.t + ih / 2, 'text-anchor': 'middle', class: 'note-label' }, 'Nessuna risposta in questo periodo'));

    const tip = makeTip(host);
    const move = e => {
      const p = localPoint(svg, e);
      const i = clamp(Math.floor((p.x - m.l) / slot), 0, n - 1);
      const d = days[i], t = d.correct + d.wrong;
      band.setAttribute('x', m.l + slot * i); band.setAttribute('visibility', 'visible');
      const rows = [tipHead(fmtLong.format(parseDay(d.day))), tipRow('fill-ok', 'Giuste', String(d.correct)), tipRow('fill-bad', 'Sbagliate', String(d.wrong))];
      if (t) rows.push(h('div', { class: 'tip-note' }, `${pct(d.correct / t)} corrette`));
      tip.show(rows, m.l + slot * (i + 0.5), base - yv(t));
    };
    const leave = e => { if (e.pointerType === 'mouse') { tip.hide(); band.setAttribute('visibility', 'hidden'); } };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', leave);
    host.insertBefore(svg, tip.host.firstChild);
  });
}

/* ------------------------------------------------------------ errori per simulazione (colonne) */
/** sims: [{ts, total, correct, errors, passed, limit}] */
export function simColumns(host, { sims }) {
  responsive(host, W => {
    const n = sims.length;
    const H = 200, m = { l: 34, r: 14, t: 14, b: 26 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, base = m.t + ih;
    const refLimit = sims.length ? sims[sims.length - 1].limit : null;   // di norma 3 (30 domande)
    const sc = niceScale(Math.max(refLimit != null ? refLimit + 1 : 1, ...sims.map(q => q.errors)));
    const slot = iw / n, bw = clamp(slot * 0.6, 4, 24);
    const yv = v => (v / sc.max) * ih;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
      'aria-label': `Errori nelle ultime ${n} simulazioni d'esame${refLimit != null ? `, limite ${refLimit}` : ''}.` });

    for (const t of sc.ticks) {
      const y = base - yv(t);
      svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: t === 0 ? 'axis' : 'grid' }));
      svg.appendChild(s('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end' }, String(t)));
    }
    const band = s('rect', { y: m.t, height: ih, width: slot, class: 'hover-band', visibility: 'hidden' });
    svg.appendChild(band);
    sims.forEach((q, i) => {
      const x = m.l + slot * i + (slot - bw) / 2, cls = q.passed ? 'fill-ok' : 'fill-bad';
      if (q.errors > 0) svg.appendChild(roundTop(x, base - Math.max(3, yv(q.errors)), bw, Math.max(3, yv(q.errors)), 4, cls));
      else svg.appendChild(s('circle', { cx: x + bw / 2, cy: base - 4, r: 3.5, class: 'fill-ok' }));
    });
    if (refLimit != null) {
      svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: base - yv(refLimit), y2: base - yv(refLimit), class: 'ref' }));
      svg.appendChild(s('text', { x: W - m.r, y: base - yv(refLimit) - 6, 'text-anchor': 'end', class: 'ref-label' }, `Limite ${refLimit} errori`));
    }
    for (const i of labelIndexes(n, iw, 64)) {
      const cx = m.l + slot * (i + 0.5);
      svg.appendChild(s('text', { x: cx, y: H - 6, 'text-anchor': cx > W - 30 ? 'end' : 'middle' }, fmtDay.format(new Date(sims[i].ts * 1000))));
    }
    const tip = makeTip(host);
    const move = e => {
      const p = localPoint(svg, e);
      const i = clamp(Math.floor((p.x - m.l) / slot), 0, n - 1), q = sims[i];
      band.setAttribute('x', m.l + slot * i); band.setAttribute('visibility', 'visible');
      tip.show([
        tipHead(fmtWhen.format(new Date(q.ts * 1000))),
        h('div', { class: 'tip-big' }, `${q.errors} ${q.errors === 1 ? 'errore' : 'errori'}`, h('span', null, ` su ${q.total}`)),
        h('div', { class: 'tip-note ' + (q.passed ? 'ok' : 'bad') }, q.passed ? 'Superata' : `Non superata (limite ${q.limit})`),
      ], m.l + slot * (i + 0.5), base - yv(q.errors));
    };
    const leave = e => { if (e.pointerType === 'mouse') { tip.hide(); band.setAttribute('visibility', 'hidden'); } };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', leave);
    host.insertBefore(svg, tip.host.firstChild);
  });
}

/* ------------------------------------------------------------ calendario di allenamento (heatmap) */
export const HEAT_LEVELS = 5;

/** days: [{day, correct, wrong}] ordinati, l'ultimo è oggi */
export function heatmap(host, { days }) {
  responsive(host, W => {
    const n = days.length;
    const first = parseDay(days[0].day);
    const offset = (first.getDay() + 6) % 7;          // lunedì = 0
    const cols = Math.ceil((offset + n) / 7);
    const GAP = 3, left = 30, top = 18;
    const cell = clamp(Math.floor((W - left - GAP * (cols - 1)) / cols), 9, 30);
    const H = top + 7 * (cell + GAP);
    const totals = days.map(d => d.correct + d.wrong);
    const nz = totals.filter(v => v > 0).sort((a, b) => a - b);
    const q = f => nz.length ? nz[Math.min(nz.length - 1, Math.floor(nz.length * f))] : 1;
    const cuts = [q(0.25), q(0.5), q(0.75)];
    const level = v => (v === 0 ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4);
    const pos = i => ({ col: Math.floor((offset + i) / 7), row: (offset + i) % 7 });
    const px = col => left + col * (cell + GAP), py = row => top + row * (cell + GAP);

    const active = totals.filter(v => v > 0).length;
    const svg = s('svg', { viewBox: `0 0 ${left + cols * (cell + GAP)} ${H}`, width: left + cols * (cell + GAP), height: H, role: 'img',
      'aria-label': `Calendario degli ultimi ${n} giorni: ${active} giorni con almeno una risposta.` });
    ['lun', 'mer', 'ven'].forEach((t, k) => svg.appendChild(s('text', { x: 0, y: py(k * 2) + cell - 2 }, t)));
    let lastMonth = -1, lastX = -99;
    days.forEach((d, i) => {
      const { col, row } = pos(i), date = parseDay(d.day);
      if (date.getMonth() !== lastMonth && (row === 0 || i === 0 || col > pos(i - 1).col)) {
        lastMonth = date.getMonth();
        if (px(col) - lastX >= 30) { svg.appendChild(s('text', { x: px(col), y: 11 }, new Intl.DateTimeFormat('it-IT', { month: 'short' }).format(date))); lastX = px(col); }
      }
      svg.appendChild(s('rect', { x: px(col), y: py(row), width: cell, height: cell, rx: 3, class: 'heat h' + level(totals[i]) }));
    });
    const ring = s('rect', { width: cell + 4, height: cell + 4, rx: 4, class: 'heat-ring', visibility: 'hidden' });
    svg.appendChild(ring);
    const tip = makeTip(host);
    const move = e => {
      const p = localPoint(svg, e);
      const col = Math.floor((p.x - left) / (cell + GAP)), row = Math.floor((p.y - top) / (cell + GAP));
      const i = col * 7 + row - offset;
      if (row < 0 || row > 6 || col < 0 || i < 0 || i >= n) { tip.hide(); ring.setAttribute('visibility', 'hidden'); return; }
      const d = days[i];
      ring.setAttribute('x', px(col) - 2); ring.setAttribute('y', py(row) - 2); ring.setAttribute('visibility', 'visible');
      tip.show([tipHead(fmtLong.format(parseDay(d.day))),
        h('div', { class: 'tip-big' }, String(totals[i]), h('span', null, totals[i] === 1 ? ' risposta' : ' risposte')),
        totals[i] ? h('div', { class: 'tip-note' }, `${d.correct} giuste · ${d.wrong} sbagliate`) : null], px(col) + cell / 2, py(row));
    };
    const leave = e => { if (e.pointerType === 'mouse') { tip.hide(); ring.setAttribute('visibility', 'hidden'); } };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', leave);
    host.insertBefore(svg, tip.host.firstChild);
  });
}

/* ------------------------------------------------------------ elementi HTML */
/** Barra segmentata sottile: la lista accanto riporta nomi e valori */
export function segBar(parts, label) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const bar = h('div', { class: 'segbar', role: 'img', 'aria-label': label });
  if (!total) bar.classList.add('empty');
  for (const p of parts) {
    if (p.value > 0) bar.appendChild(h('i', { class: 'seg ' + p.cls, style: { flexGrow: String(p.value) }, title: `${p.label}: ${p.value}` }));
  }
  return bar;
}

/** Classifica a barre orizzontali (percentuale 0..1; null = nessun dato) */
export function rankBars(rows, onPick) {
  return h('div', { class: 'rank' }, rows.map(r => {
    const body = [
      h('span', { class: 'rk-l' }, r.label, h('em', null, r.note || '')),
      h('span', { class: 'rk-t' }, r.value == null ? null : h('i', { style: { width: Math.max(2, Math.round(r.value * 100)) + '%' } })),
      h('b', { class: 'rk-v' }, r.value == null ? '–' : pct(r.value)),
    ];
    return r.id != null && onPick
      ? h('button', { class: 'rk', type: 'button', title: 'Ripassa questo argomento', onclick: () => onPick(r) }, body)
      : h('div', { class: 'rk' }, body);
  }));
}

/** Tabella equivalente al grafico (vista alternativa, accessibile) */
export function dataTable({ cols, rows }) {
  return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, cols.map(c => h('th', { scope: 'col' }, c)))),
    h('tbody', null, rows.length ? rows.map(r => h('tr', null, r.map(c => h('td', null, String(c)))))
      : h('tr', null, h('td', { colspan: cols.length }, 'Nessun dato')))));
}

/** Scheda con titolo, legenda, grafico e pulsante "Tabella" */
export function chartCard({ title, sub, legend, empty, draw, table, wide }) {
  const host = h('div', { class: 'chart' });
  const holder = h('div', { class: 'tbl-holder', hidden: true });
  const toggle = h('button', { class: 'iconbtn sm', type: 'button', title: 'Mostra come tabella', 'aria-pressed': 'false' }, icon('table', 18));
  const card = h('section', { class: 'card chart-card' + (wide ? ' wide' : '') },
    h('header', { class: 'ch-h' }, h('div', null, h('h3', null, title), sub ? h('p', { class: 'muted small' }, sub) : null), empty ? null : toggle),
    legend && !empty ? h('ul', { class: 'legend' }, legend.map(l => h('li', null, h('i', { class: 'key sq ' + l.cls }), l.label))) : null,
    empty ? emptyNote(empty) : [host, holder]);
  if (!empty) {
    draw(host);
    toggle.onclick = () => {
      const showTable = holder.hidden;
      if (showTable) mount(holder, dataTable(table()));
      holder.hidden = !showTable; host.hidden = showTable;
      toggle.setAttribute('aria-pressed', String(showTable));
      toggle.title = showTable ? 'Mostra il grafico' : 'Mostra come tabella';
      mount(toggle, icon(showTable ? 'chart' : 'table', 18));
    };
  }
  return card;
}
