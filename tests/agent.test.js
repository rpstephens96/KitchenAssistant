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
  assert.match(executeTool('add_to_inventory', { items: [{ item: '500g ground beef' }, { item: 'tub of ice cream', location: 'freezer' }] }, { store }).summary, /Beef Mince → Freezer|Beef Mince → Fridge/);
  assert.ok(store.state.inventory.some((i) => i.ingredientId === 'ice-cream' && i.location === 'freezer'));
  const u = executeTool('update_inventory', { item: 'milk', level: 'low' }, { store });
  assert.equal(u.ok, true);
  assert.equal(store.state.inventory.find((i) => i.ingredientId === 'milk').level, 'low');
  const r = executeTool('remove_from_inventory', { items: ['the spinach', 'unicorn'] }, { store });
  assert.match(r.summary, /Removed Spinach \(not found: unicorn\)/);
  assert.ok(!store.state.inventory.some((i) => i.ingredientId === 'spinach'));
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
  const list = executeTool('make_shopping_list', {}, { store });
  assert.match(list.summary, /Shopping list: \d+ items? to buy/);
  assert.ok(store.state.shopping.items.some((i) => i.ingredientId === 'tortilla'));
  assert.ok(store.state.shopping.items.some((i) => i.ingredientId === 'kitchen-roll'), 'manual items kept');
  const saved = executeTool('save_recipe', { title: 'Cheese Toastie', servings: 1, ingredients: ['2 slices bread', '40g cheddar', '1 tsp butter'], method: ['Grill until golden.'] }, { store });
  assert.equal(saved.summary, 'Saved recipe: Cheese Toastie');
  assert.deepEqual(executeTool('get_recipe', { recipe: 'cheese toastie' }, { store }).data.ingredients, ['2 Bread', '40 g Cheddar', '5 g Butter']);
  assert.equal(findRecipe(store.state, 'spinach omelette').title, 'Spinach & Feta Omelette');
});

test('agent loop: model calls tools, then replies; actions and undo-able changes reported', async () => {
  const store = fakeStore();
  const calls = [];
  const llm = async ({ messages, tools, system }) => {
    calls.push(messages.length);
    assert.ok(tools.length >= 10 && system.includes('KITCHEN NOW'));
    if (calls.length === 1) return { text: '', toolCalls: [{ id: 't1', name: 'add_to_shopping_list', args: { items: ['milk', '6 eggs'] } }, { id: 't2', name: 'plan_meal', args: { day: 'fri', recipe: 'Creamy Pesto Pasta' } }], raw: null };
    const results = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));
    assert.ok(results.every((r) => r.ok));
    return { text: 'Added milk and eggs, and pesto pasta is on Friday.', toolCalls: [], raw: null };
  };
  const before = store.rev;
  const res = await runAgent({ history: [], userMessage: { role: 'user', content: 'add milk and eggs, and pesto pasta friday' }, store, ai: {}, llm });
  assert.equal(res.reply, 'Added milk and eggs, and pesto pasta is on Friday.');
  assert.equal(res.actions.length, 2);
  assert.equal(res.messages.length, 5); // user, assistant(tool calls), 2 tool results, assistant
  assert.equal(store.rev - before, 2);
  store.undo(store.rev - before);
  assert.equal(store.state.shopping.items.length, 0);
});

test('history trimming drops images and never starts mid-tool-exchange', () => {
  const h = [{ role: 'tool', content: '{}' }, { role: 'user', content: [{ type: 'image', data: 'x' }, { type: 'text', text: 'hi' }] }, { role: 'assistant', content: 'yo' }];
  const t = trimHistory(h);
  assert.equal(t[0].role, 'user');
  assert.deepEqual(t[0].content[0], { type: 'text', text: '[photo shared earlier]' });
});

function fakeFetch(reply, seen) {
  return async (url, opts) => { seen.url = url; seen.headers = opts.headers; seen.body = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => reply }; };
}

test('OpenAI-compatible wire format (Gemini/OpenAI): tools, images, tool replay', async () => {
  const seen = {};
  const ai = { provider: 'gemini', key: 'k' };
  assert.equal(isConfigured(ai), true);
  const reply = { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'plan_meal', arguments: '{"day":"mon","recipe":"x"}' }, extra_content: { google: { thought_signature: 'sig' } } }] } }] };
  const r = await chat({ ai, system: 'sys', tools: [{ name: 'plan_meal', description: 'd', parameters: { type: 'object' } }],
    messages: [{ role: 'user', content: [{ type: 'image', mediaType: 'image/jpeg', data: 'AAA' }, { type: 'text', text: 'hi' }] }], fetchImpl: fakeFetch(reply, seen) });
  assert.equal(seen.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(seen.headers.authorization, 'Bearer k');
  assert.equal(seen.body.model, 'gemini-3.8-flash');
  assert.equal(seen.body.messages[0].role, 'system');
  assert.equal(seen.body.messages[1].content[0].image_url.url, 'data:image/jpeg;base64,AAA');
  assert.equal(seen.body.tools[0].function.name, 'plan_meal');
  assert.deepEqual(r.toolCalls, [{ id: 'c1', name: 'plan_meal', args: { day: 'mon', recipe: 'x' } }]);
  // replaying the assistant message keeps provider extras (thought signatures)
  await chat({ ai, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: '', toolCalls: r.toolCalls, raw: r.raw }, { role: 'tool', toolCallId: 'c1', content: '{"ok":true}' }], fetchImpl: fakeFetch({ choices: [{ message: { content: 'ok' } }] }, seen) });
  assert.equal(seen.body.messages[1].tool_calls[0].extra_content.google.thought_signature, 'sig');
  assert.deepEqual(seen.body.messages[2], { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' });
});

test('Anthropic wire format: browser header, tool_use/tool_result, thinking blocks replayed', async () => {
  const seen = {};
  const ai = { provider: 'anthropic', key: 'sk-ant' };
  const reply = { content: [{ type: 'thinking', thinking: '...', signature: 's' }, { type: 'text', text: 'On it' }, { type: 'tool_use', id: 'tu1', name: 'add_to_shopping_list', input: { items: ['milk'] } }] };
  const r = await chat({ ai, system: 'sys', tools: [{ name: 'add_to_shopping_list', description: 'd', parameters: { type: 'object' } }], messages: [{ role: 'user', content: 'milk' }], fetchImpl: fakeFetch(reply, seen) });
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(seen.headers['x-api-key'], 'sk-ant');
  assert.equal(seen.body.system, 'sys');
  assert.equal(seen.body.tools[0].input_schema.type, 'object');
  assert.equal(r.text, 'On it');
  assert.deepEqual(r.toolCalls, [{ id: 'tu1', name: 'add_to_shopping_list', args: { items: ['milk'] } }]);
  await chat({ ai, messages: [{ role: 'user', content: 'milk' }, { role: 'assistant', content: r.text, toolCalls: r.toolCalls, raw: r.raw },
    { role: 'tool', toolCallId: 'tu1', content: 'a' }, { role: 'tool', toolCallId: 'tu2', content: 'b' }], fetchImpl: fakeFetch({ content: [{ type: 'text', text: 'done' }] }, seen) });
  assert.equal(seen.body.messages[1].content[0].type, 'thinking');
  assert.equal(seen.body.messages[2].content.length, 2); // consecutive tool results grouped in one user turn
  assert.equal(seen.body.messages[2].content[0].type, 'tool_result');
});

test('friendly errors and JSON extraction', async () => {
  const bad = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid key' } }) });
  await assert.rejects(chat({ ai: { provider: 'openai', key: 'x' }, messages: [{ role: 'user', content: 'hi' }], fetchImpl: bad }), /key was rejected/);
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(chat({ ai: { provider: 'openai', key: 'x' }, messages: [{ role: 'user', content: 'hi' }], fetchImpl: offline }), /Couldn't reach/);
  assert.deepEqual(extractJSON('Sure!\n```json\n{"items":[{"name":"milk"}]}\n```'), { items: [{ name: 'milk' }] });
});
