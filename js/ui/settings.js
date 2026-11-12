// Settings: household sharing (auto-sync), AI assistant, receipt key, backup, meal slots, reset.
import { esc, openSheet, closeSheet, sheetHeader, refreshSheet } from './dom.js';
import { syncNow, syncReady } from '../sync.js';
import { PROVIDERS, chat as llmChat, isConfigured } from '../ai/llm.js';
import { openReceiptKey } from './receiptkey.js';

let syncMsg = { text: '', ok: true, busy: false };
let aiMsg = { text: '', ok: true, busy: false };
let pendingImport = null;

function ago(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function shareSection(st) {
  const g = st.gist || {};
  const on = syncReady({ settings: st });
  return `<div class="section-title" style="margin-top:0">👥 Share with your household</div>
    <div class="card share-card ${on ? 'on' : ''}">
      ${on ? `<p class="share-status">✅ <b>Sharing is on.</b> Your kitchen, recipes, meal plan, shopping list and receipt key stay in step on both phones${g.auto ? ' automatically' : ''}. Last synced ${ago(st.lastSync)}.</p>`
        : `<p class="small" style="margin-top:0">Right now everything — including <b>recipes</b> — is saved only on this phone. Link both phones to one private GitHub Gist and they stay in step automatically.</p>
           <ol class="small steps">
             <li>On github.com: profile picture → <b>Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token</b>. Tick only <b>gist</b>, set no expiry (or a long one), generate, copy.</li>
             <li><b>Phone 1:</b> paste the token below, tap <b>Sync now</b>. A Gist ID appears.</li>
             <li><b>Phone 2:</b> paste the same token <i>and</i> that Gist ID, tap <b>Sync now</b>.</li>
           </ol>`}
      ${syncMsg.text ? `<div class="notice ${syncMsg.ok ? 'ok' : ''}">${esc(syncMsg.text)}</div>` : ''}
      <label class="field"><span>GitHub token</span><input class="input" type="password" id="gist-token" autocomplete="off" value="${esc(g.token || '')}" data-change="gist-token" placeholder="ghp_…"></label>
      <label class="field"><span>Gist ID ${g.id ? '<small class="muted">— enter this on the other phone</small>' : ''}</span>
        <input class="input" id="gist-id" autocomplete="off" value="${esc(g.id || '')}" data-change="gist-id" placeholder="Leave blank on the first phone"></label>
      <label class="tick-list"><input type="checkbox" data-change="gist-auto" ${g.auto ? 'checked' : ''}> Sync automatically (when the app opens and a few seconds after each change)</label>
      <button type="button" class="btn primary block" data-action="gist-sync" ${syncMsg.busy || !g.token ? 'disabled' : ''}>${syncMsg.busy ? '<span class="spinner"></span> Syncing…' : '🔄 Sync now'}</button>
    </div>`;
}

function aiSection(st) {
  const ai = st.ai;
  const p = PROVIDERS[ai.provider];
  return `<div class="section-title" id="ai-section">✨ AI assistant (optional)</div>
    <p class="muted small" style="margin-top:0">Powers the chat and reading photos of your shopping. Uses your own key — it stays on this phone and is never included in backups or sync. Set it up on each phone.</p>
    <div class="provider-grid">${Object.entries(PROVIDERS).map(([id, x]) => `<button type="button" data-action="ai-provider" data-p="${id}" aria-pressed="${ai.provider === id}"><b>${x.label}</b><small>${x.note}</small></button>`).join('')}</div>
    ${p ? `
      ${p.keyUrl ? `<p class="small"><a href="${p.keyUrl}" target="_blank" rel="noopener">Get a ${p.label} key ↗</a>${ai.provider === 'gemini' ? ' — sign in with Google, then press “Create API key”.' : ' — set a monthly spending limit while you are there.'}</p>` : ''}
      <label class="field"><span>API key</span><input class="input" type="password" id="ai-key" autocomplete="off" value="${esc(ai.key)}" data-change="ai-field" data-k="key" placeholder="Paste key here"></label>
      <details ${ai.provider === 'custom' ? 'open' : ''}><summary class="muted small" style="margin-bottom:10px">Advanced (model, address)</summary>
        <label class="field"><span>Model</span><input class="input" id="ai-model" value="${esc(ai.model)}" data-change="ai-field" data-k="model" placeholder="${esc(p.model || 'model name')}"></label>
        <label class="field"><span>API address</span><input class="input" id="ai-url" value="${esc(ai.baseUrl)}" data-change="ai-field" data-k="baseUrl" placeholder="${esc(p.baseUrl || 'https://…/v1')}"></label>
      </details>
      <label class="tick-list"><input type="checkbox" data-change="ai-receipts" ${ai.useForReceipts ? 'checked' : ''}> Use AI to read receipt photos (more accurate than the on-phone reader)</label>
      ${aiMsg.text ? `<div class="notice ${aiMsg.ok ? 'ok' : ''}">${esc(aiMsg.text)}</div>` : ''}
      <div class="sheet-actions" style="margin-top:6px">
        <button type="button" class="btn primary" data-action="ai-test" ${aiMsg.busy || !isConfigured(ai) ? 'disabled' : ''}>${aiMsg.busy ? '<span class="spinner"></span> Testing…' : '🔌 Test connection'}</button>
        <button type="button" class="btn ghost" data-action="ai-off">Turn off</button>
      </div>` : ''}`;
}

function settingsSheet(ctx) {
  return () => {
    const st = ctx.store.state.settings;
    const known = ctx.store.state.receiptKey.length;
    return `${sheetHeader('⚙️', 'Settings & sharing')}
      ${shareSection(st)}
      <div class="section-title">🧾 Receipt scanning</div>
      <button type="button" class="pick-row" data-action="rk-open"><span class="em">🧠</span><span class="txt"><span class="nm">Receipt key</span>
        <span class="sub">${known} learned wording${known === 1 ? '' : 's'} · view, add or forget</span></span><span class="chev">›</span></button>
      ${aiSection(st)}
      <div class="section-title">Backup</div>
      <div class="sheet-actions" style="margin-top:0">
        <button type="button" class="btn" data-action="backup-export">⬇️ Save backup file</button>
        <button type="button" class="btn" data-action="backup-import">⬆️ Load backup file</button>
      </div>
      <div class="section-title">Meal plan</div>
      <div class="big-choice" style="grid-template-columns:1fr 1fr">
        <button type="button" data-action="toggle-setting" data-key="showBreakfast" aria-pressed="${!!st.showBreakfast}">🥣 Breakfast slots</button>
        <button type="button" data-action="toggle-setting" data-key="showLunch" aria-pressed="${!!st.showLunch}">🥪 Lunch slots</button>
      </div>
      <div class="section-title">Data</div>
      <div class="sheet-actions" style="margin-top:0">
        <button type="button" class="btn" data-action="reset-demo">🧪 Reload demo data</button>
        <button type="button" class="btn danger" data-action="clear-all">🗑 Start empty</button>
      </div>
      <p class="muted small" style="text-align:center">Everything saves on this device automatically. Changed your mind? Use ↶ Undo at the top.</p>`;
  };
}

function importChoiceSheet() {
  return () => `${sheetHeader('📦', 'Load backup', `${pendingImport.recipes?.length || 0} recipes · ${pendingImport.inventory?.length || 0} items`)}
    <div class="pick-list">
      <button type="button" data-action="import-apply" data-mode="merge"><span class="em">🤝</span><span class="txt"><span class="nm">Merge with mine</span><span class="sub">Recommended — keeps the newest version of everything</span></span></button>
      <button type="button" data-action="import-apply" data-mode="replace"><span class="em">♻️</span><span class="txt"><span class="nm">Replace everything</span><span class="sub">This phone becomes an exact copy of the file</span></span></button>
    </div>`;
}

export function openSettings(ctx, { focusAI = false } = {}) {
  syncMsg = { text: '', ok: true, busy: false };
  aiMsg = { text: '', ok: true, busy: false };
  if (focusAI && !ctx.store.state.settings.ai.provider) ctx.store.update((s) => { s.settings.ai.provider = 'gemini'; });
  openSheet(settingsSheet(ctx), { focus: false });
  if (focusAI) requestAnimationFrame(() => document.getElementById('ai-key')?.focus());
}

export const actions = {
  'settings-open': (el, ev, ctx) => openSettings(ctx),
  'ai-provider': (el, ev, ctx) => { aiMsg = { text: '', ok: true, busy: false }; ctx.store.update((s) => { if (s.settings.ai.provider !== el.dataset.p) Object.assign(s.settings.ai, { provider: el.dataset.p, model: '', baseUrl: '' }); }); },
  'ai-off': (el, ev, ctx) => ctx.store.update((s) => { Object.assign(s.settings.ai, { provider: '', key: '', model: '', baseUrl: '' }); }),
  'ai-test': async (el, ev, ctx) => {
    aiMsg = { text: '', ok: true, busy: true }; refreshSheet();
    try {
      const r = await llmChat({ ai: ctx.store.state.settings.ai, messages: [{ role: 'user', content: 'Reply with exactly: Ready to help in the kitchen!' }], maxTokens: 300 });
      aiMsg = { text: `Working ✓ — “${(r.text || 'OK').slice(0, 80)}”`, ok: true, busy: false };
    } catch (e) { aiMsg = { text: e.message, ok: false, busy: false }; }
    refreshSheet();
  },
  'backup-export': (el, ev, ctx) => { ctx.store.downloadBackup(); ctx.toast('Backup saved to your downloads'); },
  'backup-import': () => document.getElementById('import-file').click(),
  'import-apply': (el, ev, ctx) => {
    const data = pendingImport; pendingImport = null; closeSheet();
    if (el.dataset.mode === 'replace') ctx.store.replaceAll({ ...data, settings: ctx.store.state.settings });
    else ctx.store.mergeIn(data);
    ctx.toast(el.dataset.mode === 'replace' ? 'Backup loaded' : 'Merged backup', { undo: () => ctx.store.undo() });
  },
  'gist-sync': async (el, ev, ctx) => {
    syncMsg = { text: '', ok: true, busy: true }; refreshSheet();
    try { const id = await syncNow(ctx.store); syncMsg = { text: `Synced ✓  Gist ID: ${id}`, ok: true, busy: false }; } catch (e) { syncMsg = { text: e.message, ok: false, busy: false }; }
    refreshSheet();
  },
  'toggle-setting': (el, ev, ctx) => ctx.store.update((s) => { s.settings[el.dataset.key] = !s.settings[el.dataset.key]; }),
  'reset-demo': (el, ev, ctx) => { closeSheet(); ctx.store.resetToDemo(); ctx.toast('Demo data loaded', { undo: () => ctx.store.undo() }); },
  'clear-all': (el, ev, ctx) => {
    closeSheet();
    ctx.store.update((s) => {
      const now = new Date().toISOString();
      for (const x of [...s.inventory, ...s.recipes, ...s.shopping.items]) s.tombstones[x.id] = now;
      s.inventory = []; s.recipes = []; s.plans = {}; s.shopping.items = [];
    }, { label: 'Cleared everything' });
  },
  'rk-open': (el, ev, ctx) => openReceiptKey(ctx),
};

export const changes = {
  'ai-field': (el, ev, ctx) => { aiMsg = { text: '', ok: true, busy: false }; ctx.store.update((s) => { s.settings.ai[el.dataset.k] = el.value.trim(); }, { source: 'settings' }); },
  'ai-receipts': (el, ev, ctx) => ctx.store.update((s) => { s.settings.ai.useForReceipts = el.checked; }, { source: 'settings' }),
  'gist-token': (el, ev, ctx) => ctx.store.update((s) => { s.settings.gist.token = el.value.trim(); }, { source: 'settings' }),
  'gist-id': (el, ev, ctx) => ctx.store.update((s) => { s.settings.gist.id = el.value.trim(); }, { source: 'settings' }),
  'gist-auto': (el, ev, ctx) => ctx.store.update((s) => { s.settings.gist.auto = el.checked; }, { source: 'settings' }),
  'import-file': async (el, ev, ctx) => {
    const file = el.files?.[0]; el.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.recipes) || !Array.isArray(data.inventory)) throw new Error();
      pendingImport = data;
      openSheet(importChoiceSheet(), { focus: false });
    } catch { ctx.toast("That file isn't a Larder backup"); }
  },
};
