'use strict';
/* Costruzione del DOM senza innerHTML.
 * Tutti i testi passano da nodi di testo (textContent): non possono mai essere
 * interpretati come HTML, qualunque sia la loro origine (server, localStorage, ...). */

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyProps(node, props) {
  if (!props) return;
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.setAttribute('class', String(value));
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') {
      for (const dk of Object.keys(value)) node.dataset[dk] = String(value[dk]);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'hidden') {
      node[key] = value;   // proprietà DOM (campi di input, bottoni)
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
}

function appendChildren(node, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (Array.isArray(child)) appendChildren(node, child);
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

/** Elemento HTML:  h('div', {class: 'x', onclick: fn}, 'testo', altroNodo, [liste...]) */
export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  applyProps(node, props);
  appendChildren(node, children);
  return node;
}

/** Elemento SVG (stessa firma di h) */
export function s(tag, props, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  applyProps(node, props);
  appendChildren(node, children);
  return node;
}

/** Sostituisce il contenuto di un nodo */
export function mount(parent, ...children) {
  const frag = document.createDocumentFragment();
  appendChildren(frag, children);
  parent.replaceChildren(frag);
  return parent;
}

/** Accetta solo URL di immagini salvate dall'app (/media/<hash>.<ext>) */
const IMAGE_URL_RE = /^\/media\/[a-f0-9]{16}\.(?:jpg|png|webp|gif)$/;
export const safeImageUrl = url => (typeof url === 'string' && IMAGE_URL_RE.test(url) ? url : '');

/* ------------------------------------------------------------ icone */
const ICONS = {
  add: [['path', { d: 'M12 5v14M5 12h14' }]],
  quiz: [['path', { d: 'M7 4.5v15l12-7.5z' }]],
  library: [['path', { d: 'M4 6h16M4 12h16M4 18h10' }]],
  stats: [['path', { d: 'M5 20V11M12 20V4M19 20v-6' }]],
  settings: [['path', { d: 'M4 7h9M17 7h3M4 17h3M11 17h9' }], ['circle', { cx: 15, cy: 7, r: 2 }], ['circle', { cx: 9, cy: 17, r: 2 }]],
  edit: [['path', { d: 'M4 20h4L19 9l-4-4L4 16z' }]],
  trash: [['path', { d: 'M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3' }]],
  x: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  left: [['path', { d: 'M15 5l-7 7 7 7' }]],
  right: [['path', { d: 'M9 5l7 7-7 7' }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  img: [['rect', { x: 4, y: 5, width: 16, height: 14, rx: 2 }], ['circle', { cx: 9, cy: 10, r: 1.5 }], ['path', { d: 'M5 18l5-5 4 4 2-2 3 3' }]],
  table: [['rect', { x: 4, y: 5, width: 16, height: 14, rx: 2 }], ['path', { d: 'M4 10h16M4 15h16M10 5v14' }]],
  chart: [['path', { d: 'M4 17l5-6 4 3 7-9' }]],
  logo: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M8.2 12.4l2.6 2.6 5-5.6' }]],
};

export function icon(name, size = 22) {
  const svg = s('svg', {
    class: 'ico', width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  for (const [tag, attrs] of ICONS[name] || []) svg.appendChild(s(tag, attrs));
  return svg;
}
