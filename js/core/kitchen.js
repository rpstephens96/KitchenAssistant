// Shared state mutations used by the UI, receipt put-away and the AI assistant.
// All functions mutate a draft `state` (call inside store.update()).
import { getIngredient, normalizeLine, findIngredient, normText, formatQty } from './normalizer.js';
import { makeShoppingItem, boughtQty } from './shopping.js';
import { uid, nowISO } from './util.js';

export const LOCATION_LABEL = { fridge: 'Fridge', freezer: 'Freezer', pantry: 'Cupboard' };
export const LOCATIONS = Object.keys(LOCATION_LABEL);

export function registerCustom(state, ing) {
  if (ing?.custom && !state.customIngredients.some((c) => c.id === ing.id)) state.customIngredients.push({ ...ing, updatedAt: nowISO() });
}

/** "6 eggs" -> { ing, qty (base unit) } */
export function resolveText(text) {
  const n = normalizeLine(text);
  return { ing: getIngredient(n.ingredientId) || n.newIngredient, qty: n.baseQty, line: n };
}

/** Adds stock, merging into the same ingredient + location. */
export function addStock(state, { ing, qty = null, location = null, useSoon = false, level = null }) {
  registerCustom(state, ing);
  const loc = LOCATIONS.includes(location) ? location : ing.store || 'pantry';
  const ex = state.inventory.find((i) => i.ingredientId === ing.id && i.location === loc);
  if (ex) {
    if (qty != null && ex.qty != null) ex.qty += qty;
    else if (qty != null) { ex.qty = qty; ex.level = null; }
    else { ex.qty = null; ex.level = level || 'full'; }
    if (useSoon) ex.useSoon = true;
    ex.updatedAt = nowISO();
    return ex;
  }
  const item = { id: uid('i_'), ingredientId: ing.id, name: ing.name, emoji: ing.emoji || '🛒', location: loc, qty,
    level: qty == null ? (level || 'full') : null, useSoon, expiresOn: null, addedAt: nowISO(), updatedAt: nowISO() };
  state.inventory.push(item);
  return item;
}

/** Inventory items matching a spoken/typed name ("the milk", "chicken"). */
export function findStock(state, name) {
  const ing = findIngredient(name);
  if (ing) { const hit = state.inventory.filter((i) => i.ingredientId === ing.id); if (hit.length) return hit; }
  const q = normText(name);
  return state.inventory.filter((i) => normText(i.name).includes(q) || q.includes(normText(i.name)));
}

export function removeStock(state, items, tombstone) {
  const ids = new Set(items.map((i) => i.id));
  for (const id of ids) tombstone(id);
  state.inventory = state.inventory.filter((i) => !ids.has(i.id));
}

/** Adds to shopping list; tops up an existing unticked line for the same ingredient. */
export function addToShopping(state, text, sources = []) {
  const { ing, qty } = resolveText(text);
  registerCustom(state, ing);
  const ex = state.shopping.items.find((i) => i.ingredientId === ing.id && !i.checked);
  if (ex) {
    if (qty != null) { ex.buyQty = (ex.buyQty || 0) + qty; ex.display = formatQty(ex.buyQty, ing.base); }
    ex.updatedAt = nowISO();
    return ex;
  }
  const item = makeShoppingItem(ing, { buyQty: qty, sources, manual: true });
  state.shopping.items.push(item);
  state.shopping.updatedAt = nowISO();
  return item;
}

/** Removes shopping lines for the given ingredient ids. Returns how many were removed. */
export function tickOffShopping(state, ingredientIds, tombstone) {
  const ids = new Set(ingredientIds);
  const gone = state.shopping.items.filter((i) => ids.has(i.ingredientId));
  gone.forEach((i) => tombstone(i.id));
  state.shopping.items = state.shopping.items.filter((i) => !ids.has(i.ingredientId));
  return gone.length;
}

/** Puts reviewed receipt lines away. Household lines only tick off the list. */
export function putAway(state, lines, { tickList = true, tombstone = () => {} } = {}) {
  let stored = 0;
  for (const l of lines) {
    const ing = getIngredient(l.ingredientId) || l.custom;
    if (!ing || l.kind === 'household' || ing.aisle === 'Household') continue;
    addStock(state, { ing, qty: l.qty, location: l.location });
    stored++;
  }
  const ticked = tickList ? tickOffShopping(state, lines.map((l) => l.ingredientId), tombstone) : 0;
  return { stored, ticked };
}

/** Shopping list -> review lines ("I bought everything on my list"). */
export function linesFromShoppingList(items) {
  return items.map((s) => {
    const ing = getIngredient(s.ingredientId) || { id: s.ingredientId, name: s.name, emoji: s.emoji, base: s.baseUnit, store: 'pantry', aisle: s.aisle };
    const qty = boughtQty(ing, s.buyQty);
    const household = ing.aisle === 'Household';
    return { id: uid('l_'), raw: s.display ? `${s.name} · ${s.display}` : s.name, name: ing.name, emoji: ing.emoji || '🛒',
      ingredientId: ing.id, qty, baseUnit: ing.base, display: qty != null ? formatQty(qty, ing.base) : '', approx: false,
      location: ing.store || 'pantry', kind: household ? 'household' : 'food', include: true };
  });
}
