// Weekly meal plan helpers + "Auto-fill week".
import { DAYS, nowISO, isoDate } from './util.js';
import { matchRecipe, stockOf, essentialLines } from './matching.js';
import { aggregate } from './normalizer.js';

export function emptyWeek(weekStart) {
  return { weekStart, updatedAt: nowISO(), days: Object.fromEntries(DAYS.map((d) => [d, {}])) };
}

export function getWeek(state, weekStart) { return state.plans[weekStart] || emptyWeek(weekStart); }

export function plannedMeals(week, recipesById) {
  const out = [];
  for (const day of DAYS) {
    for (const [meal, slot] of Object.entries(week.days[day] || {})) {
      const recipe = slot?.recipeId && recipesById.get(slot.recipeId);
      if (!recipe) continue;
      out.push({ day, meal, slot, recipe, scale: slot.servings && recipe.servings ? slot.servings / recipe.servings : 1 });
    }
  }
  return out;
}

/** Greedy plan for empty dinner slots: expiring food first, then best match; no repeats. */
export function autoFillWeek({ recipes, inventory, week, days = DAYS.slice(0, 5), meal = 'dinner', today = isoDate() }) {
  const used = new Set(Object.values(week.days).flatMap((d) => Object.values(d || {}).map((s) => s?.recipeId)).filter(Boolean));
  let inv = inventory.map((i) => ({ ...i }));
  const picks = {};
  for (const day of days) {
    if (week.days[day]?.[meal]?.recipeId) continue;
    let best = null;
    for (const r of recipes) {
      if (used.has(r.id)) continue;
      const m = matchRecipe(r, inv, { today });
      const score = m.expiringUsed.length * 10 + m.pct / 10 - m.missing.length * 2;
      if (!best || score > best.score) best = { r, score };
    }
    if (!best) break;
    picks[day] = best.r.id;
    used.add(best.r.id);
    inv = consume(inv, best.r, today);
  }
  return picks;
}

export function consume(inventory, recipe, today) {
  const inv = inventory.map((i) => ({ ...i }));
  for (const need of aggregate(essentialLines(recipe))) {
    let left = need.baseQty;
    for (const item of stockOf(inv, need.ingredientId, today).items) {
      if (item.qty == null) { item.useSoon = false; item.expiresOn = null; continue; }
      const take = Math.min(item.qty, left);
      item.qty -= take; left -= take;
      if (item.qty <= 0) { item.useSoon = false; item.expiresOn = null; }
    }
  }
  return inv;
}
