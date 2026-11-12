// Kitchen assistant: system prompt with a live kitchen snapshot + tools that act on the app's data.
// Every change goes through store.update(), so the normal Undo works and the chat can undo a whole reply.
import { chat } from './llm.js';
import { getIngredient, normText, formatQty, normalizeLine } from '../core/normalizer.js';
import { rankRecipes, isExpiring } from '../core/matching.js';
import { getWeek, emptyWeek } from '../core/planner.js';
import { buildShoppingItems, mergeRegenerated } from '../core/shopping.js';
import { buildRecipe } from '../core/importer.js';
import { addStock, resolveText, findStock, removeStock, addToShopping, registerCustom, LOCATION_LABEL } from '../core/kitchen.js';
import { DAYS, DAY_NAMES, MEALS, weekStartOf, addDays, isoDate, parseISODate, daysBetween, nowISO } from '../core/util.js';

const LOC_ENUM = ['fridge', 'freezer', 'pantry'];
const WEEK_PARAM = { type: 'string', enum: ['this', 'next'], description: "Which week (default 'this')" };

export const TOOLS = [
  { name: 'add_to_inventory', description: 'Add food to the fridge, freezer or cupboard (pantry). Use natural amounts like "500g beef mince" or "6 eggs"; omit the amount if unknown.',
    parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
      item: { type: 'string' }, location: { type: 'string', enum: LOC_ENUM }, use_soon: { type: 'boolean' } }, required: ['item'] } } }, required: ['items'] } },
  { name: 'update_inventory', description: 'Change something already in the kitchen: set an exact amount, a rough level, mark use-soon, or move it.',
    parameters: { type: 'object', properties: { item: { type: 'string' }, amount: { type: 'string', description: 'e.g. "250g", "2"' },
      level: { type: 'string', enum: ['full', 'half', 'low'] }, use_soon: { type: 'boolean' }, location: { type: 'string', enum: LOC_ENUM } }, required: ['item'] } },
  { name: 'remove_from_inventory', description: 'Remove items that were used up or thrown away.',
    parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] } },
  { name: 'add_to_shopping_list', description: 'Add things to the shopping list, e.g. ["2 lemons", "kitchen roll"].',
    parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] } },
  { name: 'remove_from_shopping_list', description: 'Remove things from the shopping list.',
    parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] } },
  { name: 'make_shopping_list', description: "Rebuild the shopping list from the week's meal plan minus what is already in the kitchen.",
    parameters: { type: 'object', properties: { week: WEEK_PARAM } } },
  { name: 'plan_meal', description: 'Put a SAVED recipe on a day of the meal plan. Save the recipe first if it is new.',
    parameters: { type: 'object', properties: { day: { type: 'string', enum: DAYS }, meal: { type: 'string', enum: MEALS }, recipe: { type: 'string', description: 'Recipe title' },
      servings: { type: 'integer' }, week: WEEK_PARAM }, required: ['day', 'recipe'] } },
  { name: 'clear_meal', description: 'Remove a meal from the plan.',
    parameters: { type: 'object', properties: { day: { type: 'string', enum: DAYS }, meal: { type: 'string', enum: MEALS }, week: WEEK_PARAM }, required: ['day'] } },
  { name: 'get_recipe', description: 'Get the full ingredients and method of a saved recipe.',
    parameters: { type: 'object', properties: { recipe: { type: 'string' } }, required: ['recipe'] } },
  { name: 'save_recipe', description: 'Save a new recipe to the recipe book. Ingredients one per line with UK amounts, e.g. "400g chopped tomatoes".',
    parameters: { type: 'object', properties: { title: { type: 'string' }, servings: { type: 'integer' }, total_minutes: { type: 'integer' },
      ingredients: { type: 'array', items: { type: 'string' } }, method: { type: 'array', items: { type: 'string' } } }, required: ['title', 'ingredients', 'method'] } },
];

const weekOf = (w) => (w === 'next' ? addDays(weekStartOf(), 7) : weekStartOf());

function stockLabel(i) {
  const ing = getIngredient(i.ingredientId);
  const amt = i.qty != null ? formatQty(i.qty, ing?.base || 'count') : `${i.level} level`;
  let exp = '';
  if (i.expiresOn) { const d = daysBetween(isoDate(), i.expiresOn); exp = d < 0 ? ' — PAST DATE' : d <= 3 ? ` — use within ${d} day${d === 1 ? '' : 's'}` : ''; }
  else if (i.useSoon) exp = ' — use soon';
  return `${i.name} ${amt}${exp}`;
}

export function findRecipe(state, title) {
  const q = normText(title);
  const rs = state.recipes;
  return rs.find((r) => normText(r.title) === q) || rs.find((r) => normText(r.title).includes(q) || q.includes(normText(r.title)))
    || rs.map((r) => { const a = new Set(normText(r.title).split(' ')); const b = q.split(' '); return [b.filter((w) => a.has(w)).length / Math.max(a.size, b.length), r]; })
      .filter(([s]) => s >= 0.5).sort((x, y) => y[0] - x[0])[0]?.[1] || null;
}

/** Compact snapshot of the kitchen for the system prompt. */
export function buildSystemPrompt(state, now = new Date()) {
  const today = isoDate(now);
  const inv = Object.entries(LOCATION_LABEL).map(([loc, label]) => {
    const items = state.inventory.filter((i) => i.location === loc);
    return `${label}: ${items.length ? items.map(stockLabel).join('; ') : '(empty)'}`;
  }).join('\n');
  const ranked = rankRecipes(state.recipes, state.inventory, { today });
  const recipes = ranked.map(({ recipe: r, match: m }) => `- ${r.title} (serves ${r.servings}${r.totalMins ? `, ${r.totalMins} min` : ''}) — ${m.status === 'ready' ? 'READY TO COOK' : `missing: ${m.missing.map((x) => x.name).join(', ')}`}${m.expiringUsed.length ? ` [uses expiring: ${m.expiringUsed.map((x) => x.name).join(', ')}]` : ''}`).join('\n') || '(none saved)';
  const byId = new Map(state.recipes.map((r) => [r.id, r]));
  const plan = (wk, label) => {
    const w = getWeek(state, wk);
    const rows = DAYS.flatMap((d, i) => Object.entries(w.days[d] || {}).filter(([, s]) => byId.has(s?.recipeId))
      .map(([meal, s]) => `${DAY_NAMES[d]} ${parseISODate(addDays(wk, i)).getDate()} ${meal}: ${byId.get(s.recipeId).title}`));
    return `${label} (w/c ${wk}): ${rows.length ? rows.join('; ') : 'nothing planned'}`;
  };
  const shop = state.shopping.items.filter((i) => !i.checked).map((i) => `${i.name}${i.display ? ` ${i.display}` : ''}`).join('; ') || '(empty)';
  const expiring = state.inventory.filter((i) => isExpiring(i, today)).map((i) => i.name);

  return `You are Larder, a warm, practical kitchen and shopping assistant inside a family meal-planning app in the UK.
Today is ${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.

HOW TO BEHAVE
- Replies are read on a phone: short, friendly, plain UK English, metric units, °C. Short bullet lists are fine; no tables or headings.
- Use the tools to make changes instead of telling the user to do it. Simple requests ("add milk to the list") — just do them.
- Ask first before removing more than 3 things or replacing meals that are already planned.
- Only say something was done if the tool result confirms it. Changes can be undone with the Undo button under your reply.
- Base suggestions on the real kitchen below. Prioritise food that needs using up${expiring.length ? ` (right now: ${expiring.join(', ')})` : ''}.
- Prefer saved recipes. If suggesting a new dish the user wants to plan, save it with save_recipe first (realistic UK quantities), then plan it.
- Salt, pepper, oil and water are assumed to be in the cupboard.
- If an image is attached: it may be the inside of a fridge, a receipt or groceries. Describe what you see briefly and offer to add items — only add them if asked.

KITCHEN NOW
${inv}

SAVED RECIPES (best match first)
${recipes}

MEAL PLAN
${plan(weekStartOf(now), 'This week')}
${plan(addDays(weekStartOf(now), 7), 'Next week')}

SHOPPING LIST: ${shop}`;
}

/** Runs one tool against the store. Returns { ok, summary, data } — summary is shown as a chip in chat. */
export function executeTool(name, args = {}, { store }) {
  const s = store.state;
  const tomb = (id) => store.tombstone(id);
  const done = (summary, data) => ({ ok: true, summary, data });
  const fail = (error) => ({ ok: false, error });

  switch (name) {
    case 'add_to_inventory': {
      const added = [];
      store.update((st) => {
        for (const it of args.items || []) {
          const { ing, qty } = resolveText(it.item || '');
          if (!ing) continue;
          const row = addStock(st, { ing, qty, location: it.location, useSoon: !!it.use_soon });
          added.push(`${ing.name} → ${LOCATION_LABEL[row.location]}`);
        }
      });
      return added.length ? done(`Added ${added.join(', ')}`) : fail('Nothing recognised to add');
    }
    case 'update_inventory': {
      const hits = findStock(s, args.item || '');
      if (!hits.length) return fail(`"${args.item}" is not in the kitchen`);
      const item = hits[0];
      const ing = getIngredient(item.ingredientId) || { base: 'count', name: item.name };
      const changes = [];
      store.update((st) => {
        const it = st.inventory.find((i) => i.id === item.id);
        if (args.amount) {
          const n = normalizeLine(`${args.amount} ${ing.name}`);
          if (n.baseQty != null) { it.qty = n.baseQty; it.level = null; changes.push(formatQty(n.baseQty, ing.base)); }
        }
        if (args.level) { it.qty = null; it.level = args.level; changes.push(args.level); }
        if (args.use_soon != null) { it.useSoon = !!args.use_soon; if (!it.useSoon) it.expiresOn = null; changes.push(args.use_soon ? 'use soon' : 'fresh'); }
        if (args.location && LOC_ENUM.includes(args.location)) { it.location = args.location; changes.push(`moved to ${LOCATION_LABEL[args.location]}`); }
        it.updatedAt = nowISO();
      });
      return done(`${item.name}: ${changes.join(', ') || 'unchanged'}`);
    }
    case 'remove_from_inventory': {
      const gone = []; const missing = [];
      store.update((st) => {
        for (const n of args.items || []) {
          const hits = findStock(st, n);
          if (!hits.length) { missing.push(n); continue; }
          removeStock(st, hits, tomb);
          gone.push(hits[0].name);
        }
      });
      if (!gone.length) return fail(`Not found: ${missing.join(', ')}`);
      return done(`Removed ${gone.join(', ')}${missing.length ? ` (not found: ${missing.join(', ')})` : ''}`);
    }
    case 'add_to_shopping_list': {
      const added = [];
      store.update((st) => { for (const t of args.items || []) { const row = addToShopping(st, t); added.push(row.display ? `${row.name} ${row.display}` : row.name); } });
      return done(`On the list: ${added.join(', ')}`);
    }
    case 'remove_from_shopping_list': {
      const gone = [];
      store.update((st) => {
        for (const t of args.items || []) {
          const { ing } = resolveText(t);
          const q = normText(t);
          const hits = st.shopping.items.filter((i) => i.ingredientId === ing?.id || normText(i.name).includes(q));
          hits.forEach((h) => tomb(h.id));
          st.shopping.items = st.shopping.items.filter((i) => !hits.includes(i));
          if (hits.length) gone.push(hits[0].name);
        }
      });
      return gone.length ? done(`Removed from list: ${gone.join(', ')}`) : fail('None of those were on the list');
    }
    case 'make_shopping_list': {
      const wk = weekOf(args.week);
      const fresh = buildShoppingItems({ week: getWeek(s, wk), recipes: s.recipes, inventory: s.inventory });
      store.update((st) => { st.shopping = { ...st.shopping, items: mergeRegenerated(st.shopping.items, fresh), generatedAt: nowISO(), weekStart: wk, updatedAt: nowISO() }; });
      return done(`Shopping list: ${fresh.length} item${fresh.length === 1 ? '' : 's'} to buy`, { items: fresh.map((i) => `${i.name} ${i.display}`.trim()) });
    }
    case 'plan_meal': {
      const r = findRecipe(s, args.recipe || '');
      if (!r) return fail(`No saved recipe called "${args.recipe}". Saved: ${s.recipes.map((x) => x.title).join(', ')}`);
      if (!DAYS.includes(args.day)) return fail('day must be mon…sun');
      const meal = MEALS.includes(args.meal) ? args.meal : 'dinner';
      const wk = weekOf(args.week);
      store.update((st) => {
        st.plans[wk] ||= emptyWeek(wk);
        st.plans[wk].days[args.day][meal] = { recipeId: r.id, servings: args.servings || r.servings };
        st.plans[wk].updatedAt = nowISO();
        if (meal === 'lunch') st.settings.showLunch = true;
        if (meal === 'breakfast') st.settings.showBreakfast = true;
      });
      return done(`${r.title} → ${DAY_NAMES[args.day]} ${meal}${args.week === 'next' ? ' (next week)' : ''}`);
    }
    case 'clear_meal': {
      const wk = weekOf(args.week);
      const meal = MEALS.includes(args.meal) ? args.meal : 'dinner';
      if (!s.plans[wk]?.days[args.day]?.[meal]) return fail('Nothing planned there');
      store.update((st) => { delete st.plans[wk].days[args.day][meal]; st.plans[wk].updatedAt = nowISO(); });
      return done(`Cleared ${DAY_NAMES[args.day]} ${meal}`);
    }
    case 'get_recipe': {
      const r = findRecipe(s, args.recipe || '');
      if (!r) return fail(`No saved recipe called "${args.recipe}"`);
      return { ok: true, data: { title: r.title, servings: r.servings, minutes: r.totalMins, ingredients: r.ingredients.map((l) => `${l.display} ${l.name}${l.note ? `, ${l.note}` : ''}`.trim()), method: r.method } };
    }
    case 'save_recipe': {
      if (!args.title || !args.ingredients?.length) return fail('A recipe needs a title and ingredients');
      const existing = findRecipe(s, args.title);
      if (existing && normText(existing.title) === normText(args.title)) return done(`"${existing.title}" is already saved`);
      const { newIngredients, ...recipe } = buildRecipe({ title: args.title, servings: args.servings || 4, totalMins: args.total_minutes || null, ingredients: args.ingredients, method: args.method || [] });
      store.update((st) => { newIngredients.forEach((n) => registerCustom(st, n)); st.recipes.unshift(recipe); });
      return done(`Saved recipe: ${recipe.title}`);
    }
    default: return fail(`Unknown tool ${name}`);
  }
}

/**
 * One assistant turn: may call several tools before the final reply.
 * @returns {{ reply: string, actions: string[], messages: object[] }} messages = new messages to append to history
 */
export async function runAgent({ history, userMessage, store, ai, llm = chat, maxSteps = 6, signal, now }) {
  const messages = [...history, userMessage];
  const added = [userMessage];
  const actions = [];
  for (let step = 0; step < maxSteps; step++) {
    const res = await llm({ ai, system: buildSystemPrompt(store.state, now), messages, tools: TOOLS, signal });
    const assistant = { role: 'assistant', content: res.text, toolCalls: res.toolCalls, raw: res.raw };
    messages.push(assistant); added.push(assistant);
    if (!res.toolCalls?.length) return { reply: res.text || 'Done.', actions, messages: added };
    for (const call of res.toolCalls) {
      let result;
      try { result = executeTool(call.name, call.args, { store }); } catch (e) { result = { ok: false, error: e.message }; }
      if (result.ok && result.summary) actions.push(result.summary);
      const toolMsg = { role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(result) };
      messages.push(toolMsg); added.push(toolMsg);
    }
  }
  return { reply: actions.length ? 'All done — see the changes below.' : "Sorry, I couldn't finish that. Try asking a simpler way.", actions, messages: added };
}

/** Keeps the conversation small: last N messages, images replaced by a note, never starting on a tool result. */
export function trimHistory(messages, max = 24) {
  let out = messages.slice(-max);
  while (out.length && out[0].role !== 'user') out = out.slice(1);
  return out.map((m) => (m.role === 'user' && Array.isArray(m.content)
    ? { ...m, content: m.content.map((p) => (p.type === 'image' ? { type: 'text', text: '[photo shared earlier]' } : p)) } : m));
}
