import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, executeTool, buildSystemPrompt, findRecipe, trimHistory } from '../js/ai/agent.js';
import { chat, extractJSON, isConfigured } from '../js/ai/llm.js';
import { buildSeedState } from '../js/data/seed.js';
import { weekStartOf, addDays } from '../js/core/util.js';

function fakeStore() {
  const snaps = [];
  return {
    state: buildSeedState(), rev: 0,
    update(fn) { snaps.push(JSON.stringify(this.state)); fn(this.state); this.rev++; },
    undo(n = 1) { let p; while (n-- && snaps.length) p = snaps.pop(); if (p) { this.state = JSON.parse(p); this.rev++; } },
    tombstone(id) { this.state.tombstones[id] = 'now'; },
  };
}

test('system prompt contains the live kitchen, recipes, plan and rules', () => {
  const p = buildSystemPrompt(fakeStore().state, new Date(2026, 10, 12));
  assert.match(p, /Thursday,? 12 November 2026/);
  assert.match(p, /Fridge: .*Chicken Breast 340 g/);
  assert.match(p, /Creamy Pesto Pasta .*READY TO COOK/);
  assert.match(p, /SHOPPING LIST: \(empty\)/);
});

test('tools: add, update, remove inventory', () => {
  const store = fakeStore();
  executeTool('add_to_inventory', { items: [{ item: '500g ground beef' }, { item: 'tub of ice cream', location: 'freezer' }] }, { store });
  assert.ok(store.state.inventory.some((i) => i.ingredientId === 'ice-cream' && i.location === 'freezer'));
  assert.equal(executeTool('update_inventory', { item: 'milk', level: 'low' }, { store }).ok, true);
  assert.equal(store.state.inventory.find((i) => i.ingredientId === 'milk').level, 'low');
  assert.match(executeTool('remove_from_inventory', { items: ['the spinach', 'unicorn'] }, { store }).summary, /Removed Spinach \(not found: unicorn\)/);
});

test('tools: shopping list, plan meal, make list, save recipe, get recipe', () => {
  const store = fakeStore();
  executeTool('add_to_shopping_list', { items: ['2 lemons', 'kitchen roll'] }, { store });
  executeTool('add_to_shopping_list', { items: ['1 lemon'] }, { store });
  assert.equal(store.state.shopping.items.find((i) => i.ingredientId === 'lemon').display, '3');
  assert.equal(executeTool('plan_meal', { day: 'thu', recipe: 'fajitas' }, { store }).summary, 'Chicken Fajitas → Thursday dinner');
  assert.equal(executeTool('plan_meal', { day: 'fri', recipe: 'beef wellington' }, { store }).ok, false);
  assert.equal(executeTool('plan_meal', { day: 'mon', recipe: 'Bolognese', week: 'next' }, { store }).ok, true);
  assert.ok(store.state.plans[addDays(weekStartOf(), 7)].days.mon.dinner);
  assert.match(executeTool('make_shopping_list', {}, { store }).summary, /Shopping list: \d+ items? to buy/);
  assert.ok(store.state.shopping.items.some((i) => i.ingredientId === 'kitchen-roll'));
  assert.equal(executeTool('save_recipe', { title: 'Cheese Toastie', servings: 1, ingredients: ['2 slices bread', '40g cheddar', '1 tsp butter'], method: ['Grill.'] }, { store }).summary, 'Saved recipe: Cheese Toastie');
  assert.deepEqual(executeTool('get_recipe', { recipe: 'cheese toastie' }, { store }).data.ingredients, ['2 Bread', '40 g Cheddar', '5 g Butter']);
  assert.equal(findRecipe(store.state, 'spinach omelette').title, 'Spinach & Feta Omelette');
});

test('agent loop: tools then reply; changes counted for undo', async () => {
  const store = fakeStore();
  let calls = 0;
  const llm = async ({ messages }) => {
    calls++;
    if (calls === 1) return { text: '', toolCalls: [{ id: 't1', name: 'add_to_shopping_list', args: { items: ['milk'] } }, { id: 't2', name: 'plan_meal', args: { day: 'fri', recipe: 'Creamy Pesto Pasta' } }], raw: null };
    assert.ok(messages.filter((m) => m.role === 'tool').every((m) => JSON.parse(m.content).ok));
    return { text: 'Done.', toolCalls: [], raw: null };
  };
  const before = store.rev;
  const res = await runAgent({ history: [], userMessage: { role: 'user', content: 'x' }, store, ai: {}, llm });
  assert.equal(res.actions.length, 2);
  assert.equal(store.rev - before, 2);
  store.undo(2);
  assert.equal(store.state.shopping.items.length, 0);
});

test('history trimming drops images and never starts mid-tool-exchange', () => {
  const t = trimHistory([{ role: 'tool', content: '{}' }, { role: 'user', content: [{ type: 'image', data: 'x' }, { type: 'text', text: 'hi' }] }]);
  assert.equal(t[0].role, 'user');
  assert.deepEqual(t[0].content[0], { type: 'text', text: '[photo shared earlier]' });
});

const fakeFetch = (reply, seen) => async (url, opts) => { seen.url = url; seen.headers = opts.headers; seen.body = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => reply }; };

test('OpenAI-compatible wire format (Gemini): tools, images, thought signatures replayed', async () => {
  const seen = {};
  const ai = { provider: 'gemini', key: 'k' };
  assert.equal(isConfigured(ai), true);
  const reply = { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'plan_meal', arguments: '{"day":"mon"}' }, extra_content: { google: { thought_signature: 'sig' } } }] } }] };
  const r = await chat({ ai, system: 's', tools: [{ name: 'plan_meal', description: 'd', parameters: { type: 'object' } }],
    messages: [{ role: 'user', content: [{ type: 'image', mediaType: 'image/jpeg', data: 'AAA' }, { type: 'text', text: 'hi' }] }], fetchImpl: fakeFetch(reply, seen) });
  assert.equal(seen.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(seen.body.messages[1].content[0].image_url.url, 'data:image/jpeg;base64,AAA');
  await chat({ ai, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: '', toolCalls: r.toolCalls, raw: r.raw }, { role: 'tool', toolCallId: 'c1', content: '{}' }], fetchImpl: fakeFetch({ choices: [{ message: { content: 'ok' } }] }, seen) });
  assert.equal(seen.body.messages[1].tool_calls[0].extra_content.google.thought_signature, 'sig');
});

test('Anthropic wire format: browser header, tool_use/tool_result grouping', async () => {
  const seen = {};
  const ai = { provider: 'anthropic', key: 'sk' };
  const r = await chat({ ai, messages: [{ role: 'user', content: 'milk' }], fetchImpl: fakeFetch({ content: [{ type: 'thinking', thinking: '…', signature: 's' }, { type: 'tool_use', id: 'tu1', name: 'x', input: {} }] }, seen) });
  assert.equal(seen.headers['anthropic-dangerous-direct-browser-access'], 'true');
  await chat({ ai, messages: [{ role: 'user', content: 'm' }, { role: 'assistant', content: '', toolCalls: r.toolCalls, raw: r.raw }, { role: 'tool', toolCallId: 'tu1', content: 'a' }, { role: 'tool', toolCallId: 'tu2', content: 'b' }], fetchImpl: fakeFetch({ content: [{ type: 'text', text: 'd' }] }, seen) });
  assert.equal(seen.body.messages[1].content[0].type, 'thinking');
  assert.equal(seen.body.messages[2].content.length, 2);
});

test('friendly errors and JSON extraction', async () => {
  await assert.rejects(chat({ ai: { provider: 'openai', key: 'x' }, messages: [{ role: 'user', content: 'hi' }], fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) }), /key was rejected/);
  await assert.rejects(chat({ ai: { provider: 'openai', key: 'x' }, messages: [{ role: 'user', content: 'hi' }], fetchImpl: async () => { throw new TypeError('x'); } }), /Couldn't reach/);
  assert.deepEqual(extractJSON('Sure!\n```json\n{"items":[]}\n```'), { items: [] });
});
