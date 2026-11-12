// ✨ Kitchen assistant chat (floating button on every screen).
import { esc, openSheet, refreshSheet, sheetHeader } from './dom.js';
import { runAgent, trimHistory } from '../ai/agent.js';
import { isConfigured, PROVIDERS } from '../ai/llm.js';
import { loadImage, toCanvas, canvasToImagePart } from '../ai/vision.js';
import { openSettings } from './settings.js';

const SUGGESTIONS = [
  'What can I make tonight?',
  "Plan this week's dinners around what needs using up",
  'Make my shopping list',
  "We've run out of milk and eggs",
  'Something quick and veggie for 2?',
];

const chat = { history: [], view: [], busy: false, draft: '', image: null, controller: null };
let ctxRef = null;
const Rec = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
let listening = false;

export function openAssistant(ctx, question = '') {
  ctxRef = ctx;
  openSheet(render, { focus: false, tall: true });
  if (question) send(question);
  else requestAnimationFrame(() => document.getElementById('chat-input')?.focus({ preventScroll: true }));
}

function fmt(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-•]\s+/gm, '• ');
}

function render() {
  const ai = ctxRef.store.state.settings.ai;
  if (!isConfigured(ai)) {
    return `${sheetHeader('✨', 'Kitchen assistant', 'Ask anything about your food, meals and shopping')}
      <div class="card setup-card">
        <p>The assistant uses an AI service with <b>your own key</b>, so nobody else pays or sees your data. One-time setup, about 2 minutes:</p>
        <ol><li>Get a free key from <b>${PROVIDERS.gemini.label}</b> (Google account needed).</li><li>Paste it into Settings.</li></ol>
        <button type="button" class="btn primary block" data-action="ai-setup">Set up the assistant</button>
      </div>
      <p class="muted hint">You can still scan receipts without it — they're read on your phone.</p>`;
  }
  const empty = !chat.view.length;
  return `${sheetHeader('✨', 'Kitchen assistant', `${PROVIDERS[ai.provider]?.label || 'AI'} · knows your kitchen, plan & list`)}
    <div class="chat" aria-live="polite">
      ${empty ? `<div class="bubble bot">Hi! I can see what's in your fridge, freezer and cupboard. Ask me for ideas, or tell me what to add, plan or buy.</div>
        <div class="chips wrap-chips">${SUGGESTIONS.map((s) => `<button type="button" class="chip" data-action="chat-suggest" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
      ${chat.view.map((m, i) => m.role === 'user'
        ? `<div class="bubble user">${m.image ? `<img src="${m.image}" alt="Your photo" class="chat-img">` : ''}${fmt(m.text)}</div>`
        : `<div class="bubble bot ${m.error ? 'err' : ''}">${fmt(m.text)}
            ${m.actions?.length ? `<div class="acts">${m.actions.map((a) => `<span class="act">✓ ${esc(a)}</span>`).join('')}</div>
              ${m.undoable ? `<button type="button" class="link-btn" data-action="chat-undo" data-i="${i}">↶ Undo these changes</button>` : m.undone ? '<span class="muted small">Undone</span>' : ''}` : ''}
          </div>`).join('')}
      ${chat.busy ? '<div class="bubble bot typing" aria-label="Thinking"><i></i><i></i><i></i></div>' : ''}
    </div>
    <form class="chat-bar" data-submit="chat-send" autocomplete="off">
      ${chat.image ? `<div class="chat-attach"><img src="${chat.image.url}" alt=""><button type="button" data-action="chat-unattach" aria-label="Remove photo">×</button></div>` : ''}
      <div class="row">
        <label class="icon-btn small" aria-label="Attach a photo"><input type="file" accept="image/*" hidden data-change="chat-photo">📷</label>
        <input class="input grow" id="chat-input" name="q" value="${esc(chat.draft)}" placeholder="${listening ? 'Listening…' : 'Ask or tell me something…'}" data-input="chat-draft" enterkeyhint="send" ${chat.busy ? 'disabled' : ''}>
        ${Rec ? `<button type="button" class="icon-btn small ${listening ? 'live' : ''}" data-action="chat-mic" aria-label="Speak">🎤</button>` : ''}
        <button type="submit" class="qa-go" aria-label="Send" ${chat.busy ? 'disabled' : ''}>↑</button>
      </div>
    </form>`;
}

async function send(text) {
  text = text.trim();
  if ((!text && !chat.image) || chat.busy) return;
  const { store } = ctxRef;
  const image = chat.image;
  const content = image ? [{ type: 'image', mediaType: image.mediaType, data: image.data }, { type: 'text', text: text || 'What can you see?' }] : text;
  chat.view.push({ role: 'user', text: text || '📷', image: image?.url });
  Object.assign(chat, { draft: '', image: null, busy: true, controller: new AbortController() });
  refreshSheet({ toBottom: true });
  const revBefore = store.rev;
  try {
    const res = await runAgent({ history: trimHistory(chat.history), userMessage: { role: 'user', content }, store, ai: store.state.settings.ai, signal: chat.controller.signal });
    chat.history.push(...res.messages);
    const changes = store.rev - revBefore;
    chat.view.push({ role: 'bot', text: res.reply, actions: res.actions, undoable: changes > 0, revAfter: store.rev, changes });
  } catch (e) {
    if (e.name !== 'AbortError') chat.view.push({ role: 'bot', text: e.message, error: true });
  }
  chat.busy = false;
  refreshSheet({ toBottom: true });
}

export const actions = {
  fab: (el, ev, ctx) => openAssistant(ctx),
  ask: (el, ev, ctx) => openAssistant(ctx, el.dataset.q || ''),
  'ai-setup': (el, ev, ctx) => openSettings(ctx, { focusAI: true }),
  'chat-suggest': (el) => send(el.dataset.q),
  'chat-unattach': () => { chat.image = null; refreshSheet(); },
  'chat-undo': (el, ev, ctx) => {
    const m = chat.view[+el.dataset.i];
    if (ctx.store.rev !== m.revAfter) { ctx.toast('Other changes were made since — use ↶ in the top bar instead'); return; }
    ctx.store.undo(m.changes);
    m.undoable = false; m.undone = true;
    chat.history.push({ role: 'user', content: '(I pressed Undo — the changes from your last reply were reverted.)' }, { role: 'assistant', content: 'OK, undone.' });
    refreshSheet();
  },
  'chat-mic': () => {
    if (!Rec) return;
    const r = new Rec();
    r.lang = 'en-GB'; r.interimResults = true; r.maxAlternatives = 1;
    listening = true; refreshSheet();
    r.onresult = (e) => {
      const t = [...e.results].map((x) => x[0].transcript).join('');
      chat.draft = t;
      const input = document.getElementById('chat-input');
      if (input) input.value = t;
      if (e.results[e.results.length - 1].isFinal) { listening = false; send(t); }
    };
    r.onerror = r.onend = () => { if (listening) { listening = false; refreshSheet(); } };
    r.start();
  },
};

export const inputs = { 'chat-draft': (el) => { chat.draft = el.value; } };

export const changes = {
  'chat-photo': async (el) => {
    const f = el.files?.[0]; el.value = '';
    if (!f) return;
    chat.image = canvasToImagePart(toCanvas(await loadImage(f), 1400));
    refreshSheet({ toBottom: true });
  },
};

export const submits = { 'chat-send': (form) => send(form.q.value) };
