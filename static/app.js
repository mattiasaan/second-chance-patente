'use strict';
/* Patente Quiz - frontend (vanilla JS, nessuna dipendenza) */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#root');
let view = null;          // <main>
let topics = [];          // argomenti
let pasteHandler = null;  // chi riceve le immagini incollate
let keyHandler = null;    // scorciatoie da tastiera della vista corrente
let timerId = null;

const ICONS = {
  add: '<path d="M12 5v14M5 12h14"/>',
  quiz: '<path d="M7 4.5v15l12-7.5z"/>',
  library: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  stats: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  img: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M5 18l5-5 4 4 2-2 3 3"/>',
};
const ico = (n, s = 22) => `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

/* ------------------------------------------------------------ utilità */
function toast(msg, kind = '', action = null) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { el.remove(); action.fn(); };
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
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
  try { r = await fetch(url, o); }
  catch (e) { const err = new Error('Server non raggiungibile'); err.offline = true; throw err; }
  if (r.status === 401 && !url.endsWith('/login')) { showLogin(); const e = new Error('auth'); e.auth = true; throw e; }
  if (!r.ok) {
    let m = 'Errore ' + r.status;
    try { m = (await r.json()).detail || m; } catch { }
    throw new Error(m);
  }
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : r;
}
function fail(e) { if (!e.auth) toast(e.message || 'Errore', 'bad'); }

function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
const pct = x => x == null ? '–' : Math.round(x * 100) + '%';
const topicName = id => (topics.find(t => t.id === id) || {}).name || '';

async function loadTopics() { topics = await api('/api/topics'); }

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
    let s = 0;
    for (const k of tp.keywords.split(',')) {
      const kw = k.trim().toLowerCase();
      if (!kw) continue;
      // senza l'ultima lettera riconosce singolare/plurale (semaforo/semafori)
      const stem = kw.length > 5 ? kw.slice(0, -1) : kw;
      if (t.includes(stem)) s += 1 + kw.length / 12;
    }
    if (s > bs) { bs = s; best = tp.id; }
  }
  return bs >= 1 ? best : null;
}

/* ------------------------------------------------------------ login e shell */
function showLogin() {
  stopTimer(); pasteHandler = null; keyHandler = null;
  document.body.dataset.view = 'login';
  root.innerHTML = `<div class="login"><form id="lf">
    <img src="/icons/icon.svg" alt="">
    <h1>Patente Quiz</h1>
    <input type="password" id="pw" placeholder="Password" autocomplete="current-password" autofocus>
    <div class="err" id="lerr"></div>
    <button class="btn primary big">Entra</button></form></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/login', { json: { password: $('#pw').value } }); boot(); }
    catch (err) { $('#lerr').textContent = err.message; $('#pw').select(); }
  };
}

function buildShell() {
  const items = [['add', 'Aggiungi'], ['quiz', 'Quiz'], ['library', 'Domande'], ['stats', 'Statistiche'], ['settings', 'Altro']];
  root.innerHTML = `<nav class="nav">${items.map(([v, l]) => `<a href="#/${v}" data-v="${v}">${ico(v)}<span>${l}</span></a>`).join('')}</nav><main id="view"></main>`;
  view = $('#view');
}

async function boot() {
  try {
    await api('/api/me');
    await loadTopics();
  } catch (e) {
    if (e.auth) return;
    root.innerHTML = `<div class="login"><div class="stack" style="text-align:center">
      <h1>Server non raggiungibile</h1><p class="muted">Controlla che il Raspberry sia acceso e raggiungibile.</p>
      <button class="btn primary" onclick="boot()">Riprova</button></div></div>`;
    return;
  }
  buildShell();
  route();
}

const VIEWS = { add: viewAdd, quiz: viewQuiz, library: viewLibrary, stats: viewStats, settings: viewSettings };
function route() {
  if (!view) return;
  const name = (location.hash.replace(/^#\/?/, '') || 'add').split('?')[0];
  stopTimer(); pasteHandler = null; keyHandler = null;
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.v === name));
  document.body.dataset.view = name;
  (VIEWS[name] || viewAdd)();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ------------------------------------------------------------ AGGIUNGI */
function viewAdd() {
  const st = { img: null, imgUrl: null, answer: null, topic: null, locked: false, count: null };
  view.innerHTML = `<div class="wrap narrow">
    <header class="ph"><h1>Nuova domanda</h1><span class="muted small" id="cnt"></span></header>
    <form id="f" class="stack" autocomplete="off">
      <div class="drop" id="drop"></div>
      <textarea id="t" rows="4" placeholder="Testo della domanda…" autofocus></textarea>
      <div class="tf">
        <button type="button" class="tfb" data-a="1"><b>V</b>Vero</button>
        <button type="button" class="tfb" data-a="0"><b>F</b>Falso</button>
      </div>
      <div>
        <div class="lbl">Argomento <span id="hint" style="text-transform:none;letter-spacing:0"></span></div>
        <div class="chips" id="chips"></div>
        <label class="chk"><input type="checkbox" id="pin"> Mantieni l'argomento dopo il salvataggio</label>
      </div>
      <button class="btn primary big" id="save" disabled>Salva <kbd>Ctrl+Invio</kbd></button>
    </form></div>`;
  const ta = $('#t'), save = $('#save'), drop = $('#drop');

  function renderDrop() {
    drop.classList.toggle('has', !!st.img);
    if (st.img) {
      drop.innerHTML = `<img src="${st.imgUrl}" alt=""><button type="button" class="iconbtn rm" id="rmimg" title="Rimuovi">${ico('x', 18)}</button>`;
      $('#rmimg').onclick = () => setImg(null);
    } else {
      drop.innerHTML = `<span>${ico('img', 20)}</span>&nbsp; Incolla un'immagine <kbd>Ctrl+V</kbd> &nbsp;oppure&nbsp;
        <label class="link">scegli file<input type="file" accept="image/*" hidden id="file"></label>`;
      $('#file').onchange = e => { if (e.target.files[0]) onImage(e.target.files[0]); e.target.value = ''; };
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
    const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
    if (f) onImage(f);
  };

  function renderChips() {
    $('#chips').innerHTML = topics.map(t =>
      `<button type="button" class="chip${st.topic === t.id ? ' on' : ''}${st.topic === t.id && !st.locked ? ' auto' : ''}" data-id="${t.id}">${esc(t.name)}</button>`).join('');
    $('#hint').textContent = st.topic && !st.locked ? '· suggerito, tocca per cambiare' : '';
  }
  $('#chips').onclick = e => {
    const b = e.target.closest('.chip'); if (!b) return;
    const id = +b.dataset.id;
    st.topic = st.topic === id && st.locked ? null : id;
    st.locked = true;
    renderChips();
  };
  function refresh() {
    save.disabled = !(ta.value.trim() && st.answer !== null);
    $$('.tfb').forEach(b => b.classList.toggle('on', st.answer !== null && +b.dataset.a === st.answer));
  }
  ta.oninput = () => {
    if (!st.locked) { st.topic = suggestTopic(ta.value); renderChips(); }
    refresh();
  };
  $('.tf').onclick = e => { const b = e.target.closest('.tfb'); if (b) { setAnswer(+b.dataset.a); } };
  function setAnswer(a) { st.answer = a; refresh(); }

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
        toast('Salvata ✓', 'ok', { label: 'Annulla', fn: async () => {
          try { await api('/api/questions/' + id, { method: 'DELETE' }); st.count--; showCount(); toast('Annullato'); } catch (e) { fail(e); }
        } });
      }
      ta.value = ''; st.answer = null; setImg(null);
      if (!$('#pin').checked) { st.topic = null; st.locked = false; }
      renderChips(); showCount(); refresh(); ta.focus();
    } catch (e) { fail(e); refresh(); }
  }
  $('#f').onsubmit = e => { e.preventDefault(); doSave(); };

  keyHandler = e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doSave(); }
    else if (e.altKey && e.code === 'KeyV') { e.preventDefault(); setAnswer(1); }
    else if (e.altKey && e.code === 'KeyF') { e.preventDefault(); setAnswer(0); }
  };

  function showCount() { $('#cnt').textContent = st.count == null ? '' : st.count + (st.count === 1 ? ' domanda salvata' : ' domande salvate'); }
  renderDrop(); renderChips(); refresh();
  api('/api/questions?limit=1').then(r => { st.count = r.total; showCount(); }).catch(() => { });
  ta.focus();
}

/* ------------------------------------------------------------ LIBRERIA */
async function viewLibrary() {
  await loadTopics().catch(() => { });
  const st = { q: '', topic: '', status: 'all', items: [], total: 0, loading: false };
  view.innerHTML = `<div class="wrap">
    <header class="ph"><h1>Domande</h1><span class="muted small" id="tot"></span></header>
    <div class="filters">
      <input type="search" id="q" placeholder="Cerca nel testo…">
      <select id="ft"><option value="">Tutti gli argomenti</option><option value="none">Senza argomento</option>
        ${topics.map(t => `<option value="${t.id}">${esc(t.name)} (${t.count})</option>`).join('')}</select>
      <select id="fs"><option value="all">Tutte</option><option value="review">Da ripassare</option>
        <option value="unseen">Mai viste</option><option value="mastered">Padroneggiate</option></select>
    </div>
    <div id="list"></div>
    <div class="row" style="justify-content:center;margin-top:10px"><button class="btn" id="more" hidden>Carica altre</button></div>
  </div>`;

  async function load(reset) {
    if (st.loading) return;
    st.loading = true;
    if (reset) { st.items = []; }
    const p = new URLSearchParams({ q: st.q, topic: st.topic, status: st.status, limit: 40, offset: st.items.length });
    try {
      const r = await api('/api/questions?' + p);
      st.items = st.items.concat(r.items); st.total = r.total;
    } catch (e) { fail(e); }
    st.loading = false;
    draw();
  }
  function draw() {
    $('#tot').textContent = st.total + (st.total === 1 ? ' domanda' : ' domande');
    $('#more').hidden = st.items.length >= st.total;
    $('#list').innerHTML = st.items.length ? st.items.map(q => {
      const tn = q.topic_name ? esc(q.topic_name) : '<i>senza argomento</i>';
      return `<div class="item" data-id="${q.id}">
        <div class="thumb">${q.image ? `<img src="${q.image}" loading="lazy" alt="">` : ico('img', 22)}</div>
        <div class="ibody"><div class="itext">${esc(q.text)}</div>
          <div class="meta"><span class="badge ${q.answer ? 'v' : 'f'}">${q.answer ? 'Vero' : 'Falso'}</span>
            <span>${tn}</span><span>✓${q.correct} ✗${q.wrong}</span></div></div>
        <div class="iact"><button class="iconbtn" data-act="edit" title="Modifica">${ico('edit', 19)}</button>
          <button class="iconbtn" data-act="del" title="Elimina">${ico('trash', 19)}</button></div></div>`;
    }).join('') : `<div class="empty">Nessuna domanda${st.q || st.topic || st.status !== 'all' ? ' con questi filtri' : ' salvata: <a href="#/add">aggiungine una</a>'}.</div>`;
  }
  let timer;
  $('#q').oninput = e => { clearTimeout(timer); timer = setTimeout(() => { st.q = e.target.value; load(true); }, 250); };
  $('#ft').onchange = e => { st.topic = e.target.value; load(true); };
  $('#fs').onchange = e => { st.status = e.target.value; load(true); };
  $('#more').onclick = () => load(false);
  $('#list').onclick = async e => {
    const b = e.target.closest('[data-act]'), it = e.target.closest('.item');
    if (!it) return;
    const q = st.items.find(x => x.id === +it.dataset.id);
    if (!q) return;
    if (b && b.dataset.act === 'del') {
      if (!confirm('Eliminare questa domanda?')) return;
      try { await api('/api/questions/' + q.id, { method: 'DELETE' }); st.items = st.items.filter(x => x !== q); st.total--; draw(); loadTopics(); }
      catch (err) { fail(err); }
    } else {
      editDialog(q, nq => { st.items[st.items.indexOf(q)] = nq; draw(); loadTopics(); });
    }
  };
  load(true);
}

function editDialog(q, onSaved) {
  const st = { img: null, imgUrl: null, remove: false, answer: q.answer };
  const prev = pasteHandler;
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form class="stack" method="dialog">
    <h2>Modifica domanda</h2>
    <div class="drop" id="edrop"></div>
    <textarea id="et" rows="4">${esc(q.text)}</textarea>
    <div class="tf"><button type="button" class="tfb" data-a="1"><b>V</b>Vero</button><button type="button" class="tfb" data-a="0"><b>F</b>Falso</button></div>
    <select id="etp"><option value="">Senza argomento</option>${topics.map(t => `<option value="${t.id}"${t.id === q.topic_id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" id="ecancel">Annulla</button><button class="btn primary" id="esave">Salva</button></div>
  </form>`;
  document.body.appendChild(dlg);
  const drop = $('#edrop', dlg);
  const cur = () => st.img ? st.imgUrl : (st.remove ? null : q.image);
  function renderDrop() {
    const src = cur();
    drop.classList.toggle('has', !!src);
    drop.innerHTML = src
      ? `<img src="${src}" alt=""><button type="button" class="iconbtn rm" id="ermimg">${ico('x', 18)}</button>`
      : `<span>Incolla un'immagine <kbd>Ctrl+V</kbd> o </span>&nbsp;<label class="link">scegli file<input type="file" accept="image/*" hidden id="efile"></label>`;
    const rm = $('#ermimg', dlg); if (rm) rm.onclick = () => { st.img = null; st.remove = true; renderDrop(); };
    const f = $('#efile', dlg); if (f) f.onchange = e => { if (e.target.files[0]) onImg(e.target.files[0]); };
  }
  async function onImg(file) { st.img = await prepImage(file); st.imgUrl = URL.createObjectURL(st.img); st.remove = false; renderDrop(); }
  pasteHandler = onImg;
  function ans() { $$('.tfb', dlg).forEach(b => b.classList.toggle('on', +b.dataset.a === st.answer)); }
  $('.tf', dlg).onclick = e => { const b = e.target.closest('.tfb'); if (b) { st.answer = +b.dataset.a; ans(); } };
  const close = () => { pasteHandler = prev; dlg.close(); dlg.remove(); };
  $('#ecancel', dlg).onclick = close;
  dlg.addEventListener('cancel', () => { pasteHandler = prev; setTimeout(() => dlg.remove(), 0); });
  $('form', dlg).onsubmit = async e => {
    e.preventDefault();
    const text = $('#et', dlg).value.trim(); if (!text) return;
    const fd = new FormData();
    fd.append('text', text); fd.append('answer', st.answer);
    fd.append('topic_id', $('#etp', dlg).value); fd.append('remove_image', st.remove ? 1 : 0);
    if (st.img) fd.append('image', st.img, 'q.' + extOf(st.img));
    try {
      const r = await api('/api/questions/' + q.id, { method: 'PUT', body: fd });
      close(); onSaved(r.question); toast('Modificata ✓', 'ok');
    } catch (err) { fail(err); }
  };
  renderDrop(); ans(); dlg.showModal();
}

/* ------------------------------------------------------------ QUIZ */
const MODES = [
  { id: 'sim', name: 'Simulazione esame', desc: '30 domande · 20 minuti · max 3 errori · senza correzione' },
  { id: 'smart', name: 'Ripasso intelligente', desc: 'Più peso a ciò che sbagli di più e alle domande nuove' },
  { id: 'wrongest', name: 'Le più sbagliate', desc: 'Solo domande che hai già sbagliato, dalla peggiore' },
  { id: 'unseen', name: 'Mai viste', desc: 'Domande che non hai ancora provato nei quiz' },
  { id: 'topic', name: 'Per argomento', desc: 'Scegli un capitolo da ripassare' },
  { id: 'free', name: 'Libera', desc: 'Domande a caso tra tutte quelle salvate' },
];
let Q = null; // quiz in corso o appena concluso
try { Q = JSON.parse(localStorage.getItem('pq_quiz') || 'null'); } catch { }
const persistQ = () => { try { Q && !Q.done ? localStorage.setItem('pq_quiz', JSON.stringify(Q)) : localStorage.removeItem('pq_quiz'); } catch { } };
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

function viewQuiz() {
  if (Q && Q.done) return renderResults();
  if (Q) return renderRun();
  renderMenu();
}

async function renderMenu() {
  document.body.dataset.view = 'quiz';
  await loadTopics().catch(() => { });   // conteggi aggiornati
  let o = { mode: 'sim', count: 20, topic: '', immediate: true };
  try { o = { ...o, ...JSON.parse(localStorage.getItem('pq_opts') || '{}') }; } catch { }
  let total = 0;
  try { total = (await api('/api/questions?limit=1')).total; } catch { }
  view.innerHTML = `<div class="wrap narrow">
    <header class="ph"><h1>Quiz</h1><span class="muted small">${total} ${total === 1 ? 'domanda salvata' : 'domande salvate'}</span></header>
    <div id="mn" class="stack"></div></div>`;
  function draw() {
    const sim = o.mode === 'sim';
    $('#mn').innerHTML = `
      <div class="modes">${MODES.map(m => `<button class="mode${m.id === o.mode ? ' on' : ''}" data-m="${m.id}"><b>${m.name}</b><span>${m.desc}</span></button>`).join('')}</div>
      ${o.mode === 'topic' ? `<select id="qt">${topics.map(t => `<option value="${t.id}"${String(t.id) === String(o.topic) ? ' selected' : ''}>${esc(t.name)} (${t.count})</option>`).join('')}</select>` : ''}
      ${sim ? '' : `<div><div class="lbl">Numero di domande</div><div class="counts">${[10, 20, 30, 50, 0].map(n => `<button class="chip${o.count === n ? ' on' : ''}" data-n="${n}">${n || 'Tutte'}</button>`).join('')}</div></div>
      <label class="chk"><input type="checkbox" id="qi"${o.immediate ? ' checked' : ''}> Mostra subito se la risposta è giusta</label>`}
      <button class="btn primary big" id="go">Inizia</button>`;
  }
  draw();
  const mn = $('#mn');
  mn.onclick = e => {
    const m = e.target.closest('[data-m]'), n = e.target.closest('[data-n]');
    if (m) { o.mode = m.dataset.m; if (o.mode === 'topic' && !o.topic && topics[0]) o.topic = topics[0].id; draw(); }
    if (n) { o.count = +n.dataset.n; draw(); }
    if (e.target.closest('#go')) start();
  };
  mn.onchange = e => {
    if (e.target.id === 'qt') o.topic = e.target.value;
    if (e.target.id === 'qi') o.immediate = e.target.checked;
  };
  async function start() {
    localStorage.setItem('pq_opts', JSON.stringify(o));
    const p = new URLSearchParams({ mode: o.mode, count: o.count || 500 });
    if (o.mode === 'topic') p.set('topic_id', o.topic);
    try { await startQuiz(await api('/api/quiz?' + p), o.mode === 'sim' ? false : o.immediate); }
    catch (e) { fail(e); }
  }
}

async function startQuiz(data, immediate) {
  if (!data.questions.length) { toast('Nessuna domanda disponibile per questa modalità', 'warn'); return; }
  Q = { mode: data.mode, qs: data.questions, ans: {}, idx: 0, t0: Date.now(), limit: data.time_limit,
        maxErr: data.max_errors, immediate, done: false };
  persistQ();
  if (location.hash !== '#/quiz') location.hash = '#/quiz'; else renderRun();
}

function renderRun() {
  document.body.dataset.view = 'quiz-run';
  const n = Q.qs.length, pages = Math.ceil(n / 10);
  const q = Q.qs[Q.idx], page = Math.floor(Q.idx / 10);
  const given = Q.ans[q.id], locked = Q.immediate && given !== undefined;
  const stateOf = (x, i) => {
    const g = Q.ans[x.id];
    let c = i === Q.idx ? 'cur' : '';
    if (g !== undefined) c += Q.immediate ? (g === x.answer ? ' ok' : ' ko') : ' ans';
    return c;
  };
  const tabs = pages > 1 ? `<div class="tabs">${Array.from({ length: pages }, (_, p) =>
    `<button data-p="${p}" class="${p === page ? 'on' : ''}">Domande ${p * 10 + 1}-${Math.min(n, p * 10 + 10)}</button>`).join('')}</div>` : '<div class="tabs" style="display:none"></div>';
  const nums = Q.qs.slice(page * 10, page * 10 + 10).map((x, j) => {
    const i = page * 10 + j; return `<button data-i="${i}" class="${stateOf(x, i)}">${i + 1}</button>`; }).join('');
  const btn = (a, lab) => {
    let c = 'qb';
    if (given === a) c += ' sel';
    if (locked && q.answer === a) c += ' right';
    return `<button class="${c}" data-a="${a}" ${locked ? 'disabled' : ''}><i>${a ? 'V' : 'F'}</i>${lab}</button>`;
  };
  const fb = locked ? (given === q.answer
    ? '<div class="fb ok">Corretto</div>' : `<div class="fb ko">Sbagliato — la risposta giusta è ${q.answer ? 'VERO' : 'FALSO'}</div>`) : '';
  const last = Q.idx === n - 1;
  view.innerHTML = `<div class="qz${q.image ? '' : ' noimg'}">
    <div class="qtop"><button class="iconbtn" id="quit" title="Esci">${ico('x')}</button>
      <span class="tt">${esc((MODES.find(m => m.id === Q.mode) || {}).name || 'Quiz')}</span><span class="timer" id="timer">--:--</span></div>
    ${tabs}<div class="nums">${nums}</div>
    ${q.image ? `<div class="pimg"><img src="${q.image}" alt=""></div>` : ''}
    <div class="pbody"><span class="no">${Q.idx + 1}</span><p>${esc(q.text)}</p>${fb}</div>
    <div class="ptf">${btn(1, 'Vero')}${btn(0, 'Falso')}</div>
    <div class="qbar"><button class="btn" id="finish">Termina quiz</button>
      <div class="grp"><button class="btn" id="prev" ${Q.idx === 0 ? 'disabled' : ''}>${ico('left', 20)}</button>
        <button class="btn${last ? '' : ' primary'}" id="next" ${last ? 'disabled' : ''}>${ico('right', 20)}</button></div></div></div>`;
  const go = i => { Q.idx = Math.max(0, Math.min(n - 1, i)); persistQ(); renderRun(); };
  const answer = a => {
    if (locked) return;
    Q.ans[q.id] = a; persistQ(); renderRun();
  };
  view.onclick = e => {
    const t = e.target;
    if (t.closest('[data-p]')) go(+t.closest('[data-p]').dataset.p * 10);
    else if (t.closest('[data-i]')) go(+t.closest('[data-i]').dataset.i);
    else if (t.closest('.qb')) answer(+t.closest('.qb').dataset.a);
    else if (t.closest('#prev')) go(Q.idx - 1);
    else if (t.closest('#next')) go(Q.idx + 1);
    else if (t.closest('#finish')) finishQuiz(false);
    else if (t.closest('#quit')) {
      if (confirm('Abbandonare il quiz? I progressi andranno persi.')) { Q = null; persistQ(); stopTimer(); renderMenu(); document.body.dataset.view = 'quiz'; }
    }
  };
  keyHandler = e => {
    if (e.target.matches('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'v') answer(1); else if (k === 'f') answer(0);
    else if (e.key === 'ArrowRight' || e.key === 'Enter') go(Q.idx + 1);
    else if (e.key === 'ArrowLeft') go(Q.idx - 1);
  };
  stopTimer();
  const tick = () => {
    const el = $('#timer'); if (!el) return;
    const el_s = (Date.now() - Q.t0) / 1000;
    if (Q.limit) {
      const left = Q.limit - el_s;
      el.textContent = fmtTime(left); el.classList.toggle('low', left < 120);
      if (left <= 0) { stopTimer(); finishQuiz(true); }
    } else el.textContent = fmtTime(el_s);
  };
  tick(); timerId = setInterval(tick, 500);
}

async function finishQuiz(auto) {
  const un = Q.qs.filter(x => Q.ans[x.id] === undefined).length;
  if (!auto && un && !confirm(`Hai ${un} domand${un === 1 ? 'a' : 'e'} senza risposta (contano come errori). Terminare?`)) return;
  stopTimer();
  const duration = Math.round((Date.now() - Q.t0) / 1000);
  try {
    const res = await api('/api/quiz/finish', { json: {
      mode: Q.mode, duration: Q.limit ? Math.min(duration, Q.limit) : duration, max_errors: Q.maxErr,
      question_ids: Q.qs.map(x => x.id),
      answers: Object.entries(Q.ans).map(([id, a]) => ({ question_id: +id, answer: a })) } });
    Q.done = true; Q.res = res; persistQ();
    if (location.hash !== '#/quiz') location.hash = '#/quiz'; else renderResults();
    loadTopics();
  } catch (e) { fail(e); if (auto) renderRun(); }
}

function renderResults() {
  document.body.dataset.view = 'quiz';
  keyHandler = null; stopTimer();
  const r = Q.res;
  const verdict = r.passed === null ? '' : `<div class="verdict ${r.passed ? 'ok' : 'ko'}">${r.passed ? 'PROMOSSO' : 'BOCCIATO'}</div>`;
  const sub = r.max_errors != null ? `${r.errors} error${r.errors === 1 ? 'e' : 'i'} (massimo ${r.max_errors})` : `${r.errors} error${r.errors === 1 ? 'e' : 'i'}`;
  view.innerHTML = `<div class="wrap narrow">
    <div class="card score"><div class="big">${r.correct}<span class="muted">/${r.total}</span></div>
      <div class="muted">${sub}${r.unanswered ? ` · ${r.unanswered} senza risposta` : ''} · ${fmtTime(r.duration)}</div>${verdict}</div>
    <div class="row" style="margin:14px 0">
      ${r.wrong.length ? '<button class="btn primary" id="redo">Rifai gli errori</button>' : ''}
      <button class="btn" id="newq">Nuovo quiz</button></div>
    ${r.wrong.length ? '<h2>Da rivedere</h2>' : '<div class="empty">Nessun errore, ottimo lavoro!</div>'}
    ${r.wrong.map(w => `<div class="wq">${w.image ? `<div class="thumb"><img src="${w.image}" alt=""></div>` : ''}
      <div class="ibody"><div>${esc(w.text)}</div><div class="meta">
        <span>Tua risposta: <b>${w.given === null ? 'nessuna' : w.given ? 'Vero' : 'Falso'}</b></span>
        <span>Corretta: <span class="badge ${w.answer ? 'v' : 'f'}">${w.answer ? 'Vero' : 'Falso'}</span></span></div></div></div>`).join('')}</div>`;
  const redo = $('#redo');
  if (redo) redo.onclick = async () => {
    try { const ids = r.wrong.map(w => w.id).join(','); Q = null; await startQuiz(await api('/api/quiz?mode=ids&ids=' + ids), true); }
    catch (e) { fail(e); }
  };
  $('#newq').onclick = () => { Q = null; persistQ(); renderMenu(); };
}

/* ------------------------------------------------------------ STATISTICHE */
async function viewStats() {
  view.innerHTML = '<div class="wrap"><header class="ph"><h1>Statistiche</h1></header><div class="empty">Carico…</div></div>';
  let s;
  try { s = await api('/api/stats'); } catch (e) { return fail(e); }
  const kpi = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  const cls = a => a == null ? '' : a < .5 ? 'low' : a < .75 ? 'mid' : '';
  const maxAct = Math.max(1, ...s.activity.map(a => a.count));
  view.innerHTML = `<div class="wrap">
    <header class="ph"><h1>Statistiche</h1></header>
    <div class="kpis">
      ${kpi(s.questions, 'Domande salvate')}${kpi(pct(s.accuracy), 'Risposte corrette')}
      ${kpi(s.sessions_total, 'Quiz svolti')}${kpi(s.sim_total ? `${s.sim_passed}/${s.sim_total}` : '–', 'Simulazioni superate')}
      ${kpi(s.review, 'Da ripassare')}${kpi(s.mastered, 'Padroneggiate (3 giuste di fila)')}
      ${kpi(s.unseen, 'Mai viste')}${kpi(s.streak_days, 'Giorni di fila')}</div>
    <div class="grid2">
      <div class="card"><h2>Ultimi quiz <span class="muted small">(% corrette)</span></h2>${trend(s.sessions)}</div>
      <div class="card"><h2>Attività <span class="muted small">(risposte, ultimi 14 giorni)</span></h2>
        <div class="act">${s.activity.map(a => `<i class="${a.count ? '' : 'z'}" style="height:${a.count ? Math.max(6, a.count / maxAct * 100) : 3}%" title="${a.day}: ${a.count}"></i>`).join('')}</div></div></div>
    <div class="grid2">
      <div class="card"><h2>Per argomento</h2>${s.topics.length ? s.topics.map(t => `<div class="bar"><span class="n" title="${esc(t.name)}">${esc(t.name)} <span class="muted">(${t.count})</span></span>
        <span class="t"><i class="${cls(t.accuracy)}" style="width:${t.accuracy == null ? 0 : Math.round(t.accuracy * 100)}%"></i></span><span class="p">${pct(t.accuracy)}</span></div>`).join('') : '<div class="muted">Nessun dato</div>'}</div>
      <div class="card"><h2>Le più ostiche</h2>${s.hardest.length ? s.hardest.map(q => `<div class="hard"><span>${esc(q.text)}</span><span class="muted">✗${q.wrong}/${q.seen}</span></div>`).join('') : '<div class="muted">Fai qualche quiz per vederle qui</div>'}</div></div>
  </div>`;
}

function trend(sessions) {
  if (!sessions.length) return '<div class="muted">Nessun quiz ancora</div>';
  const W = 600, H = 170, P = 26, n = sessions.length;
  const x = i => P + (n === 1 ? (W - 2 * P) / 2 : i * (W - 2 * P) / (n - 1));
  const y = v => H - P - v * (H - 2 * P);
  const pts = sessions.map((s, i) => [x(i), y(s.total ? s.correct / s.total : 0), s]);
  const grid = [0, .5, 1].map(v => `<line x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="2" y="${y(v) + 3}">${v * 100}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${grid}
    <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts.map(p => p[0] + ',' + p[1]).join(' ')}"/>
    ${pts.map(([px, py, s]) => `<circle cx="${px}" cy="${py}" r="4.5" fill="${s.passed === 0 ? 'var(--bad)' : 'var(--accent)'}"><title>${s.correct}/${s.total} · ${new Date(s.ts * 1000).toLocaleDateString('it-IT')}</title></circle>`).join('')}</svg>`;
}

/* ------------------------------------------------------------ IMPOSTAZIONI */
async function viewSettings() {
  await loadTopics().catch(() => { });
  view.innerHTML = `<div class="wrap narrow stack">
    <header class="ph"><h1>Altro</h1></header>
    <div class="card"><h2>Argomenti</h2>
      <p class="muted small" style="margin-top:-4px">Le parole chiave (separate da virgola) servono a suggerire l'argomento mentre scrivi una domanda.</p>
      <div id="trows"></div>
      <form class="trow" id="tnew"><input type="text" name="name" placeholder="Nuovo argomento" required><input type="text" name="keywords" placeholder="parole, chiave">
        <button class="btn sm primary">Aggiungi</button></form></div>
    <div class="card"><h2>Backup</h2>
      <p class="muted small" style="margin-top:-4px">Zip con domande, immagini, statistiche e argomenti. L'importazione unisce i dati senza duplicare le domande già presenti.</p>
      <div class="row"><a class="btn" href="/api/export" download>Esporta backup</a>
        <label class="btn">Importa backup<input type="file" id="imp" accept=".zip" hidden></label></div></div>
    <div class="card"><h2>Sessione</h2><button class="btn danger" id="logout">Esci</button></div>
  </div>`;
  const rows = () => {
    $('#trows').innerHTML = topics.map(t => `<form class="trow" data-id="${t.id}">
      <input type="text" name="name" value="${esc(t.name)}" required><input type="text" name="keywords" value="${esc(t.keywords)}" placeholder="parole, chiave">
      <div class="row"><button class="btn sm" data-s="save">Salva</button><button type="button" class="iconbtn" data-s="del" title="Elimina (${t.count} domande)">${ico('trash', 18)}</button></div></form>`).join('');
  };
  rows();
  $('#trows').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, id = f.dataset.id;
    try { await api('/api/topics/' + id, { method: 'PUT', json: { name: f.name.value, keywords: f.keywords.value } }); await loadTopics(); toast('Salvato', 'ok'); }
    catch (err) { fail(err); }
  };
  $('#trows').onclick = async e => {
    const b = e.target.closest('[data-s="del"]'); if (!b) return;
    const id = b.closest('form').dataset.id, t = topics.find(x => x.id === +id);
    if (!confirm(`Eliminare "${t.name}"? Le ${t.count} domande restano, senza argomento.`)) return;
    try { await api('/api/topics/' + id, { method: 'DELETE' }); await loadTopics(); rows(); } catch (err) { fail(err); }
  };
  $('#tnew').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try { await api('/api/topics', { json: { name: f.name.value, keywords: f.keywords.value } }); await loadTopics(); rows(); f.reset(); }
    catch (err) { fail(err); }
  };
  $('#imp').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try { const r = await api('/api/import', { method: 'POST', body: fd }); toast(`Importate ${r.added} domande (${r.skipped} già presenti)`, 'ok'); await loadTopics(); rows(); }
    catch (err) { fail(err); }
    e.target.value = '';
  };
  $('#logout').onclick = async () => { try { await api('/api/logout', { method: 'POST' }); } catch { } view = null; showLogin(); };
}

/* ------------------------------------------------------------ avvio */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
boot();
