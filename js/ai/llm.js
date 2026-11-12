// Provider-agnostic LLM client (bring-your-own-key, called directly from the browser).
// Two wire formats cover every preset: OpenAI-compatible chat completions and Anthropic Messages.
//
// Neutral message format used by the rest of the app:
//   { role: 'user', content: string | [{ type: 'text', text } | { type: 'image', mediaType, data /* base64 */ }] }
//   { role: 'assistant', content: string, toolCalls: [{ id, name, args }], raw /* provider message, replayed verbatim */ }
//   { role: 'tool', toolCallId, name, content: string }

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini', note: 'Free tier available — best place to start', kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openai: {
    label: 'OpenAI', note: 'Pay as you go', kind: 'openai',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna', keyUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    label: 'Anthropic Claude', note: 'Pay as you go', kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5', keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  custom: {
    label: 'Other / own proxy', note: 'Any OpenAI-compatible endpoint (OpenRouter, Ollama, a Cloudflare Worker…)', kind: 'openai',
    baseUrl: '', model: '', keyUrl: '',
  },
};

export function resolveConfig(ai = {}) {
  const p = PROVIDERS[ai.provider];
  if (!p) return null;
  return { kind: p.kind, baseUrl: (ai.baseUrl || p.baseUrl).replace(/\/+$/, ''), model: ai.model || p.model, key: ai.key || '' };
}

export function isConfigured(ai) {
  const c = resolveConfig(ai);
  return !!(c && c.baseUrl && c.model && (c.key || ai.provider === 'custom'));
}

function toOpenAI(messages, system) {
  const out = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.role === 'assistant') {
      if (m.raw?.provider === 'openai') out.push(m.raw.message);
      else out.push({ role: 'assistant', content: m.content || '', ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) } : {}) });
    } else {
      out.push({ role: 'user', content: typeof m.content === 'string' ? m.content : m.content.map((p) => p.type === 'image'
        ? { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } } : { type: 'text', text: p.text }) });
    }
  }
  return out;
}

function fromOpenAI(json) {
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new Error(json.error?.message || 'Empty reply from the AI');
  const toolCalls = (msg.tool_calls || []).map((t) => ({ id: t.id, name: t.function.name, args: safeJSON(t.function.arguments) }));
  const replay = { role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) };
  return { text: textOf(msg.content), toolCalls, raw: { provider: 'openai', message: replay } };
}

function toAnthropic(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant') {
      if (m.raw?.provider === 'anthropic') out.push({ role: 'assistant', content: m.raw.content });
      else out.push({ role: 'assistant', content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...(m.toolCalls || []).map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.args }))] });
    } else {
      out.push({ role: 'user', content: typeof m.content === 'string' ? m.content : m.content.map((p) => p.type === 'image'
        ? { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } } : { type: 'text', text: p.text }) });
    }
  }
  return out;
}

function fromAnthropic(json) {
  if (!Array.isArray(json.content)) throw new Error(json.error?.message || 'Empty reply from the AI');
  return {
    text: json.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(),
    toolCalls: json.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} })),
    raw: { provider: 'anthropic', content: json.content },
  };
}

function textOf(c) { return typeof c === 'string' ? c.trim() : Array.isArray(c) ? c.map((p) => p.text || '').join('').trim() : ''; }
function safeJSON(s) { try { return typeof s === 'string' ? JSON.parse(s || '{}') : (s || {}); } catch { return {}; } }

export function extractJSON(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{'); const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error("The AI didn't return a readable list");
  return JSON.parse(t.slice(start, end + 1));
}

function friendlyError(status, body) {
  const msg = body?.error?.message || body?.message || (Array.isArray(body) && body[0]?.error?.message) || '';
  if (status === 401 || status === 403) return `The AI key was rejected (${status}). Check it in ⚙️ Settings.${msg ? ` — ${msg}` : ''}`;
  if (status === 404) return `Model or address not found — check the model name in ⚙️ Settings.${msg ? ` — ${msg}` : ''}`;
  if (status === 429) return 'The AI is busy or your free allowance is used up. Try again in a minute.';
  return `The AI returned an error (${status})${msg ? `: ${msg}` : ''}`;
}

export async function chat({ ai, system = '', messages, tools = [], maxTokens = 4000, fetchImpl = globalThis.fetch, signal }) {
  const c = resolveConfig(ai);
  if (!c) throw new Error('Set up the AI assistant in ⚙️ Settings first');
  let url; let headers; let body;
  if (c.kind === 'anthropic') {
    url = `${c.baseUrl}/messages`;
    headers = { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    body = { model: c.model, max_tokens: maxTokens, system, messages: toAnthropic(messages),
      ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}) };
  } else {
    url = `${c.baseUrl}/chat/completions`;
    headers = { 'content-type': 'application/json', ...(c.key ? { authorization: `Bearer ${c.key}` } : {}) };
    body = { model: c.model, messages: toOpenAI(messages, system),
      ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}) };
  }
  let res;
  try { res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal }); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error("Couldn't reach the AI service. Check your internet — some work or school networks block it.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError(res.status, json));
  return c.kind === 'anthropic' ? fromAnthropic(json) : fromOpenAI(json);
}
