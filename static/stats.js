'use strict';
/* Pagina Statistiche: composizione dei grafici (vedi charts.js). */

import { h, mount } from './dom.js';
import { chartCard, lineChart, stackedColumns, simColumns, heatmap, segBar, rankBars, MODE_NAMES } from './charts.js';

const RANGES = [7, 30, 90];
const pct = v => Math.round(v * 100) + '%';
const dateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const parseDay = str => { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); };

function loadRange() {
  try { const v = Number(localStorage.getItem('sc_range')); return RANGES.includes(v) ? v : 30; } catch { return 30; }
}
function saveRange(v) { try { localStorage.setItem('sc_range', String(v)); } catch { /* ignora */ } }

export async function renderStats(view, { api, fail, startTopicQuiz }) {
  mount(view, h('div', { class: 'wrap' }, h('header', { class: 'ph' }, h('h1', null, 'Statistiche')), h('div', { class: 'empty' }, 'Carico…')));
  let st;
  try { st = await api('/api/stats'); } catch (e) { fail(e); return; }

  if (!st.questions && !st.sessions_total) {
    mount(view, h('div', { class: 'wrap' }, h('header', { class: 'ph' }, h('h1', null, 'Statistiche')),
      h('div', { class: 'card empty' }, h('p', null, 'Qui vedrai i tuoi progressi.'),
        h('p', { class: 'muted' }, 'Salva qualche domanda sbagliata e fai un quiz.'),
        h('a', { class: 'btn primary', href: '#/add' }, 'Aggiungi una domanda'))));
    return;
  }

  let range = loadRange();
  const trend = h('div', { class: 'grid2' });
  const summary = h('p', { class: 'muted small period' });

  /* ---- sezione "Andamento": dipende dal periodo scelto ---- */
  function drawTrend() {
    const days = st.daily.slice(-range);
    const since = Date.now() / 1000 - range * 86400;
    const sessions = st.sessions.filter(q => q.ts >= since);
    const sims = sessions.filter(q => q.mode === 'sim').map(q => ({
      ts: q.ts, total: q.total, correct: q.correct, errors: q.errors, passed: q.passed === 1,
      limit: q.total >= 30 ? 3 : Math.floor(q.total / 10),
    }));
    const answers = days.reduce((a, d) => a + d.correct + d.wrong, 0);
    const right = days.reduce((a, d) => a + d.correct, 0);
    mount(summary, answers
      ? `Negli ultimi ${range} giorni: ${answers} risposte, ${pct(right / answers)} corrette, ${sessions.length} quiz`
      : `Negli ultimi ${range} giorni non hai ancora risposto a nessuna domanda`);

    mount(trend,
      chartCard({
        title: 'Punteggio dei quiz', sub: '% di risposte corrette per quiz',
        empty: sessions.length ? null : 'Nessun quiz in questo periodo.',
        draw: host => lineChart(host, { points: sessions, threshold: sessions.some(q => q.mode === 'sim') ? 90 : null }),
        table: () => ({
          cols: ['Data', 'Modalità', 'Giuste', 'Domande', '%'],
          rows: sessions.map(q => [dateTimeFmt.format(new Date(q.ts * 1000)), MODE_NAMES[q.mode] || q.mode, q.correct, q.total, q.total ? pct(q.correct / q.total) : '–']),
        }),
      }),
      chartCard({
        title: 'Risposte al giorno', sub: 'giuste e sbagliate',
        legend: [{ cls: 'fill-ok', label: 'Giuste' }, { cls: 'fill-bad', label: 'Sbagliate' }],
        draw: host => stackedColumns(host, { days }),
        table: () => ({
          cols: ['Giorno', 'Giuste', 'Sbagliate', '% corrette'],
          rows: days.filter(d => d.correct + d.wrong).map(d => [dateFmt.format(parseDay(d.day)), d.correct, d.wrong, pct(d.correct / (d.correct + d.wrong))]),
        }),
      }),
      chartCard({
        wide: true, title: 'Simulazioni d\'esame', sub: 'errori per simulazione',
        legend: [{ cls: 'fill-ok', label: 'Superata' }, { cls: 'fill-bad', label: 'Non superata' }],
        empty: sims.length ? null : 'Nessuna simulazione in questo periodo. Provane una dal menu Quiz.',
        draw: host => simColumns(host, { sims }),
        table: () => ({
          cols: ['Data', 'Errori', 'Limite', 'Esito'],
          rows: sims.map(q => [dateTimeFmt.format(new Date(q.ts * 1000)), q.errors, q.limit, q.passed ? 'Superata' : 'Non superata']),
        }),
      }));
  }

  const rangeCtl = h('div', { class: 'seg-ctl', role: 'group', 'aria-label': 'Periodo' }, RANGES.map(r => {
    const b = h('button', { type: 'button', class: r === range ? 'on' : '', 'aria-pressed': String(r === range) }, `${r} giorni`);
    b.onclick = () => {
      range = r; saveRange(r);
      for (const x of rangeCtl.children) { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }
      drawTrend();
    };
    return b;
  }));

  /* ---- panoramica ---- */
  const states = [
    { cls: 'ok', label: 'Padroneggiate', value: st.mastered, hint: '3 giuste di fila' },
    { cls: 'learn', label: 'In apprendimento', value: st.learning, hint: 'mai sbagliate finora' },
    { cls: 'bad', label: 'Da ripassare', value: st.review, hint: 'sbagliate di recente' },
    { cls: 'mute', label: 'Mai viste', value: st.unseen, hint: 'non ancora nei quiz' },
  ];
  const hero = h('section', { class: 'card hero' },
    h('div', { class: 'hero-n' },
      h('div', { class: 'big' }, st.accuracy == null ? '–' : pct(st.accuracy)),
      h('div', { class: 'muted' }, st.attempts ? `risposte corrette su ${st.attempts}` : 'nessuna risposta ancora')),
    h('div', { class: 'hero-s' },
      h('h2', null, 'Stato delle domande'),
      segBar(states, 'Stato delle domande salvate'),
      h('ul', { class: 'states' }, states.map(x => h('li', null,
        h('i', { class: 'key sq ' + x.cls }), h('span', { class: 'sl' }, x.label), h('b', null, String(x.value)),
        h('span', { class: 'muted small sh' }, st.questions ? pct(x.value / st.questions) : '')))),
    ));
  const tile = (value, label) => h('div', { class: 'tile' }, h('b', null, String(value)), h('span', null, label));
  const tiles = h('div', { class: 'tiles' },
    tile(st.questions, 'Domande salvate'),
    tile(st.sessions_total, 'Quiz svolti'),
    tile(st.sim_total ? `${st.sim_passed}/${st.sim_total}` : '–', 'Simulazioni superate'),
    tile(st.streak_days, st.streak_days === 1 ? 'Giorno di fila' : 'Giorni di fila'));

  /* ---- calendario e argomenti (non dipendono dal periodo) ---- */
  const activeDays = st.daily.filter(d => d.correct + d.wrong > 0).length;
  const calendar = chartCard({
    wide: true, title: 'Giorni di allenamento', sub: `ultimi ${Math.round(st.daily.length / 30)} mesi · ${activeDays} ${activeDays === 1 ? 'giorno' : 'giorni'} con risposte`,
    legend: [{ cls: 'h0', label: 'Nessuna risposta' }, { cls: 'h2', label: 'Poche' }, { cls: 'h4', label: 'Tante' }],
    draw: host => heatmap(host, { days: st.daily }),
    table: () => ({
      cols: ['Giorno', 'Giuste', 'Sbagliate'],
      rows: st.daily.filter(d => d.correct + d.wrong).map(d => [dateFmt.format(parseDay(d.day)), d.correct, d.wrong]),
    }),
  });

  const topics = [...st.topics].sort((a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2));
  const topicsCard = h('section', { class: 'card' },
    h('h3', null, 'Precisione per argomento'),
    h('p', { class: 'muted small' }, 'dal più debole · tocca un argomento per ripassarlo'),
    topics.length ? rankBars(topics.map(t => ({ id: t.id, label: t.name, note: ` (${t.count})`, value: t.accuracy })), t => startTopicQuiz(t.id))
      : h('p', { class: 'muted' }, 'Assegna un argomento alle domande per vedere come vai in ciascun capitolo.'));
  const hardest = h('section', { class: 'card' },
    h('h3', null, 'Le più ostiche'),
    h('p', { class: 'muted small' }, 'le domande che sbagli più spesso'),
    st.hardest.length ? h('ol', { class: 'hard' }, st.hardest.map(q => h('li', null,
      h('span', { class: 'ht' }, q.text), h('span', { class: 'hv muted' }, `${q.wrong} su ${q.seen}`))))
      : h('p', { class: 'muted' }, 'Dopo qualche quiz compariranno qui le domande che sbagli più spesso.'));

  drawTrend();
  mount(view, h('div', { class: 'wrap' },
    h('header', { class: 'ph' }, h('h1', null, 'Statistiche')),
    hero, tiles,
    h('div', { class: 'sec-h' }, h('h2', null, 'Andamento'), rangeCtl),
    summary, trend, calendar,
    h('div', { class: 'sec-h' }, h('h2', null, 'Argomenti')),
    h('div', { class: 'grid2' }, topicsCard, hardest)));
}
