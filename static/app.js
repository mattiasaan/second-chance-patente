'use strict';
/* Second Chance Patente - frontend (JavaScript puro, nessuna build).
 * Tutta l'interfaccia è costruita con h()/s() da dom.js: nessun innerHTML. */

import { h, mount, icon, safeImageUrl } from './dom.js';
import { renderStats } from './stats.js';
import { MODE_NAMES } from './charts.js';

const root = document.getElementById('root');
const toastBox = document.getElementById('toasts');
let view = null;          // <main>
let topics = [];          // argomenti (con conteggi)
let pasteHandler = null;  // chi riceve le immagini incollate
let keyHandler = null;    // scorciatoie da tastiera della vista corrente
let timerId = null;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------ utilità */
function toast(msg, kind = '', action = null) {
  const el = h('div', { class: 'toast ' + kind }, h('span', null, msg));
  if (action) el.appendChild(h('button', { type: 'button', onclick: () => { el.remove(); action.fn(); } }, action.label));
  toastBox.appendChild(el);
  setTimeout(() => el.remove(), action ? 5000 : 2200);
}

async function api(url, opt = {}) {
  const o = { credentials: 'same-origin', ...opt };
  if (o.json !== undefined) {
    o.method = o.method || 'POST';
    o.headers = { 'Content-Type': 'application/json' };
    o.body = JSON.stringify(o.json);
    delete o.json;
  }
  let r;
  try { r = await fetch(url, o); } catch { const err = new Error('Server non raggiungibile'); err.offline = true; throw err; }
  if (r.status === 401 && !url.endsWith('/login')) { showLogin(); const e = new Error('auth'); e.auth = true; throw e; }
  if (!r.ok) {
    let m = 'Errore ' + r.status;
    try { m = (await r.json()).detail || m; } catch { /* corpo non JSON */ }
    throw new Error(m);
  }
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : r;
}
function fail(e) { if (!e.auth) toast(e.message || 'Errore', 'bad'); }

function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
const pct = x => (x == null ? '–' : Math.round(x * 100) + '%');
async function loadTopics() { topics = await api('/api/topics'); }
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

/* immagini: ridimensiona prima di inviare (più veloce sul Raspberry) */
async function prepImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 600e3) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.9));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}
const extOf = b => ((b.type || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg');

document.addEventListener('paste', e => {
  if (!pasteHandler) return;
  const it = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
  if (it) { e.preventDefault(); pasteHandler(it.getAsFile()); }
});
document.addEventListener('keydown', e => { if (keyHandler) keyHandler(e); });

/* suggerimento argomento dalle parole chiave */
function suggestTopic(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  let best = null, bs = 0;
  for (const tp of topics) {
    let sc = 0;
    for (const k of tp.keywords.split(',')) {
      const kw = k.trim().toLowerCase();
      if (!kw) continue;
      // senza l'ultima lettera riconosce singolare/plurale (semaforo/semafori)
      const stem = kw.length > 5 ? kw.slice(0, -1) : kw;
      if (t.includes(stem)) sc += 1 + kw.length / 12;
    }
    if (sc > bs) { bs = sc; best = tp.id; }
  }
  return bs >= 1 ? best : null;
}

/* Vero / Falso */
function tfButtons(onPick) {
  const mk = a => h('button', { type: 'button', class: 'tfb', dataset: { a }, onclick: () => onPick(a) },
    h('b', null, a ? 'V' : 'F'), a ? 'Vero' : 'Falso');
  const box = h('div', { class: 'tf' }, mk(1), mk(0));
  box.paint = answer => { for (const b of box.children) b.classList.toggle('on', answer !== null && Number(b.dataset.a) === answer); };
  return box;
}

/* ------------------------------------------------------------ login e shell */
function showLogin() {
  stopTimer(); pasteHandler = null; keyHandler = null; view = null;
  document.body.dataset.view = 'login';
  const err = h('div', { class: 'err', role: 'alert' });
  const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const form = h('form', {
    class: 'login-form',
    onsubmit: async e => {
      e.preventDefault();
      try { await api('/api/login', { json: { password: pw.value } }); boot(); }
      catch (error) { err.textContent = error.message; pw.select(); }
    },
  },
  h('img', { src: '/icons/icon.svg', alt: '', width: 72, height: 72 }),
  h('h1', null, 'Second Chance Patente'),
  h('p', { class: 'muted' }, 'Una seconda possibilità per le domande che sbagli'),
  pw, err, h('button', { class: 'btn primary big', type: 'submit' }, 'Entra'));
  mount(root, h('div', { class: 'login' }, form));
  pw.focus();
}

function buildShell() {
  const items = [['add', 'Aggiungi'], ['quiz', 'Quiz'], ['library', 'Domande'], ['stats', 'Statistiche'], ['settings', 'Altro']];
  view = h('main', { id: 'view' });
  mount(root,
    h('nav', { class: 'nav', 'aria-label': 'Principale' },
      h('a', { class: 'brand', href: '#/add', 'aria-label': 'Second Chance Patente' }, icon('logo', 30)),
      items.map(([v, l]) => h('a', { href: '#/' + v, dataset: { v } }, icon(v), h('span', null, l)))),
    view);
}

async function boot() {
  try {
    await api('/api/me');
    await loadTopics();
  } catch (e) {
    if (e.auth) return;
    mount(root, h('div', { class: 'login' }, h('div', { class: 'login-form' },
      h('h1', null, 'Server non raggiungibile'),
      h('p', { class: 'muted' }, 'Controlla che il Raspberry sia acceso e raggiungibile.'),
      h('button', { class: 'btn primary', type: 'button', onclick: boot }, 'Riprova'))));
    return;
  }
  buildShell();
  route();
}

function route() {
  if (!view) return;
  const name = (location.hash.replace(/^#\/?/, '') || 'add').split('?')[0];
  stopTimer(); pasteHandler = null; keyHandler = null;
  document.querySelectorAll('.nav a[data-v]').forEach(a => a.classList.toggle('on', a.dataset.v === name));
  document.body.dataset.view = name;
  switch (name) {
    case 'add': viewAdd(); break;
    case 'quiz': viewQuiz(); break;
    case 'library': viewLibrary(); break;
    case 'stats': renderStats(view, { api, fail, startTopicQuiz }); break;
    case 'settings': viewSettings(); break;
    default: viewAdd();
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ------------------------------------------------------------ AGGIUNGI */
function viewAdd() {
  const st = { img: null, imgUrl: null, answer: null, topic: null, locked: false, count: null, all: false };
  const cnt = h('span', { class: 'muted small' });
  const drop = h('div', { class: 'drop' });
  const ta = h('textarea', { rows: 4, placeholder: 'Testo della domanda…', 'aria-label': 'Testo della domanda' });
  const hint = h('span', { class: 'hint' });
  const chips = h('div', { class: 'chips' });
  const pin = h('input', { type: 'checkbox' });
  const save = h('button', { class: 'btn primary big savebar', type: 'submit', disabled: true }, 'Salva', h('kbd', null, 'Ctrl+Invio'));
  const tf = tfButtons(a => { st.answer = a; refresh(); });

  function renderDrop() {
    drop.classList.toggle('has', !!st.img);
    if (st.img) {
      mount(drop, h('img', { src: st.imgUrl, alt: 'Immagine della domanda' }),
        h('button', { type: 'button', class: 'iconbtn rm', title: 'Rimuovi immagine', onclick: () => setImg(null) }, icon('x', 18)));
    } else {
      const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: e => { if (e.target.files[0]) onImage(e.target.files[0]); e.target.value = ''; } });
      mount(drop, icon('img', 20), h('span', null, ' Incolla un\'immagine ', h('kbd', null, 'Ctrl+V'), ' oppure '), h('label', { class: 'link' }, 'scegli file', file));
    }
  }
  function setImg(blob) {
    if (st.imgUrl) URL.revokeObjectURL(st.imgUrl);
    st.img = blob; st.imgUrl = blob ? URL.createObjectURL(blob) : null;
    renderDrop();
  }
  async function onImage(file) { setImg(await prepImage(file)); ta.focus(); }
  pasteHandler = onImage;
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => {
    e.preventDefault(); drop.classList.remove('over');
    const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
    if (f) onImage(f);
  };

  /* Argomenti: prima il suggerito/scelto, poi i più usati; gli altri dietro "Altri…" */
  function renderChips() {
    let list = topics;
    if (!st.all) {
      const seen = new Set(), out = [];
      const push = t => { if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t); } };
      push(topics.find(t => t.id === st.topic));
      [...topics].sort((a, b) => b.count - a.count || a.position - b.position).forEach(push);
      list = out.slice(0, 8);
    }
    const more = topics.length > list.length || st.all
      ? h('button', { type: 'button', class: 'chip more', onclick: () => { st.all = !st.all; renderChips(); } },
        st.all ? 'Meno' : `Altri ${topics.length - list.length}…`) : null;
    mount(chips, list.map(t => h('button', {
      type: 'button', class: 'chip' + (st.topic === t.id ? ' on' : '') + (st.topic === t.id && !st.locked ? ' auto' : ''),
      onclick: () => { st.topic = st.topic === t.id && st.locked ? null : t.id; st.locked = true; renderChips(); },
    }, t.name)), more);
    hint.textContent = st.topic && !st.locked ? '· suggerito, tocca per cambiare' : '';
  }
  function refresh() {
    save.disabled = !(ta.value.trim() && st.answer !== null);
    tf.paint(st.answer);
  }
  ta.oninput = () => {
    if (!st.locked) { st.topic = suggestTopic(ta.value); renderChips(); }
    refresh();
  };
  function showCount() { cnt.textContent = st.count == null ? '' : plural(st.count, 'domanda salvata', 'domande salvate'); }

  async function doSave() {
    if (save.disabled) return;
    save.disabled = true;
    const fd = new FormData();
    fd.append('text', ta.value.trim());
    fd.append('answer', st.answer);
    if (st.topic) fd.append('topic_id', st.topic);
    if (st.img) fd.append('image', st.img, 'q.' + extOf(st.img));
    try {
      const r = await api('/api/questions', { method: 'POST', body: fd });
      if (r.duplicate) toast('Già presente: la segno come sbagliata di nuovo', 'warn');
      else {
        st.count = (st.count || 0) + 1;
        const id = r.question.id;
        toast('Salvata', 'ok', { label: 'Annulla', fn: async () => {
          try { await api('/api/questions/' + id, { method: 'DELETE' }); st.count--; showCount(); toast('Annullato'); } catch (e) { fail(e); }
        } });
      }
      ta.value = ''; st.answer = null; setImg(null);
      if (!pin.checked) { st.topic = null; st.locked = false; }
      renderChips(); showCount(); refresh(); ta.focus();
      loadTopics().then(renderChips).catch(() => { /* conteggi non aggiornati */ });
    } catch (e) { fail(e); refresh(); }
  }

  keyHandler = e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doSave(); }
    else if (e.altKey && e.code === 'KeyV') { e.preventDefault(); st.answer = 1; refresh(); }
    else if (e.altKey && e.code === 'KeyF') { e.preventDefault(); st.answer = 0; refresh(); }
  };

  mount(view, h('div', { class: 'wrap narrow' },
    h('header', { class: 'ph' }, h('h1', null, 'Nuova domanda'), cnt),
    h('form', { class: 'stack', autocomplete: 'off', onsubmit: e => { e.preventDefault(); doSave(); } },
      drop, ta, tf,
      h('div', null, h('div', { class: 'lbl' }, 'Argomento ', hint), chips,
        h('label', { class: 'chk' }, pin, ' Mantieni l\'argomento dopo il salvataggio')),
      save)));
  renderDrop(); renderChips(); refresh();
  api('/api/questions?limit=1').then(r => { st.count = r.total; showCount(); }).catch(() => { /* contatore opzionale */ });
  ta.focus();
}

/* ------------------------------------------------------------ DOMANDE (libreria) */
async function viewLibrary() {
  await loadTopics().catch(() => { /* usa i conteggi in memoria */ });
  const st = { q: '', topic: '', status: 'all', items: [], total: 0, loading: false };
  const tot = h('span', { class: 'muted small' });
  const list = h('div', { class: 'list' });
  const more = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => load(false) }, 'Carica altre');

  const search = h('input', { type: 'search', placeholder: 'Cerca nel testo…', 'aria-label': 'Cerca' });
  let timer;
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { st.q = search.value; load(true); }, 250); };
  const fTopic = h('select', { 'aria-label': 'Argomento', onchange: () => { st.topic = fTopic.value; load(true); } },
    h('option', { value: '' }, 'Tutti gli argomenti'), h('option', { value: 'none' }, 'Senza argomento'),
    topics.map(t => h('option', { value: t.id }, `${t.name} (${t.count})`)));
  const fStatus = h('select', { 'aria-label': 'Stato', onchange: () => { st.status = fStatus.value; load(true); } },
    [['all', 'Tutte'], ['review', 'Da ripassare'], ['unseen', 'Mai viste'], ['mastered', 'Padroneggiate']].map(([v, l]) => h('option', { value: v }, l)));

  async function load(reset) {
    if (st.loading) return;
    st.loading = true;
    if (reset) st.items = [];
    const p = new URLSearchParams({ q: st.q, topic: st.topic, status: st.status, limit: 40, offset: st.items.length });
    try {
      const r = await api('/api/questions?' + p);
      st.items = st.items.concat(r.items); st.total = r.total;
    } catch (e) { fail(e); }
    st.loading = false;
    draw();
  }

  function row(q) {
    const img = safeImageUrl(q.image);
    return h('div', { class: 'item' },
      h('div', { class: 'thumb' }, img ? h('img', { src: img, loading: 'lazy', alt: '' }) : icon('img', 22)),
      h('div', { class: 'ibody' },
        h('div', { class: 'itext' }, q.text),
        h('div', { class: 'meta' },
          h('span', { class: 'badge ' + (q.answer ? 'v' : 'f') }, q.answer ? 'Vero' : 'Falso'),
          q.topic_name ? h('span', null, q.topic_name) : h('i', null, 'senza argomento'),
          h('span', { class: 'cnt ok', title: 'Risposte giuste' }, icon('check', 14), String(q.correct)),
          h('span', { class: 'cnt bad', title: 'Risposte sbagliate' }, icon('x', 14), String(q.wrong)))),
      h('div', { class: 'iact' },
        h('button', { type: 'button', class: 'iconbtn', title: 'Modifica', onclick: () => editDialog(q, nq => { st.items[st.items.indexOf(q)] = nq; draw(); loadTopics(); }) }, icon('edit', 19)),
        h('button', { type: 'button', class: 'iconbtn', title: 'Elimina', onclick: async () => {
          if (!confirm('Eliminare questa domanda?')) return;
          try { await api('/api/questions/' + q.id, { method: 'DELETE' }); st.items = st.items.filter(x => x !== q); st.total--; draw(); loadTopics(); } catch (err) { fail(err); }
        } }, icon('trash', 19))));
  }
  function draw() {
    tot.textContent = plural(st.total, 'domanda', 'domande');
    more.hidden = st.items.length >= st.total;
    const filtered = st.q || st.topic || st.status !== 'all';
    mount(list, st.items.length ? st.items.map(row)
      : h('div', { class: 'empty' }, filtered ? 'Nessuna domanda con questi filtri.' : ['Nessuna domanda salvata. ', h('a', { href: '#/add' }, 'Aggiungine una'), '.']));
  }

  mount(view, h('div', { class: 'wrap' },
    h('header', { class: 'ph' }, h('h1', null, 'Domande'), tot),
    h('div', { class: 'filters' }, search, fTopic, fStatus),
    list, h('div', { class: 'row center' }, more)));
  load(true);
}

function editDialog(q, onSaved) {
  const st = { img: null, imgUrl: null, remove: false, answer: q.answer };
  const prevPaste = pasteHandler;
  const drop = h('div', { class: 'drop' });
  const ta = h('textarea', { rows: 4, 'aria-label': 'Testo della domanda' });
  ta.value = q.text;
  const tf = tfButtons(a => { st.answer = a; tf.paint(a); });
  const sel = h('select', { 'aria-label': 'Argomento' }, h('option', { value: '' }, 'Senza argomento'),
    topics.map(t => h('option', { value: t.id, selected: t.id === q.topic_id }, t.name)));
  const dlg = h('dialog', null);
  const close = () => { pasteHandler = prevPaste; dlg.close(); dlg.remove(); };

  const current = () => (st.img ? st.imgUrl : st.remove ? '' : safeImageUrl(q.image));
  function renderDrop() {
    const src = current();
    drop.classList.toggle('has', !!src);
    if (src) {
      mount(drop, h('img', { src, alt: 'Immagine della domanda' }),
        h('button', { type: 'button', class: 'iconbtn rm', title: 'Rimuovi immagine', onclick: () => { st.img = null; st.remove = true; renderDrop(); } }, icon('x', 18)));
    } else {
      const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: e => { if (e.target.files[0]) onImg(e.target.files[0]); } });
      mount(drop, h('span', null, 'Incolla un\'immagine ', h('kbd', null, 'Ctrl+V'), ' o '), h('label', { class: 'link' }, 'scegli file', file));
    }
  }
  async function onImg(file) { st.img = await prepImage(file); st.imgUrl = URL.createObjectURL(st.img); st.remove = false; renderDrop(); }
  pasteHandler = onImg;

  const form = h('form', {
    class: 'stack',
    onsubmit: async e => {
      e.preventDefault();
      const text = ta.value.trim(); if (!text) return;
      const fd = new FormData();
      fd.append('text', text); fd.append('answer', st.answer);
      fd.append('topic_id', sel.value); fd.append('remove_image', st.remove ? 1 : 0);
      if (st.img) fd.append('image', st.img, 'q.' + extOf(st.img));
      try {
        const r = await api('/api/questions/' + q.id, { method: 'PUT', body: fd });
        close(); onSaved(r.question); toast('Modificata', 'ok');
      } catch (err) { fail(err); }
    },
  }, h('h2', null, 'Modifica domanda'), drop, ta, tf, sel,
  h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Annulla'), h('button', { class: 'btn primary', type: 'submit' }, 'Salva')));
  dlg.appendChild(form);
  dlg.addEventListener('cancel', () => { pasteHandler = prevPaste; setTimeout(() => dlg.remove(), 0); });
  document.body.appendChild(dlg);
  renderDrop(); tf.paint(st.answer); dlg.showModal();
}

/* ------------------------------------------------------------ QUIZ */
const MODES = [
  { id: 'sim', desc: '30 domande · 20 minuti · max 3 errori · senza correzione' },
  { id: 'smart', desc: 'Più peso a ciò che sbagli di più e alle domande nuove' },
  { id: 'wrongest', desc: 'Solo domande che hai già sbagliato, dalla peggiore' },
  { id: 'unseen', desc: 'Domande che non hai ancora provato nei quiz' },
  { id: 'topic', desc: 'Scegli un capitolo da ripassare' },
  { id: 'free', desc: 'Domande a caso tra tutte quelle salvate' },
];

/* Il quiz in corso vive in localStorage: rileggerlo = dato non fidato, lo ricostruisco campo per campo. */
function sanitizeQuiz(raw) {
  try {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.qs)) return null;
    const qs = raw.qs
      .map(x => ({ id: Number(x && x.id), text: String(x && x.text), answer: x && x.answer ? 1 : 0, image: safeImageUrl(x && x.image) }))
      .filter(x => Number.isInteger(x.id));
    if (!qs.length) return null;
    const ans = {};
    for (const x of qs) { const a = raw.ans && raw.ans[x.id]; if (a === 0 || a === 1) ans[x.id] = a; }
    return {
      mode: has(MODE_NAMES, raw.mode) ? raw.mode : 'free', qs, ans,
      idx: clamp(parseInt(raw.idx, 10) || 0, 0, qs.length - 1),
      t0: Number(raw.t0) || Date.now(),
      limit: raw.limit ? Number(raw.limit) : null,
      maxErr: raw.maxErr == null ? null : Number(raw.maxErr),
      immediate: !!raw.immediate, done: false,
    };
  } catch { return null; }
}
let Q = null; // quiz in corso o appena concluso
try { Q = sanitizeQuiz(JSON.parse(localStorage.getItem('pq_quiz') || 'null')); } catch { Q = null; }
function persistQ() {
  try {
    if (Q && !Q.done) localStorage.setItem('pq_quiz', JSON.stringify(Q));
    else localStorage.removeItem('pq_quiz');
  } catch { /* storage non disponibile */ }
}

function viewQuiz() {
  if (Q && Q.done) return renderResults();
  if (Q) return renderRun();
  return renderMenu();
}

async function renderMenu() {
  document.body.dataset.view = 'quiz';
  let stats = null;
  try { stats = await api('/api/stats'); } catch (e) { if (e.auth) return; }
  await loadTopics().catch(() => { /* conteggi in memoria */ });
  const counts = stats ? { sim: stats.questions, smart: stats.questions, free: stats.questions, topic: stats.questions, wrongest: stats.wrong_any, unseen: stats.unseen } : {};
  let o = { mode: 'sim', count: 20, topic: '', immediate: true };
  try { const saved = JSON.parse(localStorage.getItem('pq_opts') || '{}'); if (saved && has(MODE_NAMES, saved.mode)) o = { ...o, ...saved }; } catch { /* default */ }
  if (counts[o.mode] === 0) o.mode = 'smart';
  const usable = topics.filter(t => t.count > 0);
  if (o.mode === 'topic' && !usable.some(t => String(t.id) === String(o.topic))) o.topic = usable[0] ? usable[0].id : '';

  const body = h('div', { class: 'stack' });
  function draw() {
    const sim = o.mode === 'sim';
    mount(body,
      h('div', { class: 'modes' }, MODES.map(m => {
        const n = counts[m.id];
        return h('button', { type: 'button', class: 'mode' + (m.id === o.mode ? ' on' : ''), disabled: n === 0, onclick: () => { o.mode = m.id; if (m.id === 'topic' && !o.topic && usable[0]) o.topic = usable[0].id; draw(); } },
          h('b', null, MODE_NAMES[m.id]), h('span', null, m.desc), n == null ? null : h('em', null, plural(n, 'domanda', 'domande')));
      })),
      o.mode === 'topic' ? h('select', { 'aria-label': 'Argomento', onchange: e => { o.topic = e.target.value; } },
        usable.map(t => h('option', { value: t.id, selected: String(t.id) === String(o.topic) }, `${t.name} (${t.count})`))) : null,
      sim ? null : h('div', null, h('div', { class: 'lbl' }, 'Numero di domande'),
        h('div', { class: 'counts' }, [10, 20, 30, 50, 0].map(n => h('button', { type: 'button', class: 'chip' + (o.count === n ? ' on' : ''), onclick: () => { o.count = n; draw(); } }, n ? String(n) : 'Tutte')))),
      sim ? null : h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: o.immediate, onchange: e => { o.immediate = e.target.checked; } }), ' Mostra subito se la risposta è giusta'),
      h('button', { type: 'button', class: 'btn primary big', onclick: start }, 'Inizia'));
  }
  async function start() {
    try { localStorage.setItem('pq_opts', JSON.stringify(o)); } catch { /* ignora */ }
    const p = new URLSearchParams({ mode: o.mode, count: o.count || 500 });
    if (o.mode === 'topic') p.set('topic_id', o.topic);
    try { await startQuiz(await api('/api/quiz?' + p), o.mode === 'sim' ? false : o.immediate); } catch (e) { fail(e); }
  }
  mount(view, h('div', { class: 'wrap narrow' },
    h('header', { class: 'ph' }, h('h1', null, 'Quiz'), stats ? h('span', { class: 'muted small' }, plural(stats.questions, 'domanda salvata', 'domande salvate')) : null),
    body));
  draw();
}

async function startQuiz(data, immediate) {
  if (!data.questions.length) { toast('Nessuna domanda disponibile per questa modalità', 'warn'); return; }
  Q = sanitizeQuiz({
    mode: data.mode, qs: data.questions, ans: {}, idx: 0, t0: Date.now(), limit: data.time_limit, maxErr: data.max_errors, immediate,
  });
  persistQ();
  if (location.hash !== '#/quiz') location.hash = '#/quiz'; else renderRun();
}

function startTopicQuiz(id) {
  return api(`/api/quiz?mode=topic&topic_id=${encodeURIComponent(id)}&count=20`)
    .then(data => startQuiz(data, true)).catch(fail);
}

function renderRun() {
  document.body.dataset.view = 'quiz-run';
  const n = Q.qs.length, pages = Math.ceil(n / 10);
  const q = Q.qs[Q.idx], page = Math.floor(Q.idx / 10);
  const given = Q.ans[q.id], locked = Q.immediate && given !== undefined;
  const last = Q.idx === n - 1;
  const go = i => { Q.idx = clamp(i, 0, n - 1); persistQ(); renderRun(); };
  const answer = a => { if (locked) return; Q.ans[q.id] = a; persistQ(); renderRun(); };
  const stateOf = (x, i) => {
    const g = Q.ans[x.id];
    let c = i === Q.idx ? 'cur' : '';
    if (g !== undefined) c += Q.immediate ? (g === x.answer ? ' ok' : ' ko') : ' ans';
    return c;
  };
  const timer = h('span', { class: 'timer' }, '--:--');
  const choice = (a, label) => h('button', {
    type: 'button', dataset: { a },
    class: 'qb' + (given === a ? ' sel' : '') + (locked && q.answer === a ? ' right' : '') + (locked && given === a && q.answer !== a ? ' wrong' : ''),
    disabled: locked, onclick: () => answer(a),
  }, h('i', null, a ? 'V' : 'F'), label);

  mount(view, h('div', { class: 'qz' + (q.image ? '' : ' noimg') },
    h('div', { class: 'qtop' },
      h('button', { type: 'button', class: 'iconbtn', title: 'Esci dal quiz', onclick: () => {
        if (confirm('Abbandonare il quiz? I progressi andranno persi.')) { Q = null; persistQ(); stopTimer(); renderMenu(); }
      } }, icon('x')),
      h('span', { class: 'tt' }, MODE_NAMES[Q.mode] || 'Quiz'), timer),
    h('div', { class: 'road', 'aria-hidden': 'true' }, Q.qs.map((x, i) => h('i', { class: stateOf(x, i) }))),
    pages > 1 ? h('div', { class: 'tabs' }, Array.from({ length: pages }, (_, p) =>
      h('button', { type: 'button', class: p === page ? 'on' : '', onclick: () => go(p * 10) }, `Domande ${p * 10 + 1}-${Math.min(n, p * 10 + 10)}`))) : null,
    h('div', { class: 'nums' }, Q.qs.slice(page * 10, page * 10 + 10).map((x, j) => {
      const i = page * 10 + j;
      return h('button', { type: 'button', class: stateOf(x, i), 'aria-label': `Domanda ${i + 1}`, onclick: () => go(i) }, String(i + 1));
    })),
    q.image ? h('div', { class: 'pimg' }, h('img', { src: q.image, alt: 'Immagine della domanda' })) : null,
    h('div', { class: 'pbody' }, h('span', { class: 'no' }, String(Q.idx + 1)), h('p', null, q.text),
      locked ? h('div', { class: 'fb ' + (given === q.answer ? 'ok' : 'ko') },
        given === q.answer ? 'Corretto' : `Sbagliato — la risposta giusta è ${q.answer ? 'VERO' : 'FALSO'}`) : null),
    h('div', { class: 'ptf' }, choice(1, 'Vero'), choice(0, 'Falso')),
    h('div', { class: 'qbar' },
      h('button', { type: 'button', class: 'btn', onclick: () => finishQuiz(false) }, 'Termina quiz'),
      h('div', { class: 'grp' },
        h('button', { type: 'button', class: 'btn', disabled: Q.idx === 0, 'aria-label': 'Domanda precedente', onclick: () => go(Q.idx - 1) }, icon('left', 20)),
        h('button', { type: 'button', class: 'btn' + (last ? '' : ' primary'), disabled: last, 'aria-label': 'Domanda successiva', onclick: () => go(Q.idx + 1) }, icon('right', 20))))));

  keyHandler = e => {
    if (e.target.matches('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'v') answer(1); else if (k === 'f') answer(0);
    else if (e.key === 'ArrowRight' || e.key === 'Enter') go(Q.idx + 1);
    else if (e.key === 'ArrowLeft') go(Q.idx - 1);
  };
  stopTimer();
  const tick = () => {
    const spent = (Date.now() - Q.t0) / 1000;
    if (Q.limit) {
      const left = Q.limit - spent;
      timer.textContent = fmtTime(left); timer.classList.toggle('low', left < 120);
      if (left <= 0) { stopTimer(); finishQuiz(true); }
    } else timer.textContent = fmtTime(spent);
  };
  tick(); timerId = setInterval(tick, 500);
}

async function finishQuiz(auto) {
  const un = Q.qs.filter(x => Q.ans[x.id] === undefined).length;
  if (!auto && un && !confirm(`Hai ${plural(un, 'domanda', 'domande')} senza risposta (contano come errori). Terminare?`)) return;
  stopTimer();
  const duration = Math.round((Date.now() - Q.t0) / 1000);
  try {
    const res = await api('/api/quiz/finish', { json: {
      mode: Q.mode, duration: Q.limit ? Math.min(duration, Q.limit) : duration, max_errors: Q.maxErr,
      question_ids: Q.qs.map(x => x.id),
      answers: Object.entries(Q.ans).map(([id, a]) => ({ question_id: Number(id), answer: a })) } });
    Q.done = true; Q.res = res; persistQ();
    if (location.hash !== '#/quiz') location.hash = '#/quiz'; else renderResults();
    loadTopics();
  } catch (e) { fail(e); if (auto) renderRun(); }
}

function renderResults() {
  document.body.dataset.view = 'quiz';
  keyHandler = null; stopTimer();
  const r = Q.res;
  const errors = Number(r.errors) || 0;
  const verdict = r.passed === null || r.passed === undefined ? null
    : h('div', { class: 'verdict ' + (r.passed ? 'ok' : 'ko') }, r.passed ? 'PROMOSSO' : 'BOCCIATO');
  const sub = [plural(errors, 'errore', 'errori') + (r.max_errors != null ? ` (massimo ${Number(r.max_errors)})` : '')];
  if (r.unanswered) sub.push(`${Number(r.unanswered)} senza risposta`);
  sub.push(fmtTime(Number(r.duration) || 0));
  const wrong = Array.isArray(r.wrong) ? r.wrong : [];

  mount(view, h('div', { class: 'wrap narrow' },
    h('div', { class: 'card score' },
      h('div', { class: 'big' }, String(Number(r.correct) || 0), h('span', { class: 'muted' }, '/' + (Number(r.total) || 0))),
      h('div', { class: 'muted' }, sub.join(' · ')), verdict),
    h('div', { class: 'row', style: { margin: '14px 0' } },
      wrong.length ? h('button', { type: 'button', class: 'btn primary', onclick: async () => {
        try { const ids = wrong.map(w => Number(w.id)).join(','); Q = null; await startQuiz(await api('/api/quiz?mode=ids&ids=' + ids), true); } catch (e) { fail(e); }
      } }, 'Rifai gli errori') : null,
      h('button', { type: 'button', class: 'btn', onclick: () => { Q = null; persistQ(); renderMenu(); } }, 'Nuovo quiz')),
    wrong.length ? h('h2', null, 'Da rivedere') : h('div', { class: 'empty' }, 'Nessun errore, ottimo lavoro!'),
    wrong.map(w => {
      const img = safeImageUrl(w.image);
      return h('div', { class: 'wq' },
        img ? h('div', { class: 'thumb' }, h('img', { src: img, alt: '' })) : null,
        h('div', { class: 'ibody' }, h('div', null, w.text),
          h('div', { class: 'meta' },
            h('span', null, 'Tua risposta: ', h('b', null, w.given === null || w.given === undefined ? 'nessuna' : w.given ? 'Vero' : 'Falso')),
            h('span', null, 'Corretta: ', h('span', { class: 'badge ' + (w.answer ? 'v' : 'f') }, w.answer ? 'Vero' : 'Falso')))));
    })));
}

/* ------------------------------------------------------------ ALTRO (impostazioni) */
async function viewSettings() {
  await loadTopics().catch(() => { /* usa i dati in memoria */ });
  const rows = h('div', null);
  function drawTopics() {
    mount(rows, topics.map(t => {
      const name = h('input', { type: 'text', required: true, 'aria-label': 'Nome argomento' });
      const kw = h('input', { type: 'text', placeholder: 'parole, chiave', 'aria-label': 'Parole chiave' });
      name.value = t.name; kw.value = t.keywords;
      return h('form', {
        class: 'trow',
        onsubmit: async e => {
          e.preventDefault();
          try { await api('/api/topics/' + t.id, { method: 'PUT', json: { name: name.value, keywords: kw.value } }); await loadTopics(); toast('Salvato', 'ok'); } catch (err) { fail(err); }
        },
      }, name, kw, h('div', { class: 'row' },
        h('button', { class: 'btn sm', type: 'submit' }, 'Salva'),
        h('button', { type: 'button', class: 'iconbtn', title: `Elimina (${plural(t.count, 'domanda', 'domande')})`, onclick: async () => {
          if (!confirm(`Eliminare "${t.name}"? Le ${t.count} domande restano, senza argomento.`)) return;
          try { await api('/api/topics/' + t.id, { method: 'DELETE' }); await loadTopics(); drawTopics(); } catch (err) { fail(err); }
        } }, icon('trash', 18))));
    }));
  }
  const newName = h('input', { type: 'text', placeholder: 'Nuovo argomento', required: true, 'aria-label': 'Nuovo argomento' });
  const newKw = h('input', { type: 'text', placeholder: 'parole, chiave', 'aria-label': 'Parole chiave' });
  const importer = h('input', { type: 'file', accept: '.zip', hidden: true, onchange: async e => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await api('/api/import', { method: 'POST', body: fd });
      toast(`Importate ${plural(r.added, 'domanda', 'domande')} (${r.skipped} già presenti)`, 'ok');
      await loadTopics(); drawTopics();
    } catch (err) { fail(err); }
    e.target.value = '';
  } });

  mount(view, h('div', { class: 'wrap narrow stack' },
    h('header', { class: 'ph' }, h('h1', null, 'Altro')),
    h('section', { class: 'card' }, h('h2', null, 'Argomenti'),
      h('p', { class: 'muted small' }, 'Le parole chiave (separate da virgola) servono a suggerire l\'argomento mentre scrivi una domanda.'),
      rows,
      h('form', { class: 'trow', onsubmit: async e => {
        e.preventDefault();
        try { await api('/api/topics', { json: { name: newName.value, keywords: newKw.value } }); await loadTopics(); drawTopics(); newName.value = ''; newKw.value = ''; } catch (err) { fail(err); }
      } }, newName, newKw, h('button', { class: 'btn sm primary', type: 'submit' }, 'Aggiungi'))),
    h('section', { class: 'card' }, h('h2', null, 'Backup'),
      h('p', { class: 'muted small' }, 'Zip con domande, immagini, statistiche e argomenti. L\'importazione unisce i dati senza duplicare le domande già presenti.'),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '/api/export', download: '' }, 'Esporta backup'), h('label', { class: 'btn' }, 'Importa backup', importer))),
    h('section', { class: 'card' }, h('h2', null, 'Sessione'),
      h('button', { type: 'button', class: 'btn danger', onclick: async () => { try { await api('/api/logout', { method: 'POST' }); } catch { /* già fuori */ } view = null; showLogin(); } }, 'Esci'))));
  drawTopics();
}

/* ------------------------------------------------------------ avvio */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA opzionale */ });
boot();
