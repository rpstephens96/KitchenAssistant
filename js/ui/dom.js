// Shared UI helpers: bottom sheet, toast with undo.
export { escapeHtml as esc } from '../core/util.js';

const sheetRoot = () => document.getElementById('sheet-root');
const sheetBody = () => document.getElementById('sheet-body');
const sheetEl = () => sheetRoot().querySelector('.sheet');
let sheetRender = null;
let lastFocus = null;

/** Opens a bottom sheet. `render` returns HTML and re-runs whenever state changes. */
export function openSheet(render, { focus = true, tall = false } = {}) {
  lastFocus = document.activeElement;
  sheetRender = render;
  sheetEl().classList.toggle('tall', tall);
  sheetBody().innerHTML = render();
  sheetRoot().hidden = false;
  document.body.style.overflow = 'hidden';
  if (focus) requestAnimationFrame(() => sheetBody().querySelector('[autofocus], input, button')?.focus({ preventScroll: true }));
}

export function refreshSheet({ toBottom = false, toTop = false } = {}) {
  if (!sheetRender || sheetRoot().hidden) return;
  const active = document.activeElement;
  const keepId = active && sheetBody().contains(active) ? active.id : null;
  const scroller = sheetEl();
  const scroll = scroller.scrollTop;
  sheetBody().innerHTML = sheetRender();
  scroller.scrollTop = toBottom ? scroller.scrollHeight : toTop ? 0 : scroll;
  if (keepId) document.getElementById(keepId)?.focus({ preventScroll: true });
}

export function closeSheet() {
  sheetRoot().hidden = true;
  sheetRender = null;
  sheetBody().innerHTML = '';
  document.body.style.overflow = '';
  lastFocus?.focus?.({ preventScroll: true });
}

export const sheetOpen = () => !sheetRoot().hidden;

let toastTimer;
export function toast(message, { undo = null, ms = 5000 } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${message}</span>${undo ? '<button type="button" id="toast-undo">Undo</button>' : ''}`;
  el.hidden = false;
  if (undo) el.querySelector('#toast-undo').onclick = () => { undo(); el.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

export function sheetHeader(emoji, title, sub = '') {
  return `<div class="sheet-head"><span class="em" aria-hidden="true">${emoji}</span><div><h2 id="sheet-title">${title}</h2>${sub ? `<div class="muted">${sub}</div>` : ''}</div></div>`;
}
