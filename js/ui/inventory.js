// "What's in" — fridge / freezer / cupboard.
import { esc, openSheet, closeSheet, sheetHeader } from './dom.js';
import { getIngredient, normalizeLine, suggestIngredients, formatQty, findIngredient } from '../core/normalizer.js';
import { isExpiring } from '../core/matching.js';
import { addStock, resolveText, LOCATION_LABEL } from '../core/kitchen.js';
import { STAPLE_IDS } from '../data/ingredients.js';
import { nowISO, isoDate, daysBetween } from '../core/util.js';
import { openScan } from './scan.js';

export const LOCATIONS = [
  { id: 'fridge', label: 'Fridge', emoji: '❄️' },
  { id: 'freezer', label: 'Freezer', emoji: '🧊' },
  { id: 'pantry', label: 'Cupboard', emoji: '🗄️' },
];
const LEVELS = ['full', 'half', 'low'];
const LEVEL_PCT = { full: 100, half: 50, low: 18 };

export const title = () => "What's in";
export function subtitle(ctx) {
  const n = ctx.store.state.inventory.filter((i) => isExpiring(i)).length;
  return n ? `${n} thing${n > 1 ? 's' : ''} to use up soon` : 'All fresh — nice';
}

function stepFor(item, ing) {
  const base = ing?.base || 'count';
  if (base === 'count' || base === 'tsp') return 1;
  if (base === 'ml') return item.qty >= 1000 ? 250 : 100;
  return item.qty >= 500 ? 100 : 50;
}

function expiryText(item) {
  if (item.expiresOn) {
    const d = daysBetween(isoDate(), item.expiresOn);
    if (d < 0) return 'Past date';
    if (d === 0) return 'Use today';
    if (d === 1) return 'Use by tomorrow';
    if (d <= 3) return `Use within ${d} days`;
  }
  return item.useSoon ? 'Use soon' : '';
}

function itemRow(item) {
  const ing = getIngredient(item.ingredientId);
  const soon = isExpiring(item);
  const control = item.qty == null
    ? `<button type="button" class="level ${item.level}" data-action="item-level" data-id="${item.id}" aria-label="${esc(item.name)} level ${item.level}, tap to change">
         <span>${item.level[0].toUpperCase() + item.level.slice(1)}</span><span class="gauge"><i style="width:${LEVEL_PCT[item.level]}%"></i></span></button>`
    : `<div class="stepper" role="group" aria-label="${esc(item.name)} amount">
         <button type="button" data-action="item-step" data-id="${item.id}" data-dir="-1" aria-label="Less">−</button>
         <output>${esc(formatQty(item.qty, ing?.base || 'count'))}</output>
         <button type="button" data-action="item-step" data-id="${item.id}" data-dir="1" aria-label="More">+</button></div>`;
  return `<li class="item ${soon ? 'soon' : ''}" data-id="${item.id}">
    <div class="swipe-under" aria-hidden="true">Remove</div>
    <div class="item-card" data-swipe="${item.id}">
      <button type="button" class="item-main" data-action="item-edit" data-id="${item.id}">
        <span class="em" aria-hidden="true">${item.emoji || ing?.emoji || '🛒'}</span>
        <span class="txt"><span class="nm">${esc(item.name)}</span>
          <span class="sub">${soon ? `<span class="tag-soon">● ${esc(expiryText(item) || 'Use soon')}</span>` : '<span>Fresh</span>'}</span></span>
      </button>
      ${control}
    </div></li>`;
}

export function render(ctx) {
  const { state } = ctx.store;
  const loc = ctx.ui.invLoc;
  const today = isoDate();
  const counts = Object.fromEntries(LOCATIONS.map((l) => [l.id, state.inventory.filter((i) => i.location === l.id).length]));
  const soon = state.inventory.filter((i) => isExpiring(i, today));
  const items = state.inventory.filter((i) => i.location === loc)
    .sort((a, b) => (isExpiring(b, today) - isExpiring(a, today)) || a.name.localeCompare(b.name));
  const haveIds = new Set(state.inventory.map((i) => i.ingredientId));
  const staples = STAPLE_IDS.map(getIngredient).filter(Boolean);

  return `
  <button type="button" class="card scan-cta" data-action="scan-open">
    <span class="em" aria-hidden="true">🧾</span>
    <span class="txt"><span class="nm">Just been shopping?</span><span class="sub">Snap the receipt and we'll put it all away</span></span>
    <span class="chev" aria-hidden="true">›</span>
  </button>
  <section class="card quickadd" aria-label="Quick add">
    <form class="qa-form" data-submit="qa-add" autocomplete="off">
      <input class="input" id="qa-input" name="q" placeholder="Add food… e.g. 6 eggs, 500g mince" aria-label="Add food" data-input="qa-suggest" enterkeyhint="done">
      <button class="qa-go" type="submit" aria-label="Add">+</button>
    </form>
    <div id="qa-suggest" class="suggest"></div>
    <div class="chips staples" aria-label="One-tap staples">
      ${staples.map((s) => `<button type="button" class="chip" data-action="qa-staple" data-ing="${s.id}">${s.emoji} ${esc(s.name)}${haveIds.has(s.id) ? ' <span class="n">✓</span>' : ''}</button>`).join('')}
    </div>
  </section>

  ${soon.length ? `<div class="soon-strip"><span>⏰&nbsp;Use&nbsp;soon</span><div class="chips">
    ${soon.map((i) => `<button type="button" class="chip" data-action="item-edit" data-id="${i.id}">${i.emoji} ${esc(i.name)}</button>`).join('')}</div></div>` : ''}

  <div class="seg" role="group" aria-label="Storage location" style="margin-top:14px">
    ${LOCATIONS.map((l) => `<button type="button" data-action="inv-loc" data-loc="${l.id}" aria-pressed="${l.id === loc}">${l.emoji} ${l.label} <span class="count">${counts[l.id]}</span></button>`).join('')}
  </div>

  ${items.length ? `<ul class="items">${items.map(itemRow).join('')}</ul>
    <p class="muted hint">Tap an item to edit · swipe left to remove</p>`
    : `<div class="empty"><div class="big">${LOCATIONS.find((l) => l.id === loc).emoji}</div>Nothing here yet.<br>Scan a receipt, use the bar above or tap a staple.</div>`}`;
}

export function addToInventory(ctx, { text = null, ingredientId = null, qty = null }) {
  let ing;
  if (ingredientId) ing = getIngredient(ingredientId);
  else { const r = resolveText(text); ing = r.ing; if (r.qty != null) qty = r.qty; }
  if (!ing) return;
  const current = ctx.ui.invLoc;
  const loc = current === 'freezer' ? 'freezer' : ing.custom ? current : ing.store || current;
  ctx.store.update((s) => addStock(s, { ing, qty, location: loc }), { label: `Added ${esc(ing.name)} to ${LOCATION_LABEL[loc]}` });
  if (loc !== current) { ctx.ui.invLoc = loc; ctx.render(); }
}

function removeItem(ctx, id, verb = 'Removed') {
  const it = ctx.store.state.inventory.find((i) => i.id === id);
  if (!it) return;
  ctx.store.update((s) => { s.inventory = s.inventory.filter((i) => i.id !== id); ctx.store.tombstone(id); }, { label: `${verb} ${esc(it.name)}` });
}

function patchItem(ctx, id, fn) {
  ctx.store.update((s) => { const it = s.inventory.find((i) => i.id === id); if (it) { fn(it); it.updatedAt = nowISO(); } });
}

function editSheet(ctx, id) {
  return () => {
    const it = ctx.store.state.inventory.find((i) => i.id === id);
    if (!it) return '<p class="empty">Item removed.</p>';
    const ing = getIngredient(it.ingredientId) || { base: 'count' };
    const unit = { g: 'g', ml: 'ml', tsp: 'tsp', count: '' }[ing.base];
    const mode = it.qty == null ? 'level' : 'amount';
    return `${sheetHeader(it.emoji, esc(it.name), LOCATION_LABEL[it.location])}
      <div class="field"><span>How much is left?</span>
        <div class="seg" role="group"><button type="button" data-action="ie-mode" data-id="${id}" data-mode="level" aria-pressed="${mode === 'level'}">Rough level</button>
        <button type="button" data-action="ie-mode" data-id="${id}" data-mode="amount" aria-pressed="${mode === 'amount'}">Exact amount</button></div></div>
      ${mode === 'level'
        ? `<div class="big-choice" style="margin-bottom:14px">${LEVELS.map((l) => `<button type="button" data-action="ie-level" data-id="${id}" data-level="${l}" aria-pressed="${it.level === l}">${{ full: '🟢', half: '🟡', low: '🟠' }[l]} ${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}</div>`
        : `<div class="row" style="margin-bottom:14px"><div class="stepper grow" style="justify-content:space-between">
            <button type="button" data-action="item-step" data-id="${id}" data-dir="-1" aria-label="Less">−</button>
            <label class="row" style="gap:6px"><input id="ie-qty" class="input" style="width:110px;text-align:center" inputmode="decimal" type="number" min="0" step="any" value="${+(it.qty ?? 0).toFixed(1)}" data-change="ie-qty" data-id="${id}" aria-label="Amount">${unit}</label>
            <button type="button" data-action="item-step" data-id="${id}" data-dir="1" aria-label="More">+</button></div></div>`}
      <div class="field"><span>Where is it?</span><div class="big-choice">
        ${LOCATIONS.map((l) => `<button type="button" data-action="ie-loc" data-id="${id}" data-loc="${l.id}" aria-pressed="${it.location === l.id}">${l.emoji}<small>${l.label}</small></button>`).join('')}</div></div>
      <div class="field"><span>Freshness</span><div class="big-choice" style="grid-template-columns:1fr 1fr">
        <button type="button" data-action="ie-soon" data-id="${id}" data-soon="0" aria-pressed="${!isExpiring(it)}">🌿 Fresh</button>
        <button type="button" data-action="ie-soon" data-id="${id}" data-soon="1" aria-pressed="${isExpiring(it)}">⏰ Use soon</button></div></div>
      <label class="field"><span>Use-by date (optional)</span>
        <input type="date" class="input" id="ie-date" value="${it.expiresOn || ''}" data-change="ie-date" data-id="${id}"></label>
      <div class="sheet-actions"><button type="button" class="btn danger" data-action="ie-remove" data-id="${id}">🗑 Remove</button>
        <button type="button" class="btn primary" data-action="sheet-close">Done</button></div>`;
  };
}

export const actions = {
  'scan-open': (el, ev, ctx) => openScan(ctx),
  'inv-loc': (el, ev, ctx) => { ctx.ui.invLoc = el.dataset.loc; ctx.render(); },
  'qa-staple': (el, ev, ctx) => addToInventory(ctx, { ingredientId: el.dataset.ing }),
  'qa-pick': (el, ev, ctx) => {
    const input = document.getElementById('qa-input');
    const qtyPart = input.value.match(/^\s*([\d.,/½¼¾]+\s*(?:[a-zA-Z]{1,6}\b)?)/)?.[1] || '';
    const ing = getIngredient(el.dataset.ing);
    const n = qtyPart ? normalizeLine(`${qtyPart} ${ing.name}`) : null;
    addToInventory(ctx, n && n.ingredientId === ing.id && n.baseQty != null ? { ingredientId: ing.id, qty: n.baseQty } : { ingredientId: ing.id });
  },
  'item-edit': (el, ev, ctx) => openSheet(editSheet(ctx, el.dataset.id), { focus: false }),
  'item-level': (el, ev, ctx) => patchItem(ctx, el.dataset.id, (it) => { it.level = LEVELS[(LEVELS.indexOf(it.level) + 1) % 3]; }),
  'item-step': (el, ev, ctx) => {
    const it = ctx.store.state.inventory.find((i) => i.id === el.dataset.id);
    if (!it) return;
    const next = (it.qty ?? 0) + stepFor(it, getIngredient(it.ingredientId)) * +el.dataset.dir;
    if (next <= 0) { removeItem(ctx, it.id, 'Used up'); return; }
    patchItem(ctx, it.id, (x) => { x.qty = next; });
  },
  'ie-mode': (el, ev, ctx) => patchItem(ctx, el.dataset.id, (it) => {
    const ing = getIngredient(it.ingredientId);
    if (el.dataset.mode === 'level') { it.qty = null; it.level = it.level || 'full'; }
    else if (it.qty == null) { it.qty = ing?.pack?.size ?? (ing?.base === 'count' ? 1 : 100); it.level = null; }
  }),
  'ie-level': (el, ev, ctx) => patchItem(ctx, el.dataset.id, (it) => { it.level = el.dataset.level; }),
  'ie-loc': (el, ev, ctx) => { patchItem(ctx, el.dataset.id, (it) => { it.location = el.dataset.loc; }); ctx.ui.invLoc = el.dataset.loc; ctx.render(); },
  'ie-soon': (el, ev, ctx) => patchItem(ctx, el.dataset.id, (it) => { it.useSoon = el.dataset.soon === '1'; if (!it.useSoon) it.expiresOn = null; }),
  'ie-remove': (el, ev, ctx) => { closeSheet(); removeItem(ctx, el.dataset.id); },
};

export const changes = {
  'ie-qty': (el, ev, ctx) => { const v = parseFloat(el.value); if (Number.isFinite(v) && v >= 0) patchItem(ctx, el.dataset.id, (it) => { it.qty = v; }); },
  'ie-date': (el, ev, ctx) => patchItem(ctx, el.dataset.id, (it) => { it.expiresOn = el.value || null; }),
};

export const inputs = {
  'qa-suggest': (el) => {
    const box = document.getElementById('qa-suggest');
    const q = el.value.trim();
    if (q.length < 2) { box.innerHTML = ''; return; }
    const exact = findIngredient(q.replace(/^[\d.,/½¼¾]+\s*[a-zA-Z]{0,5}\s+/, ''));
    const list = suggestIngredients(q.replace(/^[\d.,/½¼¾]+\s*(?:g|kg|ml|l)?\s*/i, ''), 5);
    if (exact && !list.includes(exact)) list.unshift(exact);
    box.innerHTML = list.slice(0, 5).map((i) => `<button type="button" data-action="qa-pick" data-ing="${i.id}"><span>${i.emoji}</span>${esc(i.name)}<small>${LOCATION_LABEL[i.store] || ''}</small></button>`).join('');
  },
};

export const submits = {
  'qa-add': (form, ev, ctx) => {
    const text = form.q.value.trim();
    if (!text) return;
    addToInventory(ctx, { text });
    requestAnimationFrame(() => document.getElementById('qa-input')?.focus());
  },
};

export function mount(root, ctx) {
  root.querySelectorAll('[data-swipe]').forEach((card) => {
    let x0 = null; let y0 = null; let dx = 0; let locked = false;
    card.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; x0 = e.clientX; y0 = e.clientY; dx = 0; locked = false; });
    card.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      const ddx = e.clientX - x0; const ddy = e.clientY - y0;
      if (!locked && Math.abs(ddy) > 10 && Math.abs(ddy) > Math.abs(ddx)) { x0 = null; return; }
      if (Math.abs(ddx) > 10) { locked = true; card.classList.add('dragging'); card.setPointerCapture?.(e.pointerId); }
      if (locked) { dx = Math.min(0, ddx); card.style.transform = `translateX(${dx}px)`; }
    });
    const end = () => {
      if (x0 == null) return;
      x0 = null; card.classList.remove('dragging');
      if (dx < -90) { card.style.transform = 'translateX(-110%)'; setTimeout(() => removeItem(ctx, card.dataset.swipe), 160); }
      else card.style.transform = '';
      if (locked) { const stop = (e) => e.stopPropagation(); card.addEventListener('click', stop, true); setTimeout(() => card.removeEventListener('click', stop, true), 350); }
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  });
}
