import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLine } from '../js/core/normalizer.js';
import { matchRecipe, rankRecipes } from '../js/core/matching.js';
import { autoFillWeek, emptyWeek } from '../js/core/planner.js';
import { buildShoppingItems, groupByAisle, mergeRegenerated } from '../js/core/shopping.js';
import { extractRecipeFromHtml, parseRecipeText, isoDurationToMinutes, buildRecipe } from '../js/core/importer.js';
import { mergeState } from '../js/core/merge.js';
import { buildSeedState } from '../js/data/seed.js';

const recipe = (id, title, lines, servings = 2) => ({ id, title, servings, ingredients: lines.map((l) => normalizeLine(l)) });
const item = (ingredientId, qty, extra = {}) => ({ id: `i-${ingredientId}-${Math.random()}`, ingredientId, name: ingredientId, location: 'fridge', qty, level: qty == null ? 'full' : null, ...extra });
const weekWith = (...ids) => { const w = emptyWeek('2026-11-16'); ['mon', 'tue', 'wed'].forEach((d, i) => { if (ids[i]) w.days[d].dinner = { recipeId: ids[i] }; }); return w; };

test('shopping: needs 6 eggs, have 4 -> buy 2 (1 box of 6)', () => {
  const [eggs] = buildShoppingItems({ week: weekWith('r1'), recipes: [recipe('r1', 'Omelettes', ['6 eggs'])], inventory: [item('egg', 4)] });
  assert.equal(eggs.display, '2');
  assert.equal(eggs.packHint, '1 box of 6');
  assert.equal(eggs.aisle, 'Dairy & Eggs');
});

test('shopping: butter across 3 recipes aggregates, minus 100 g in fridge', () => {
  const recipes = [recipe('a', 'A', ['50g butter']), recipe('b', 'B', ['2 tbsp butter']), recipe('c', 'C', ['1/2 cup butter'])];
  const none = buildShoppingItems({ week: weekWith('a', 'b', 'c'), recipes, inventory: [] });
  assert.equal(none[0].display, '195 g');
  assert.deepEqual(none[0].sources, ['A', 'B', 'C']);
  const some = buildShoppingItems({ week: weekWith('a', 'b', 'c'), recipes, inventory: [item('butter', 100)] });
  assert.equal(some[0].display, '94 g'); // 193.5 g needed − 100 g held
  assert.equal(some[0].packHint, '1 250g block');
});

test('shopping: servings scaling, level stock, always-items skipped, aisle grouping', () => {
  const r = recipe('r', 'Pasta', ['200g pasta', '1 tbsp olive oil', 'salt', '1 onion'], 2);
  const week = emptyWeek('2026-11-16'); week.days.mon.dinner = { recipeId: 'r', servings: 4 };
  const items = buildShoppingItems({ week, recipes: [r], inventory: [item('olive-oil', null)] });
  const names = items.map((i) => i.name);
  assert.ok(!names.includes('Salt') && !names.includes('Olive Oil'));
  assert.equal(items.find((i) => i.ingredientId === 'pasta').display, '400 g');
  assert.equal(items.find((i) => i.ingredientId === 'onion').display, '2');
  assert.deepEqual(groupByAisle(items).map(([a]) => a), ['Fresh Produce', 'Cupboard & Baking']);
  const low = buildShoppingItems({ week, recipes: [r], inventory: [item('olive-oil', null, { level: 'low' })] });
  assert.equal(low.find((i) => i.ingredientId === 'olive-oil').note, 'Running low');
});

test('count items round up when shopping (no half lemons)', () => {
  const [lem] = buildShoppingItems({ week: weekWith('r'), recipes: [recipe('r', 'Lemony', ['3 tbsp lemon juice', '1 lemon'])], inventory: [] });
  assert.equal(lem.display, '3');
});

test('regenerate keeps ticks & manual items without duplicates', () => {
  const merged = mergeRegenerated([{ id: 'x', ingredientId: 'egg', checked: true, manual: false }, { id: 'm', ingredientId: 'foil', checked: false, manual: true }], [{ id: 'y', ingredientId: 'egg', checked: false }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].checked, true);
  assert.equal(mergeRegenerated([{ id: 'm2', ingredientId: 'egg', checked: false, manual: true }], [{ id: 'y', ingredientId: 'egg', checked: false }]).length, 1);
});

test('matching: ready / missing 1–2 / expiring badges', () => {
  const r1 = recipe('1', 'Ready', ['2 eggs', 'salt']);
  const r2 = recipe('2', 'Nearly', ['2 eggs', '30g feta']);
  const r3 = recipe('3', 'Shop', ['tortillas', 'lime', 'feta']);
  const inv = [item('egg', 6, { useSoon: true })];
  assert.deepEqual(matchRecipe(r1, inv).badges, ['ready', 'expiring']);
  assert.deepEqual(matchRecipe(r2, inv).badges, ['expiring', 'nearly']);
  assert.equal(matchRecipe(r3, inv).status, 'shop');
  assert.deepEqual(rankRecipes([r3, r2, r1], inv).map((x) => x.recipe.id), ['1', '2', '3']);
  assert.equal(matchRecipe(recipe('4', 'Big', ['12 eggs']), inv).status, 'nearly');
});

test('auto-fill prioritises expiring food and avoids repeats', () => {
  const recipes = [recipe('pasta', 'Pasta', ['200g pasta']), recipe('chicken', 'Chicken', ['300g chicken breast']), recipe('fish', 'Fish', ['2 salmon fillets'])];
  const inv = [item('chicken-breast', 340, { useSoon: true }), item('pasta', 500)];
  const picks = autoFillWeek({ recipes, inventory: inv, week: emptyWeek('2026-11-16'), days: ['mon', 'tue', 'wed'] });
  assert.equal(picks.mon, 'chicken');
  assert.equal(new Set(Object.values(picks)).size, 3);
});

test('importer: JSON-LD with @graph, HowToSection, ISO durations', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, {
    '@type': ['Recipe'], name: 'Best Brownies &amp; More', image: [{ url: 'https://ex.com/b.jpg' }], recipeYield: ['16'], prepTime: 'PT15M', totalTime: 'PT40M',
    recipeIngredient: ['1/2 cup butter', '1 cup sugar', '2 eggs'],
    recipeInstructions: [{ '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: 'Preheat oven to 350°F.' }, { '@type': 'HowToStep', text: 'Bake 25 minutes.' }] }] }] })}</script>`;
  const raw = extractRecipeFromHtml(html, 'https://ex.com/r');
  assert.equal(raw.title, 'Best Brownies & More');
  assert.equal(raw.servings, 16);
  assert.equal(raw.totalMins, 40);
  const r = buildRecipe(raw);
  assert.equal(r.system, 'US');
  assert.equal(r.method[0], 'Preheat oven to 180°C (160°C fan, gas 4).');
  assert.equal(r.ingredients[0].display, '115 g');
  assert.equal(isoDurationToMinutes('PT1H30M'), 90);
});

test('importer: og:title fallback and pasted text', () => {
  assert.equal(extractRecipeFromHtml('<meta property="og:title" content="Nice Soup">' + 'x'.repeat(300)).partial, true);
  const raw = parseRecipeText(`Grandma's Pancakes\n\nIngredients:\n- 1 cup flour\n- 1 cup milk\n- 1 egg\n\nMethod\n1. Whisk everything.\n2. Fry in butter.`);
  assert.equal(raw.title, "Grandma's Pancakes");
  assert.equal(raw.ingredients.length, 3);
  assert.deepEqual(raw.method, ['Whisk everything.', 'Fry in butter.']);
});

test('merge: newest record wins, deletions propagate via tombstones', () => {
  const base = { inventory: [], recipes: [], customIngredients: [], plans: {}, shopping: { items: [] }, settings: {}, tombstones: {} };
  const a = { ...base, updatedAt: '2026-11-12T10:00:00Z', inventory: [{ id: 'm', qty: 1, updatedAt: '2026-11-12T10:00:00Z' }, { id: 'e', updatedAt: '2026-11-11T00:00:00Z' }] };
  const b = { ...base, updatedAt: '2026-11-12T11:00:00Z', inventory: [{ id: 'm', qty: 2, updatedAt: '2026-11-12T11:00:00Z' }], tombstones: { e: '2026-11-12T09:00:00Z' } };
  const merged = mergeState(a, b);
  assert.equal(merged.inventory.length, 1);
  assert.equal(merged.inventory[0].qty, 2);
});

test('seed data is valid and exercises every badge', () => {
  const s = buildSeedState();
  assert.deepEqual([...new Set(rankRecipes(s.recipes, s.inventory).flatMap((x) => x.match.badges))].sort(), ['expiring', 'nearly', 'ready']);
  assert.ok(s.recipes.every((r) => r.ingredients.every((l) => l.ingredientId)));
});
