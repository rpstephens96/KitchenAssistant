// "Shop" — aisle-grouped list with big tap-to-tick rows.
import { esc } from './dom.js';
import { groupByAisle } from '../core/shopping.js';
import { AISLE_EMOJI } from '../data/ingredients.js';
import { addToShopping, putAway, linesFromShoppingList } from '../core/kitchen.js';
import { nowISO } from '../core/util.js';
import { generateList } from './plan.js';
import { openScan } from './scan.js';

export const title = () => 'Shopping list';
export function subtitle(ctx) {
  const items = ctx.store.state.shopping.items;
  return items.length ? `${items.filter((i) => !i.checked).length} left to get` : 'Generated from your meal plan';
}

const addForm = () => `<form class="qa-form" data-submit="shop-add" autocomplete="off" style="margin-bottom:6px">
  <input class="input" name="q" id="shop-q" placeholder="Add anything… e.g. kitchen roll, 2 lemons" aria-label="Add to shopping list">
  <button class="qa-go" type="submit" aria-label="Add">+</button></form>`;

export function render(ctx) {
  const items = ctx.store.state.shopping.items;
  const done = items.filter((i) => i.checked).length;
  if (!items.length) {
    return `<div class="empty"><div class="big">🛒</div><p>Your list is empty.</p>
      <button type="button" class="btn primary" data-action="plan-shop">✨ Make list from this week's plan</button></div>${addForm()}`;
  }
  return `
  <div class="shop-head">
    <span class="progress-ring">${done} / ${items.length} in the trolley</span>
    <button type="button" class="btn ghost" style="margin-left:auto" data-action="plan-shop">↻ Update from plan</button>
  </div>
  ${addForm()}
  ${groupByAisle(items).map(([aisle, list]) => `
    <section class="aisle"><h3>${AISLE_EMOJI[aisle] || '🛒'} ${aisle} <span class="muted">${list.filter((i) => !i.checked).length}</span></h3>
      ${list.map((i) => `<button type="button" class="check-row ${i.checked ? 'checked' : ''}" data-action="shop-toggle" data-id="${i.id}" aria-pressed="${i.checked}">
        <span class="box" aria-hidden="true">✓</span>
        <span class="em" aria-hidden="true">${i.emoji}</span>
        <span class="txt"><span class="nm">${esc(i.name)}</span>
          ${i.note ? `<span class="src">${esc(i.note)}</span>` : ''}
          ${i.sources?.length ? `<span class="src">For ${esc(i.sources.join(', '))}</span>` : ''}</span>
        <span class="qty-pill">${esc(i.display || '')}${i.packHint ? `<small>${esc(i.packHint)}</small>` : ''}</span>
      </button>`).join('')}
    </section>`).join('')}
  <div class="shop-foot">
    <button type="button" class="btn grow" data-action="shop-done">🧾 Done shopping</button>
    <button type="button" class="btn primary grow" data-action="shop-putaway" ${done ? '' : 'disabled'}>📥 Put ticked away</button>
  </div>`;
}

export const actions = {
  'shop-toggle': (el, ev, ctx) => ctx.store.update((s) => {
    const it = s.shopping.items.find((i) => i.id === el.dataset.id);
    if (it) { it.checked = !it.checked; it.updatedAt = nowISO(); }
  }),
  'shop-done': (el, ev, ctx) => openScan(ctx),
  'shop-putaway': (el, ev, ctx) => {
    const lines = linesFromShoppingList(ctx.store.state.shopping.items.filter((i) => i.checked));
    ctx.store.update((s) => { putAway(s, lines, { tombstone: (id) => ctx.store.tombstone(id) }); }, { label: '📥 Put away — your kitchen is updated' });
  },
  'plan-shop': (el, ev, ctx) => generateList(ctx),
};

export const submits = {
  'shop-add': (form, ev, ctx) => {
    const text = form.q.value.trim();
    if (!text) return;
    ctx.store.update((s) => { addToShopping(s, text); }, { label: 'Added to list' });
    requestAnimationFrame(() => document.getElementById('shop-q')?.focus());
  },
};
