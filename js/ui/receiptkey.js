// ⚙️ → 🧠 Receipt key: everything the app has learned about receipt wording. Shared via sync.
import { esc, openSheet, sheetHeader, refreshSheet } from './dom.js';
import { getIngredient, findIngredient, suggestIngredients, makeCustomIngredient, titleCase, normText, allIngredients } from '../core/normalizer.js';
import { receiptKeyText, teachReceipt } from '../core/receipt.js';
import { LOCATION_LABEL } from '../core/kitchen.js';

let filter = '';
let msg = '';

function entryRow(e) {
  const ing = e.ignore ? null : (getIngredient(e.ingredientId) || e.custom);
  return `<div class="rk-row">
    <span class="rk-key"><b>${esc(e.key.toUpperCase())}</b>${e.example && normText(e.example) !== e.key ? `<small>${esc(e.example)}</small>` : ''}</span>
    <span class="rk-arrow" aria-hidden="true">→</span>
    <span class="rk-val">${e.ignore ? '🚫 Skip (not food)' : `${ing?.emoji || '🛒'} ${esc(ing?.name || e.ingredientId)}${e.location ? ` <small>· ${LOCATION_LABEL[e.location]}</small>` : ''}`}</span>
    <button type="button" class="x" data-action="rk-forget" data-id="${e.id}" aria-label="Forget ${esc(e.key)}">×</button>
  </div>`;
}

function render(ctx) {
  return () => {
    const all = [...ctx.store.state.receiptKey].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const q = normText(filter);
    const shown = q ? all.filter((e) => e.key.includes(q) || normText(getIngredient(e.ingredientId)?.name || e.custom?.name || '').includes(q)) : all;
    return `${sheetHeader('🧠', 'Receipt key', `${all.length} wording${all.length === 1 ? '' : 's'} learned · shared with your household when sync is on`)}
      <p class="muted small" style="margin-top:0">When you correct an item after scanning, the receipt’s wording is saved here so it’s recognised next time. You can also add rules yourself.</p>
      <form class="card rk-add" data-submit="rk-add" autocomplete="off">
        <div class="section-title" style="margin:0 0 8px">Add a rule</div>
        <label class="field"><span>Receipt says</span><input class="input" name="said" required placeholder="e.g. TESCO WATERMELON EACH"></label>
        <label class="field"><span>It is</span><input class="input" name="is" list="rk-ings" placeholder="e.g. Watermelon (leave blank to skip it)"></label>
        <datalist id="rk-ings">${allIngredients().filter((i) => !i.always).map((i) => `<option value="${esc(i.name)}">`).join('')}</datalist>
        <label class="field"><span>Usually goes in</span>
          <select class="input" name="loc"><option value="">Its normal place</option>${Object.entries(LOCATION_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        ${msg ? `<div class="notice ok">${esc(msg)}</div>` : ''}
        <button class="btn primary block" type="submit">＋ Save rule</button>
      </form>
      ${all.length > 6 ? `<input class="input" id="rk-filter" style="margin-top:14px" placeholder="Search learned wording…" value="${esc(filter)}" data-input="rk-filter">` : ''}
      <div class="rk-list" id="rk-list">${shown.map(entryRow).join('') || '<p class="empty small">Nothing learned yet — correct an item after scanning a receipt.</p>'}</div>`;
  };
}

export function openReceiptKey(ctx) { filter = ''; msg = ''; openSheet(render(ctx), { focus: false }); }

export const actions = {
  'rk-open': (el, ev, ctx) => openReceiptKey(ctx),
  'rk-forget': (el, ev, ctx) => {
    const e = ctx.store.state.receiptKey.find((x) => x.id === el.dataset.id);
    ctx.store.update((s) => { s.receiptKey = s.receiptKey.filter((x) => x.id !== e.id); ctx.store.tombstone(e.id); }, { label: `Forgot “${esc(e.key)}”` });
  },
};

export const inputs = {
  'rk-filter': (el, ev, ctx) => { filter = el.value; const tmp = render(ctx)(); const m = tmp.match(/<div class="rk-list" id="rk-list">([\s\S]*)<\/div>$/); if (m) document.getElementById('rk-list').innerHTML = m[1]; },
};

export const submits = {
  'rk-add': (form, ev, ctx) => {
    const said = form.said.value.trim();
    const keyText = receiptKeyText(said);
    if (!keyText) { msg = ''; return; }
    const isText = form.is.value.trim();
    const loc = form.loc.value || null;
    let ing = null;
    if (isText) {
      ing = allIngredients().find((i) => normText(i.name) === normText(isText)) || findIngredient(isText) || suggestIngredients(isText, 1)[0] || null;
      if (!ing || normText(ing.name) !== normText(isText) && !findIngredient(isText)) ing = { ...makeCustomIngredient(titleCase(normText(isText))), store: loc || 'pantry' };
    }
    ctx.store.update((s) => teachReceipt(s, { keyText, ingredientId: ing?.id, custom: ing?.custom ? ing : null, location: loc, ignore: !ing, example: said }));
    msg = ing ? `Saved: “${keyText}” → ${ing.name}` : `Saved: “${keyText}” will be skipped`;
    refreshSheet();
  },
};
