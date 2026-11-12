// Shopping list: plan -> aggregated needs -> minus inventory -> aisle groups.
import { aggregate, getIngredient, formatQty } from './normalizer.js';
import { stockOf } from './matching.js';
import { plannedMeals } from './planner.js';
import { AISLES } from '../data/ingredients.js';
import { uid, nowISO, isoDate } from './util.js';

/** "1 box of 6", "2 × 400g tin" */
export function packHint(ing, buyQty) {
  if (!ing?.pack || buyQty == null || buyQty <= 0) return '';
  const n = Math.ceil(buyQty / ing.pack.size - 0.02);
  if (n <= 0) return '';
  return n === 1 ? `1 ${ing.pack.label}` : `${n} × ${ing.pack.label}`;
}

/** Whole packs actually bought (used when putting shopping away). */
export function boughtQty(ing, buyQty) {
  if (buyQty == null) return null;
  if (ing?.pack) return Math.max(1, Math.ceil(buyQty / ing.pack.size - 0.02)) * ing.pack.size;
  return buyQty;
}

export function buildShoppingItems({ week, recipes, inventory, today = isoDate() }) {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const lines = [];
  for (const { recipe, scale } of plannedMeals(week, byId)) {
    for (const l of recipe.ingredients || []) lines.push({ ...l, scale, source: recipe.title });
  }
  const items = [];
  for (const need of aggregate(lines)) {
    const ing = getIngredient(need.ingredientId) || { id: need.ingredientId, name: need.name, base: need.baseUnit, aisle: 'Other', emoji: '🛒' };
    if (ing.always || need.optional) continue;
    const st = stockOf(inventory, need.ingredientId, today);
    const hasQty = need.parts.length > 0;
    let buy = null; let note = '';

    if (st.levelOnly && !st.low) continue;
    if (st.levelOnly && st.low) { buy = hasQty ? need.baseQty : null; note = 'Running low'; }
    else if (!hasQty) {
      if (st.items.length) continue;
      if (need.toTaste && !need.unresolved.length) continue;
      note = 'As needed';
    } else {
      buy = need.baseQty - st.qty;
      if (buy <= need.baseQty * 0.03) continue;
      if (ing.base === 'count') buy = Math.ceil(buy - 0.05); // can't buy half a lemon
      if (st.qty > 0) note = `Have ${formatQty(st.qty, ing.base)}, need ${formatQty(need.baseQty, ing.base)}`;
    }
    items.push(makeShoppingItem(ing, { buyQty: buy, note, sources: need.sources, manual: false }));
  }
  return items;
}

export function makeShoppingItem(ing, { buyQty = null, note = '', sources = [], manual = true, display = null } = {}) {
  return {
    id: uid('s_'),
    ingredientId: ing.id,
    name: ing.name,
    emoji: ing.emoji || '🛒',
    aisle: AISLES.includes(ing.aisle) ? ing.aisle : 'Other',
    buyQty: buyQty != null ? +(+buyQty).toFixed(3) : null,
    baseUnit: ing.base,
    display: display ?? (buyQty != null ? formatQty(buyQty, ing.base) : ''),
    packHint: packHint(ing, buyQty),
    note, sources, checked: false, manual, updatedAt: nowISO(),
  };
}

/** Regenerate but keep ticks and manual items (a manual line replaced by a generated one is not duplicated). */
export function mergeRegenerated(previous = [], fresh = []) {
  const ticked = new Set(previous.filter((i) => i.checked && !i.manual).map((i) => i.ingredientId));
  const freshIds = new Set(fresh.map((i) => i.ingredientId));
  const manual = previous.filter((i) => i.manual && (i.checked || !freshIds.has(i.ingredientId)));
  return [...fresh.map((i) => ({ ...i, checked: ticked.has(i.ingredientId) })), ...manual];
}

export function groupByAisle(items) {
  const groups = new Map(AISLES.map((a) => [a, []]));
  for (const i of items) (groups.get(i.aisle) || groups.get('Other')).push(i);
  for (const list of groups.values()) list.sort((a, b) => (a.checked - b.checked) || a.name.localeCompare(b.name));
  return [...groups.entries()].filter(([, l]) => l.length);
}
