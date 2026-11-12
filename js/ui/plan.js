// "Plan" — Monday–Sunday week, tap or drag to assign, auto-fill, 1-click shopping list.
import { esc, openSheet, closeSheet, sheetHeader } from './dom.js';
import { DAYS, DAY_NAMES, MEALS, addDays, parseISODate, isoDate, nowISO, weekStartOf } from '../core/util.js';
import { getWeek, emptyWeek, autoFillWeek } from '../core/planner.js';
import { rankRecipes } from '../core/matching.js';
import { buildShoppingItems, mergeRegenerated } from '../core/shopping.js';

const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const BADGE_TEXT = { ready: '✅ Ready', expiring: '⏰ Uses expiring', nearly: '🛒 Missing 1–2' };
const fmtDay = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export const title = () => 'Meal plan';
export function subtitle(ctx) {
  const wk = getWeek(ctx.store.state, ctx.ui.week);
  return `${DAYS.filter((d) => wk.days[d]?.dinner?.recipeId).length} of 7 dinners planned`;
}

export function render(ctx) {
  const { state } = ctx.store;
  const wkStart = ctx.ui.week;
  const week = getWeek(state, wkStart);
  const recipes = new Map(state.recipes.map((r) => [r.id, r]));
  const today = isoDate();
  const thisWeek = weekStartOf();
  const label = wkStart === thisWeek ? 'This week' : wkStart === addDays(thisWeek, 7) ? 'Next week' : wkStart === addDays(thisWeek, -7) ? 'Last week' : `w/c ${fmtDay(parseISODate(wkStart))}`;
  return `
  <div class="week-nav">
    <button type="button" class="icon-btn" data-action="week-shift" data-n="-7" aria-label="Previous week">‹</button>
    <div style="text-align:center"><strong>${label}</strong><div class="muted" style="font-size:.85rem">${fmtDay(parseISODate(wkStart))} – ${fmtDay(parseISODate(addDays(wkStart, 6)))}</div></div>
    <button type="button" class="icon-btn" data-action="week-shift" data-n="7" aria-label="Next week">›</button>
  </div>
  <div class="row wrap" style="margin-bottom:14px">
    <button type="button" class="btn grow" data-action="plan-autofill">✨ Auto-fill week</button>
    <button type="button" class="btn primary grow" data-action="plan-shop">🛒 Make shopping list</button>
  </div>
  <div class="days">
    ${DAYS.map((d, i) => {
      const date = addDays(wkStart, i);
      const slots = week.days[d] || {};
      const meals = MEALS.filter((m) => m === 'dinner' || slots[m]?.recipeId || (m === 'lunch' && state.settings.showLunch) || (m === 'breakfast' && state.settings.showBreakfast));
      return `<section class="card day ${date === today ? 'today' : ''}" aria-label="${DAY_NAMES[d]}">
        <div class="day-head">${DAY_NAMES[d]} <span class="muted">${parseISODate(date).getDate()}</span>${date === today ? ' <span class="badge today">Today</span>' : ''}</div>
        <div class="slots">${meals.map((m) => {
          const r = recipes.get(slots[m]?.recipeId);
          if (!r) return `<button type="button" class="meal empty" data-action="slot-pick" data-day="${d}" data-meal="${m}" data-drop="${d}|${m}">＋ ${MEAL_LABEL[m]}</button>`;
          return `<div class="meal" draggable="true" data-drag="${d}|${m}" data-drop="${d}|${m}">
            <button type="button" class="row grow meal-open" data-action="slot-open" data-day="${d}" data-meal="${m}">
              <span class="em" aria-hidden="true">${r.emoji}</span>
              <span class="txt"><span class="slot-label">${MEAL_LABEL[m]}</span><span class="nm">${esc(r.title)}</span></span></button>
            <button type="button" class="x" data-action="slot-clear" data-day="${d}" data-meal="${m}" aria-label="Remove ${esc(r.title)}">×</button>
          </div>`;
        }).join('')}</div></section>`;
    }).join('')}
  </div>
  <p class="muted hint">Tap a slot to choose · drag meals between days on a computer</p>`;
}

function setSlot(ctx, day, meal, value, label) {
  const wk = ctx.ui.week;
  ctx.store.update((s) => {
    s.plans[wk] ||= emptyWeek(wk);
    if (value) s.plans[wk].days[day][meal] = value; else delete s.plans[wk].days[day][meal];
    s.plans[wk].updatedAt = nowISO();
  }, { label });
}

function pickerList(ctx, day, meal) {
  const q = (ctx.ui.pickQuery || '').toLowerCase();
  const ranked = rankRecipes(ctx.store.state.recipes, ctx.store.state.inventory).filter(({ recipe }) => !q || recipe.title.toLowerCase().includes(q));
  return ranked.map(({ recipe: r, match: m }) => `
    <button type="button" data-action="slot-assign" data-day="${day}" data-meal="${meal}" data-id="${r.id}">
      <span class="em">${r.emoji}</span><span class="txt"><span class="nm">${esc(r.title)}</span>
      <span class="sub">${m.badges.map((b) => `<span class="badge ${b}">${BADGE_TEXT[b]}</span>`).join('') || `<span>${m.pct}% in stock</span>`}</span></span></button>`).join('')
    || '<p class="empty">No recipes found.</p>';
}

function pickerSheet(ctx, day, meal) {
  return () => `${sheetHeader('🍽️', `${DAY_NAMES[day]} ${MEAL_LABEL[meal].toLowerCase()}`, 'Best matches for what you have are first')}
    <input class="input" id="pick-q" placeholder="Search recipes…" value="${esc(ctx.ui.pickQuery || '')}" data-input="pick-search" data-day="${day}" data-meal="${meal}">
    <div class="pick-list" id="pick-list">${pickerList(ctx, day, meal)}</div>`;
}

function slotSheet(ctx, day, meal) {
  return () => {
    const slot = getWeek(ctx.store.state, ctx.ui.week).days[day]?.[meal];
    const r = ctx.store.state.recipes.find((x) => x.id === slot?.recipeId);
    if (!r) return '<p class="empty">Slot is empty.</p>';
    return `${sheetHeader(r.emoji, esc(r.title), `${DAY_NAMES[day]} · ${MEAL_LABEL[meal]}`)}
      <div class="field"><span>Cooking for</span><div class="stepper" style="justify-content:space-between">
        <button type="button" data-action="slot-serves" data-day="${day}" data-meal="${meal}" data-dir="-1" aria-label="Fewer">−</button>
        <output>${slot.servings || r.servings} people</output>
        <button type="button" data-action="slot-serves" data-day="${day}" data-meal="${meal}" data-dir="1" aria-label="More">+</button></div></div>
      <div class="sheet-actions">
        <button type="button" class="btn" data-action="recipe-open" data-id="${r.id}">📖 View recipe</button>
        <button type="button" class="btn" data-action="slot-pick" data-day="${day}" data-meal="${meal}">🔄 Swap</button>
        <button type="button" class="btn danger" data-action="slot-clear" data-day="${day}" data-meal="${meal}">Remove</button>
      </div>`;
  };
}

export function generateList(ctx) {
  const { state } = ctx.store;
  const fresh = buildShoppingItems({ week: getWeek(state, ctx.ui.week), recipes: state.recipes, inventory: state.inventory });
  ctx.store.update((s) => {
    s.shopping = { ...s.shopping, items: mergeRegenerated(s.shopping.items, fresh), generatedAt: nowISO(), weekStart: ctx.ui.week, updatedAt: nowISO() };
  }, { label: `🛒 ${fresh.length} things to buy` });
  ctx.ui.tab = 'shop';
  ctx.render();
}

export const actions = {
  'week-shift': (el, ev, ctx) => { ctx.ui.week = addDays(ctx.ui.week, +el.dataset.n); ctx.render(); },
  'slot-pick': (el, ev, ctx) => { ctx.ui.pickQuery = ''; openSheet(pickerSheet(ctx, el.dataset.day, el.dataset.meal), { focus: false }); },
  'slot-open': (el, ev, ctx) => openSheet(slotSheet(ctx, el.dataset.day, el.dataset.meal), { focus: false }),
  'slot-assign': (el, ev, ctx) => {
    const r = ctx.store.state.recipes.find((x) => x.id === el.dataset.id);
    closeSheet();
    setSlot(ctx, el.dataset.day, el.dataset.meal, { recipeId: r.id, servings: r.servings }, `${esc(r.title)} on ${DAY_NAMES[el.dataset.day]}`);
  },
  'slot-clear': (el, ev, ctx) => { closeSheet(); setSlot(ctx, el.dataset.day, el.dataset.meal, null, 'Removed from plan'); },
  'slot-serves': (el, ev, ctx) => {
    const wk = ctx.ui.week;
    ctx.store.update((s) => {
      const slot = s.plans[wk]?.days[el.dataset.day]?.[el.dataset.meal];
      if (!slot) return;
      const r = s.recipes.find((x) => x.id === slot.recipeId);
      slot.servings = Math.max(1, (slot.servings || r?.servings || 4) + +el.dataset.dir);
      s.plans[wk].updatedAt = nowISO();
    });
  },
  'plan-autofill': (el, ev, ctx) => {
    const { state } = ctx.store;
    const wk = ctx.ui.week;
    const picks = autoFillWeek({ recipes: state.recipes, inventory: state.inventory, week: getWeek(state, wk) });
    const n = Object.keys(picks).length;
    if (!n) { ctx.toast('Mon–Fri dinners are already planned 👍'); return; }
    ctx.store.update((s) => {
      s.plans[wk] ||= emptyWeek(wk);
      for (const [day, id] of Object.entries(picks)) s.plans[wk].days[day].dinner = { recipeId: id, servings: s.recipes.find((x) => x.id === id).servings };
      s.plans[wk].updatedAt = nowISO();
    }, { label: `✨ Planned ${n} dinner${n > 1 ? 's' : ''} around what needs using` });
  },
  'plan-shop': (el, ev, ctx) => generateList(ctx),
};

export const inputs = {
  'pick-search': (el, ev, ctx) => { ctx.ui.pickQuery = el.value; document.getElementById('pick-list').innerHTML = pickerList(ctx, el.dataset.day, el.dataset.meal); },
};

export function mount(root, ctx) {
  let from = null;
  root.querySelectorAll('[data-drag]').forEach((el) => {
    el.addEventListener('dragstart', (e) => { from = el.dataset.drag; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', from); });
  });
  root.querySelectorAll('[data-drop]').forEach((el) => {
    el.addEventListener('dragover', (e) => { if (from) { e.preventDefault(); el.classList.add('drop-target'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); el.classList.remove('drop-target');
      const to = el.dataset.drop;
      if (!from || from === to) return;
      const [fd, fm] = from.split('|'); const [td, tm] = to.split('|');
      const wk = ctx.ui.week;
      ctx.store.update((s) => {
        const days = s.plans[wk].days;
        const a = days[fd][fm]; const b = days[td][tm];
        days[td][tm] = a; if (b) days[fd][fm] = b; else delete days[fd][fm];
        s.plans[wk].updatedAt = nowISO();
      }, { label: 'Moved meal' });
      from = null;
    });
  });
}
