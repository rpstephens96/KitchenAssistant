// "What can I cook?" — cross-references recipes against inventory.
import { getIngredient, aggregate, formatQty } from './normalizer.js';
import { isoDate, daysBetween } from './util.js';

export const SOON_DAYS = 3;

export function isExpiring(item, today = isoDate()) {
  if (item.useSoon) return true;
  if (item.expiresOn) return daysBetween(today, item.expiresOn) <= SOON_DAYS;
  return false;
}

/** Stock of one ingredient across all locations. Level-only stock (Full/Half) counts as enough. */
export function stockOf(inventory, ingredientId, today) {
  const items = inventory.filter((i) => i.ingredientId === ingredientId);
  const levels = items.filter((i) => i.qty == null && i.level);
  return {
    items,
    qty: items.reduce((s, i) => s + (i.qty ?? 0), 0),
    levelOnly: levels.length > 0,
    low: items.length > 0 && items.every((i) => i.level === 'low' || (i.qty != null && i.qty <= 0)),
    expiring: items.some((i) => isExpiring(i, today)),
  };
}

export function covers(stock, need) {
  if (!stock.items.length) return false;
  if (stock.levelOnly) return true;
  if (need == null) return stock.qty > 0;
  return stock.qty >= need * 0.95;
}

/** Lines that matter for matching (skips salt/pepper/water, optional, unquantified "to taste"). */
export function essentialLines(recipe) {
  return (recipe.ingredients || []).filter((l) => {
    const ing = getIngredient(l.ingredientId);
    return !l.optional && !(ing && ing.always) && !(l.toTaste && l.baseQty == null);
  });
}

export function matchRecipe(recipe, inventory, { today = isoDate(), scale = 1 } = {}) {
  const needs = aggregate(essentialLines(recipe), scale);
  const have = []; const missing = []; const expiringUsed = [];
  for (const n of needs) {
    const st = stockOf(inventory, n.ingredientId, today);
    const need = n.parts.length ? n.baseQty : null;
    if (covers(st, need)) { have.push(n); if (st.expiring) expiringUsed.push(n); }
    else {
      const short = st.items.length && !st.levelOnly && need != null ? formatQty(need - st.qty, n.baseUnit) : null;
      missing.push({ ...n, short });
      if (st.expiring) expiringUsed.push(n);
    }
  }
  const status = missing.length === 0 ? 'ready' : missing.length <= 2 ? 'nearly' : 'shop';
  return {
    recipeId: recipe.id, have, missing, expiringUsed,
    pct: Math.round((have.length / (needs.length || 1)) * 100),
    status,
    badges: [status === 'ready' && 'ready', expiringUsed.length > 0 && 'expiring', status === 'nearly' && 'nearly'].filter(Boolean),
  };
}

export function rankRecipes(recipes, inventory, opts) {
  return recipes.map((r) => ({ recipe: r, match: matchRecipe(r, inventory, opts) }))
    .sort((a, b) => (a.match.missing.length - b.match.missing.length)
      || (b.match.expiringUsed.length - a.match.expiringUsed.length)
      || (b.match.pct - a.match.pct)
      || a.recipe.title.localeCompare(b.recipe.title));
}
