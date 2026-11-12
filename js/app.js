// App bootstrap: 4-tab routing, event delegation, re-render on state change.
import { store, KEY, migrate } from './store.js';
import { closeSheet, refreshSheet, toast, sheetOpen } from './ui/dom.js';
import * as inventory from './ui/inventory.js';
import * as cook from './ui/recipes.js';
import * as plan from './ui/plan.js';
import * as shop from './ui/shop.js';
import * as settings from './ui/settings.js';
import * as scan from './ui/scan.js';
import * as assistant from './ui/assistant.js';
import { weekStartOf } from './core/util.js';
import { setCustomIngredients } from './core/normalizer.js';

const views = { inventory, cook, plan, shop };
const modules = [inventory, cook, plan, shop, settings, scan, assistant];
const merge = (key) => Object.assign({}, ...modules.map((m) => m[key] || {}));
const actions = { ...merge('actions'), undo: () => doUndo(), tab: (el) => go(el.dataset.tab), 'sheet-close': () => closeSheet() };
const inputs = merge('inputs');
const changes = merge('changes');
const submits = merge('submits');

const ui = { tab: sessionStorage.getItem('larder.tab') || 'inventory', invLoc: 'fridge', cookFilter: 'all', week: weekStartOf(), pickQuery: '' };
const ctx = { store, ui, render, toast };
const viewEl = document.getElementById('view');

function render() {
  const v = views[ui.tab] || inventory;
  sessionStorage.setItem('larder.tab', ui.tab);
  document.getElementById('page-title').textContent = v.title(ctx);
  document.getElementById('page-sub').textContent = v.subtitle(ctx);
  document.querySelectorAll('.tab').forEach((t) => { if (t.dataset.tab === ui.tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  const left = store.state.shopping.items.filter((i) => !i.checked).length;
  const badge = document.getElementById('shop-badge');
  badge.hidden = !left; badge.textContent = left;
  document.getElementById('undo-btn').hidden = !store.canUndo();
  viewEl.innerHTML = v.render(ctx);
  v.mount?.(viewEl, ctx);
}

function go(tab) {
  if (ui.tab === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  ui.tab = tab; render(); window.scrollTo({ top: 0 });
}

function doUndo() { if (store.undo()) toast('Undone ↶'); }

store.subscribe(({ label }) => {
  render();
  refreshSheet();
  if (label) toast(label, { undo: () => doUndo() });
});

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { ev.preventDefault(); fn(el, ev, ctx); }
});
document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-input]');
  if (el && inputs[el.dataset.input]) inputs[el.dataset.input](el, ev, ctx);
});
document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-change]');
  if (el && changes[el.dataset.change]) changes[el.dataset.change](el, ev, ctx);
});
document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('[data-submit]');
  if (!form) return;
  ev.preventDefault();
  submits[form.dataset.submit]?.(form, ev, ctx);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && sheetOpen()) closeSheet();
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { ev.preventDefault(); doUndo(); }
});
window.addEventListener('storage', (e) => {
  if (e.key === KEY && e.newValue) { store.state = migrate(JSON.parse(e.newValue)); setCustomIngredients(store.state.customIngredients); render(); }
});

render();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
