// "Cook" — recipes ranked by what's in, detail view, import & edit.
import { esc, openSheet, closeSheet, sheetHeader, refreshSheet } from './dom.js';
import { rankRecipes, matchRecipe } from '../core/matching.js';
import { normalizeLine, detectSystem, getIngredient } from '../core/normalizer.js';
import { fetchHtml, extractRecipeFromHtml, parseRecipeText, buildRecipe } from '../core/importer.js';
import { makeShoppingItem } from '../core/shopping.js';
import { registerCustom } from '../core/kitchen.js';
import { DAYS, DAY_NAMES, nowISO, addDays, parseISODate } from '../core/util.js';
import { getWeek, emptyWeek } from '../core/planner.js';

const FILTERS = [
  { id: 'all', label: 'All' }, { id: 'ready', label: '✅ Ready to cook' },
  { id: 'expiring', label: '⏰ Uses expiring' }, { id: 'nearly', label: '🛒 Missing 1–2' },
];
const BADGE_TEXT = { ready: '✅ Ready to cook', expiring: '⏰ Uses expiring', nearly: '🛒 Missing 1–2' };

export const title = () => 'What can I cook?';
export function subtitle(ctx) {
  const ready = rankRecipes(ctx.store.state.recipes, ctx.store.state.inventory).filter((r) => r.match.status === 'ready').length;
  return `${ready} ready now · ${ctx.store.state.recipes.length} recipes`;
}

function hero(r) {
  return `<div class="hero" aria-hidden="true">${r.emoji || '🍽️'}${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>`;
}
const mins = (r) => (r.totalMins ? `⏱ ${r.totalMins} min` : '');
const badges = (m) => m.badges.map((b) => `<span class="badge ${b}">${BADGE_TEXT[b]}</span>`).join('');

export function render(ctx) {
  const { state } = ctx.store;
  const ranked = rankRecipes(state.recipes, state.inventory);
  const f = ctx.ui.cookFilter;
  const count = (id) => (id === 'all' ? ranked.length : ranked.filter((r) => r.match.badges.includes(id)).length);
  const shown = f === 'all' ? ranked : ranked.filter((r) => r.match.badges.includes(f));
  return `
  <div class="toolbar"><button type="button" class="btn primary" data-action="recipe-add">＋ Add recipe</button>
    <button type="button" class="btn ghost" data-action="ask" data-q="What can I cook tonight with what I've got?">✨ Ask for ideas</button></div>
  <div class="chips" role="group" aria-label="Filter recipes">
    ${FILTERS.map((x) => `<button type="button" class="chip" data-action="cook-filter" data-f="${x.id}" aria-pressed="${f === x.id}">${x.label} <span class="n">${count(x.id)}</span></button>`).join('')}
  </div>
  ${shown.length ? `<div class="recipe-grid">${shown.map(({ recipe: r, match: m }) => `
    <button type="button" class="card recipe-card" data-action="recipe-open" data-id="${r.id}">
      ${hero(r)}
      <div class="recipe-body">
        <h3>${esc(r.title)}</h3>
        <div class="meta">${mins(r)}<span>🍽 Serves ${r.servings}</span></div>
        ${m.badges.length ? `<div class="badges">${badges(m)}</div>` : ''}
        <div class="bar" aria-label="${m.pct}% of ingredients in stock"><i style="width:${m.pct}%"></i></div>
        <div class="need">${m.missing.length ? `Need: ${m.missing.slice(0, 4).map((x) => esc(x.name)).join(', ')}${m.missing.length > 4 ? '…' : ''}` : 'You have everything 🎉'}</div>
      </div>
    </button>`).join('')}</div>`
    : `<div class="empty"><div class="big">🍳</div>${state.recipes.length ? 'No recipes match this filter.' : 'No recipes yet — add your first one!'}</div>`}`;
}

function detailSheet(ctx, id) {
  return () => {
    const r = ctx.store.state.recipes.find((x) => x.id === id);
    if (!r) return '<p class="empty">Recipe deleted.</p>';
    const m = matchRecipe(r, ctx.store.state.inventory);
    const haveIds = new Set(m.have.map((x) => x.ingredientId));
    const missIds = new Set(m.missing.map((x) => x.ingredientId));
    return `${hero(r)}
      <h2 id="sheet-title">${esc(r.title)}</h2>
      <div class="meta" style="margin:6px 0 10px">${mins(r)}<span>🍽 Serves ${r.servings}</span>${r.system === 'US' ? '<span>🇺🇸→🇬🇧 converted</span>' : ''}</div>
      <div class="badges">${badges(m)}</div>
      <div class="sheet-actions">
        <button type="button" class="btn primary" data-action="recipe-plan" data-id="${id}">📅 Add to plan</button>
        ${m.missing.length ? `<button type="button" class="btn terra" data-action="recipe-missing" data-id="${id}">🛒 Add ${m.missing.length} missing</button>` : ''}
        <button type="button" class="btn" data-action="recipe-edit" data-id="${id}">✏️ Edit</button>
      </div>
      <div class="section-title">Ingredients</div>
      <ul class="ing-list">${r.ingredients.map((l) => {
        const mark = haveIds.has(l.ingredientId) ? '<span class="ok" aria-label="In stock">✓</span>'
          : missIds.has(l.ingredientId) ? '<span class="no" aria-label="Missing">○</span>' : '<span class="muted">·</span>';
        return `<li>${mark}<span><b>${esc(l.display || '')}</b> ${esc(l.name)}${l.note ? `, <span class="muted">${esc(l.note)}</span>` : ''}<span class="orig">${esc(l.raw)}</span></span></li>`;
      }).join('')}</ul>
      ${r.method?.length ? `<div class="section-title">Method</div><ol class="method">${r.method.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
      ${r.sourceUrl ? `<p style="margin-top:16px"><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">Open original recipe ↗</a></p>` : ''}
      <div class="sheet-actions"><button type="button" class="btn danger" data-action="recipe-delete" data-id="${id}">🗑 Delete recipe</button></div>`;
  };
}

function planSheet(ctx, id) {
  return () => {
    const r = ctx.store.state.recipes.find((x) => x.id === id);
    const wk = ctx.ui.week;
    const week = getWeek(ctx.store.state, wk);
    const recipes = new Map(ctx.store.state.recipes.map((x) => [x.id, x]));
    return `${sheetHeader(r.emoji, 'Which day?', esc(r.title))}
      <div class="pick-list">${DAYS.map((d, i) => {
        const cur = recipes.get(week.days[d]?.dinner?.recipeId);
        return `<button type="button" data-action="recipe-plan-day" data-id="${id}" data-day="${d}">
          <span class="em">${cur ? cur.emoji : '➕'}</span><span class="txt"><span class="nm">${DAY_NAMES[d]} <span class="muted">${parseISODate(addDays(wk, i)).getDate()}</span></span>
          <span class="sub">${cur ? `Replaces ${esc(cur.title)}` : 'Dinner is free'}</span></span></button>`;
      }).join('')}</div>`;
  };
}

// ── Add / import / edit ───────────────────────────────────────────
const draft = { mode: 'link', url: '', paste: '', busy: false, error: '', raw: null, editingId: null };

function previewLines(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const pint = detectSystem(lines);
  return lines.slice(0, 40).map((l) => {
    const n = normalizeLine(l, { pint });
    return `<li><span class="grow">${esc(l)}</span><span class="arrow">→</span><b>${esc(n.display || '—')}</b>&nbsp;${esc(n.name)}${n.newIngredient ? ' <span class="new">new</span>' : ''}</li>`;
  }).join('');
}

function editForm(raw) {
  const ing = (raw.ingredients || []).join('\n');
  return `
    <form data-submit="recipe-save" autocomplete="off">
      <label class="field"><span>Name</span><input class="input" name="title" required value="${esc(raw.title || '')}" placeholder="e.g. Mum's lasagne"></label>
      <div class="row">
        <label class="field" style="width:84px"><span>Icon</span><input class="input" name="emoji" value="${esc(raw.emoji || '')}" placeholder="🍽️" maxlength="4" style="text-align:center"></label>
        <label class="field grow"><span>Serves</span><input class="input" name="servings" type="number" min="1" inputmode="numeric" value="${raw.servings || 4}"></label>
        <label class="field grow"><span>Minutes</span><input class="input" name="totalMins" type="number" min="0" inputmode="numeric" value="${raw.totalMins || ''}"></label>
      </div>
      <label class="field"><span>Ingredients — one per line, any units</span>
        <textarea class="input" name="ingredients" id="rf-ing" data-input="recipe-preview" placeholder="1/2 cup butter&#10;2 tbsp honey&#10;400g chopped tomatoes">${esc(ing)}</textarea></label>
      <div class="section-title" style="margin-top:0">How we'll store it (UK units)</div>
      <ul class="preview-list" id="rf-preview">${previewLines(ing)}</ul>
      <label class="field"><span>Method — one step per line</span>
        <textarea class="input" name="method" placeholder="Preheat oven to 350°F…">${esc((raw.method || []).join('\n'))}</textarea></label>
      <details><summary class="muted" style="margin-bottom:10px">More (photo, source link)</summary>
        <label class="field"><span>Photo URL</span><input class="input" name="image" value="${esc(raw.image || '')}"></label>
        <label class="field"><span>Source link</span><input class="input" name="sourceUrl" value="${esc(raw.sourceUrl || '')}"></label>
      </details>
      <div class="sheet-actions"><button type="button" class="btn" data-action="sheet-close">Cancel</button><button type="submit" class="btn primary">💾 Save recipe</button></div>
    </form>`;
}

function addSheet() {
  return () => {
    if (draft.raw) return `${sheetHeader('📝', draft.editingId ? 'Edit recipe' : 'Check & save', 'Units are converted to UK automatically')}${editForm(draft.raw)}`;
    const tabs = [['link', '🔗 Link'], ['paste', '📋 Paste'], ['type', '✍️ Type']];
    return `${sheetHeader('📖', 'Add a recipe')}
      <div class="seg" role="group" style="margin-bottom:14px">${tabs.map(([id, l]) => `<button type="button" data-action="ra-mode" data-mode="${id}" aria-pressed="${draft.mode === id}">${l}</button>`).join('')}</div>
      ${draft.error ? `<div class="notice">${esc(draft.error)}</div>` : ''}
      ${draft.mode === 'link' ? `
        <form data-submit="ra-import">
          <label class="field"><span>Recipe web address</span><input class="input" id="ra-url" name="url" type="url" inputmode="url" required placeholder="https://www.bbcgoodfood.com/recipes/…" value="${esc(draft.url)}" autofocus></label>
          <button class="btn primary block" type="submit" ${draft.busy ? 'disabled' : ''}>${draft.busy ? '<span class="spinner"></span> Fetching…' : '✨ Import recipe'}</button>
          <p class="muted" style="font-size:.82rem">We read the recipe card most food sites publish. If a site blocks us, use Paste.</p>
        </form>` : ''}
      ${draft.mode === 'paste' ? `
        <form data-submit="ra-paste">
          <label class="field"><span>Paste the whole recipe</span><textarea class="input" name="text" id="ra-text" style="min-height:220px" placeholder="Title&#10;&#10;Ingredients&#10;1 cup flour&#10;…&#10;&#10;Method&#10;1. Preheat oven…" autofocus>${esc(draft.paste)}</textarea></label>
          <button class="btn primary block" type="submit">Read recipe</button>
        </form>` : ''}
      ${draft.mode === 'type' ? editForm({}) : ''}`;
  };
}

function openAdd(preset = {}) {
  Object.assign(draft, { mode: 'link', url: '', paste: '', busy: false, error: '', raw: null, editingId: null }, preset);
  openSheet(addSheet());
}

export const actions = {
  'cook-filter': (el, ev, ctx) => { ctx.ui.cookFilter = el.dataset.f; ctx.render(); },
  'recipe-open': (el, ev, ctx) => openSheet(detailSheet(ctx, el.dataset.id), { focus: false }),
  'recipe-add': () => openAdd(),
  'ra-mode': (el) => { draft.mode = el.dataset.mode; draft.error = ''; refreshSheet(); },
  'recipe-edit': (el, ev, ctx) => {
    const r = ctx.store.state.recipes.find((x) => x.id === el.dataset.id);
    openAdd({ editingId: r.id, raw: { ...r, ingredients: r.ingredients.map((l) => l.raw) } });
  },
  'recipe-delete': (el, ev, ctx) => {
    const r = ctx.store.state.recipes.find((x) => x.id === el.dataset.id);
    closeSheet();
    ctx.store.update((s) => { s.recipes = s.recipes.filter((x) => x.id !== r.id); ctx.store.tombstone(r.id); }, { label: `Deleted ${esc(r.title)}` });
  },
  'recipe-plan': (el, ev, ctx) => openSheet(planSheet(ctx, el.dataset.id), { focus: false }),
  'recipe-plan-day': (el, ev, ctx) => {
    const r = ctx.store.state.recipes.find((x) => x.id === el.dataset.id);
    const wk = ctx.ui.week;
    closeSheet();
    ctx.store.update((s) => {
      s.plans[wk] ||= emptyWeek(wk);
      s.plans[wk].days[el.dataset.day].dinner = { recipeId: r.id, servings: r.servings };
      s.plans[wk].updatedAt = nowISO();
    }, { label: `${esc(r.title)} on ${DAY_NAMES[el.dataset.day]}` });
  },
  'recipe-missing': (el, ev, ctx) => {
    const r = ctx.store.state.recipes.find((x) => x.id === el.dataset.id);
    const m = matchRecipe(r, ctx.store.state.inventory);
    ctx.store.update((s) => {
      for (const miss of m.missing) {
        if (s.shopping.items.some((i) => i.ingredientId === miss.ingredientId && !i.checked)) continue;
        const ing = getIngredient(miss.ingredientId) || { id: miss.ingredientId, name: miss.name, base: miss.baseUnit, aisle: 'Other' };
        s.shopping.items.push(makeShoppingItem(ing, { buyQty: miss.parts.length ? miss.baseQty : null, sources: [r.title] }));
      }
      s.shopping.updatedAt = nowISO();
    }, { label: `Added ${m.missing.length} to shopping` });
  },
};

export const inputs = {
  'recipe-preview': (el) => { document.getElementById('rf-preview').innerHTML = previewLines(el.value); },
};

export const submits = {
  'ra-import': async (form) => {
    draft.url = form.url.value.trim();
    draft.busy = true; draft.error = ''; refreshSheet();
    try {
      const raw = extractRecipeFromHtml(await fetchHtml(draft.url), draft.url);
      if (!raw || !raw.ingredients.length) Object.assign(draft, { busy: false, mode: 'paste', error: `Found the page${raw?.title ? ` “${raw.title}”` : ''} but no recipe card. Copy the recipe text and paste it here.` });
      else Object.assign(draft, { busy: false, raw });
    } catch (e) { Object.assign(draft, { busy: false, mode: 'paste', error: e.message }); }
    refreshSheet();
  },
  'ra-paste': (form) => {
    draft.paste = form.text.value;
    const raw = parseRecipeText(draft.paste);
    if (!raw || !raw.ingredients.length) { draft.error = "Couldn't spot the ingredients. Add a line saying “Ingredients” above them."; refreshSheet(); return; }
    draft.raw = raw; draft.error = ''; refreshSheet();
  },
  'recipe-save': (form, ev, ctx) => {
    const fd = new FormData(form);
    const existing = draft.editingId ? ctx.store.state.recipes.find((r) => r.id === draft.editingId) : {};
    const raw = {
      ...(draft.raw || {}), title: fd.get('title'), emoji: fd.get('emoji') || undefined,
      servings: +fd.get('servings') || 4, totalMins: +fd.get('totalMins') || null,
      ingredients: String(fd.get('ingredients')).split('\n').map((l) => l.trim()).filter(Boolean),
      method: String(fd.get('method')).split('\n').map((l) => l.trim()).filter(Boolean),
      image: fd.get('image') || '', sourceUrl: fd.get('sourceUrl') || '',
    };
    const { newIngredients, ...clean } = buildRecipe(raw, { ...existing, emoji: fd.get('emoji') || existing?.emoji });
    closeSheet();
    ctx.store.update((s) => {
      newIngredients.forEach((ni) => registerCustom(s, ni));
      const i = s.recipes.findIndex((r) => r.id === clean.id);
      if (i >= 0) s.recipes[i] = clean; else s.recipes.unshift(clean);
    }, { label: `Saved ${esc(clean.title)}` });
    draft.raw = null;
  },
};
