// "Just been shopping?" — receipt photo / photo of the shopping / pasted order / "everything on my list"
// -> review screen -> put away. Tap any item name to correct it; the correction is remembered in the
// receipt key (shared between phones) so the same wording is right next time.
import { esc, openSheet, closeSheet, sheetHeader, refreshSheet } from './dom.js';
import { parseReceiptText, linesFromAI, learnedMap, reinterpret, teachReceipt } from '../core/receipt.js';
import { putAway, linesFromShoppingList, LOCATION_LABEL, LOCATIONS } from '../core/kitchen.js';
import { formatQty, getIngredient, suggestIngredients, makeCustomIngredient, titleCase, normText } from '../core/normalizer.js';
import { isConfigured } from '../ai/llm.js';
import { readImageWithAI, ocrImage, loadImage, toCanvas, canvasToImagePart } from '../ai/vision.js';

const LOC_EMOJI = { fridge: '❄️', freezer: '🧊', pantry: '🗄️' };
const scan = { step: 'choose', status: '', progress: 0, lines: [], store: null, source: '', error: '', notice: '', tickList: true, paste: '', fix: null, fixQuery: '', remember: true };
let ctxRef = null;

export function openScan(ctx) {
  ctxRef = ctx;
  Object.assign(scan, { step: 'choose', status: '', progress: 0, lines: [], store: null, source: '', error: '', notice: '', paste: '', fix: null, fixQuery: '', remember: true });
  openSheet(render, { focus: false });
}

const aiOn = () => isConfigured(ctxRef.store.state.settings.ai);
const learned = () => learnedMap(ctxRef.store.state.receiptKey);

function render() {
  if (scan.step === 'busy') {
    return `${sheetHeader('🔎', 'Reading…', esc(scan.status))}
      <div class="bar big-bar" role="progressbar" aria-valuenow="${Math.round(scan.progress * 100)}"><i style="width:${Math.max(6, scan.progress * 100)}%"></i></div>
      <p class="muted" style="text-align:center">This takes a few seconds. Keep this screen open.</p>`;
  }
  if (scan.step === 'paste') {
    return `${sheetHeader('📋', 'Paste your order', 'From an online order email, or type a quick list')}
      <form data-submit="scan-paste">
        <textarea class="input" name="text" id="scan-text" style="min-height:240px" autofocus placeholder="Semi skimmed milk 4 pints&#10;6 free range eggs&#10;Chicken breast fillets 640g&#10;Bananas x 5">${esc(scan.paste)}</textarea>
        <div class="sheet-actions"><button type="button" class="btn" data-action="scan-back">‹ Back</button><button class="btn primary" type="submit">Read list</button></div>
      </form>`;
  }
  if (scan.step === 'fix') return fixView();
  if (scan.step === 'review') return reviewView();

  const listCount = ctxRef.store.state.shopping.items.length;
  const ai = aiOn();
  const known = ctxRef.store.state.receiptKey.length;
  return `${sheetHeader('🛍️', 'Add your shopping', 'Pick whichever is quickest')}
    ${scan.error ? `<div class="notice">${esc(scan.error)}</div>` : ''}
    <div class="scan-opts">
      <label class="scan-opt">
        <input type="file" accept="image/*" hidden data-change="scan-file" data-kind="receipt">
        <span class="em">🧾</span><span class="txt"><span class="nm">Photo of the receipt</span>
        <span class="sub">${ai ? 'Read by your AI assistant' : 'Read on this phone — free, no account'}</span></span></label>
      <label class="scan-opt ${ai ? '' : 'disabled'}" ${ai ? '' : 'aria-disabled="true"'}>
        <input type="file" accept="image/*" hidden data-change="scan-file" data-kind="haul" ${ai ? '' : 'disabled'}>
        <span class="em">🧺</span><span class="txt"><span class="nm">Photo of the shopping</span>
        <span class="sub">${ai ? 'Lay it out on the counter and snap it' : 'Needs the AI assistant (⚙️ Settings)'}</span></span></label>
      <button type="button" class="scan-opt" data-action="scan-to-paste">
        <span class="em">📋</span><span class="txt"><span class="nm">Paste an online order</span><span class="sub">Tesco, Sainsbury's, Asda, Ocado emails…</span></span></button>
      <button type="button" class="scan-opt" data-action="scan-list" ${listCount ? '' : 'disabled'}>
        <span class="em">✅</span><span class="txt"><span class="nm">I got everything on my list</span>
        <span class="sub">${listCount ? `${listCount} item${listCount > 1 ? 's' : ''} — untick anything you missed` : 'Your shopping list is empty'}</span></span></button>
    </div>
    <p class="muted hint">${known ? `🧠 Knows ${known} receipt wording${known > 1 ? 's' : ''} you've taught it. ` : ''}Tip: flatten the receipt in good light.</p>`;
}

function reviewView() {
  const inc = scan.lines.filter((l) => l.include);
  const food = inc.filter((l) => l.kind !== 'household').length;
  const listIds = new Set(ctxRef.store.state.shopping.items.map((i) => i.ingredientId));
  const onList = inc.filter((l) => listIds.has(l.ingredientId)).length;
  const groups = [
    ["Didn't recognise — tap the name to teach it", scan.lines.filter((l) => l.kind === 'unknown')],
    ['Found', scan.lines.filter((l) => l.kind === 'food')],
    ['Not stored — just ticks off your list', scan.lines.filter((l) => l.kind === 'household')],
  ].filter(([, l]) => l.length);
  return `${sheetHeader('🧾', `${scan.lines.length} item${scan.lines.length === 1 ? '' : 's'} found${scan.store ? ` · ${esc(scan.store)}` : ''}`, 'Wrong item? <b>Tap its name</b> — it’ll remember next time')}
    ${scan.notice ? `<div class="notice">${esc(scan.notice)}</div>` : ''}
    ${groups.map(([label, lines]) => `<div class="section-title">${label}</div>${lines.map(row).join('')}`).join('')}
    ${onList ? `<label class="tick-list"><input type="checkbox" data-change="scan-ticklist" ${scan.tickList ? 'checked' : ''}> Tick ${onList} off the shopping list</label>` : ''}
    <div class="sheet-actions sticky-actions">
      <button type="button" class="btn" data-action="scan-back">‹ Back</button>
      <button type="button" class="btn primary" data-action="scan-putaway" ${inc.length ? '' : 'disabled'}>📥 Put ${food} away</button>
    </div>`;
}

function row(l) {
  const idx = scan.lines.indexOf(l);
  const store = l.kind !== 'household';
  const canTeach = !!l.keyText;
  return `<div class="rv-row ${l.include ? '' : 'off'} ${l.kind === 'unknown' ? 'unknown' : ''}">
    <button type="button" class="box-btn" data-action="scan-toggle" data-i="${idx}" aria-pressed="${l.include}" aria-label="Include ${esc(l.name)}"><span class="box">✓</span></button>
    <button type="button" class="rv-name grow" data-action="scan-fix" data-i="${idx}" ${canTeach || l.kind !== 'household' ? '' : 'disabled'} aria-label="${esc(l.name)} — tap to change what this is">
      <span class="em" aria-hidden="true">${l.emoji}</span>
      <span class="txt"><span class="nm">${l.kind === 'unknown' ? '❓ ' : ''}${esc(l.name)} <span class="edit" aria-hidden="true">✎</span>${l.learned ? ' <span class="learned" title="Remembered from before">🧠</span>' : ''}</span><span class="src">${esc(l.raw)}</span></span>
    </button>
    ${store ? `<span class="rv-qty">
      <button type="button" data-action="scan-step" data-i="${idx}" data-dir="-1" aria-label="Less">−</button>
      <output>${esc(l.display || '—')}</output>
      <button type="button" data-action="scan-step" data-i="${idx}" data-dir="1" aria-label="More">+</button></span>
    <button type="button" class="loc-btn" data-action="scan-loc" data-i="${idx}" aria-label="Store in ${LOCATION_LABEL[l.location]}, tap to change">${LOC_EMOJI[l.location]}<small>${LOCATION_LABEL[l.location]}</small></button>` : ''}
  </div>`;
}

// ── "What is this?" picker ──────────────────────────────────────
function fixList() {
  const l = scan.lines[scan.fix];
  const q = scan.fixQuery.trim() || l.keyText || l.name;
  let list = suggestIngredients(q, 8);
  if (!scan.fixQuery.trim() && list.length < 3) {
    // fall back to suggestions per word ("melon medley" -> melon, …)
    for (const w of (l.keyText || '').split(' ').filter((x) => x.length >= 3)) list.push(...suggestIngredients(w, 3));
    list = [...new Map(list.map((i) => [i.id, i])).values()].slice(0, 8);
  }
  const newName = titleCase(normText(scan.fixQuery.trim() || l.keyText || l.name));
  return `${list.map((i) => `<button type="button" data-action="scan-pick" data-ing="${i.id}" ${i.id === l.ingredientId ? 'aria-current="true"' : ''}>
      <span class="em">${i.emoji}</span><span class="txt"><span class="nm">${esc(i.name)}</span><span class="sub">${esc(LOCATION_LABEL[i.store] || '')}${i.id === l.ingredientId ? ' · current guess' : ''}</span></span></button>`).join('')}
    ${newName ? `<button type="button" data-action="scan-pick-new" data-name="${esc(newName)}"><span class="em">＋</span><span class="txt"><span class="nm">New item: “${esc(newName)}”</span><span class="sub">Add it to your own list of foods</span></span></button>` : ''}
    <button type="button" data-action="scan-ignore"><span class="em">🚫</span><span class="txt"><span class="nm">Not food — skip this line</span><span class="sub">e.g. bags, gift cards, magazines</span></span></button>`;
}

function fixView() {
  const l = scan.lines[scan.fix];
  return `${sheetHeader('🔍', 'What is this?', `Receipt says: <b>${esc(l.raw)}</b>`)}
    <input class="input" id="fix-q" placeholder="Search, e.g. watermelon" value="${esc(scan.fixQuery)}" data-input="fix-search" autocomplete="off">
    <div class="pick-list" id="fix-list">${fixList()}</div>
    ${l.keyText ? `<label class="tick-list"><input type="checkbox" data-change="scan-remember" ${scan.remember ? 'checked' : ''}> 🧠 Remember “${esc(l.keyText)}” for next time</label>` : ''}
    <div class="sheet-actions"><button type="button" class="btn" data-action="scan-unfix">‹ Back to list</button></div>`;
}

/** Applies a correction to the line (and any other line with the same wording) and remembers it. */
function applyFix(ing, { ignore = false } = {}) {
  const l = scan.lines[scan.fix];
  const same = (x) => (l.keyText ? x.keyText === l.keyText : x === l);
  if (ignore) scan.lines = scan.lines.filter((x) => !same(x));
  else scan.lines = scan.lines.map((x) => (same(x) ? { ...reinterpret(x, ing, x.locTouched ? x.location : null), locTouched: x.locTouched, include: true, kind: ing.aisle === 'Household' ? 'household' : 'food' } : x));
  scan.step = 'review'; scan.fix = null; scan.fixQuery = '';
  if (scan.remember && l.keyText) {
    ctxRef.store.update((s) => teachReceipt(s, { keyText: l.keyText, ingredientId: ing?.id, custom: ing?.custom ? ing : null,
      location: l.locTouched ? l.location : null, ignore, example: l.raw }),
    { label: ignore ? `🧠 Will skip “${esc(l.keyText)}” from now on` : `🧠 Remembered: “${esc(l.keyText)}” = ${esc(ing.name)}` });
  }
  refreshSheet({ toTop: false });
}

// ── Reading ─────────────────────────────────────────────────────
function setStatus(status, progress) { scan.status = status; if (progress != null) scan.progress = progress; refreshSheet(); }

function toReview(lines, store, source, notice = '', ignored = 0) {
  if (!lines.length) { Object.assign(scan, { step: 'choose', error: "Couldn't find any products. Try a flatter, brighter photo — or paste the list instead." }); refreshSheet(); return; }
  const remembered = lines.filter((l) => l.learned).length;
  const extra = [remembered && `🧠 ${remembered} recognised from your corrections`, ignored && `${ignored} line${ignored > 1 ? 's' : ''} skipped as not food`].filter(Boolean).join(' · ');
  Object.assign(scan, { step: 'review', lines, store, source, notice: [notice, extra].filter(Boolean).join(' — '), error: '', tickList: true });
  refreshSheet({ toTop: true });
}

async function processPhoto(file, kind) {
  const settings = ctxRef.store.state.settings;
  Object.assign(scan, { step: 'busy', error: '', progress: 0.05, notice: '' });
  setStatus('Preparing photo…');
  let img;
  try { img = await loadImage(file); } catch { toReview([], null, ''); return; }

  if (aiOn() && (kind === 'haul' || settings.ai.useForReceipts)) {
    try {
      setStatus('Asking your assistant to read it…', 0.35);
      const { store, items } = await readImageWithAI(canvasToImagePart(toCanvas(img, 1600)), settings.ai);
      toReview(linesFromAI(items, { learned: learned() }), store, 'ai');
      return;
    } catch (e) {
      if (kind === 'haul') { Object.assign(scan, { step: 'choose', error: e.message }); refreshSheet(); return; }
      scan.notice = `AI couldn't read it (${e.message}). Used the on-phone reader instead.`;
    }
  }
  try {
    const text = await ocrImage(toCanvas(img, 2200, { ocr: true }), (p, status) => setStatus(status, 0.1 + p * 0.85));
    const { store, lines, ignored } = parseReceiptText(text, { learned: learned() });
    toReview(lines, store, 'ocr', scan.notice, ignored);
  } catch (e) { Object.assign(scan, { step: 'choose', error: e.message }); refreshSheet(); }
}

function stepQty(l, dir) {
  const ing = getIngredient(l.ingredientId) || l.custom || { base: 'count' };
  const step = ing.base === 'count' ? 1 : ing.pack?.size || (ing.base === 'tsp' ? 1 : 100);
  const next = Math.max(0, (l.qty ?? 0) + step * dir);
  l.qty = next || null; l.approx = false;
  l.display = l.qty != null ? formatQty(l.qty, ing.base) : '';
  l.include = !!l.qty;
}

export const actions = {
  'scan-back': () => { scan.step = 'choose'; scan.error = ''; refreshSheet(); },
  'scan-to-paste': () => { scan.step = 'paste'; refreshSheet(); },
  'scan-list': () => toReview(linesFromShoppingList(ctxRef.store.state.shopping.items), null, 'list'),
  'scan-toggle': (el) => { const l = scan.lines[+el.dataset.i]; l.include = !l.include; refreshSheet(); },
  'scan-loc': (el) => { const l = scan.lines[+el.dataset.i]; l.location = LOCATIONS[(LOCATIONS.indexOf(l.location) + 1) % 3]; l.locTouched = true; refreshSheet(); },
  'scan-step': (el) => { stepQty(scan.lines[+el.dataset.i], +el.dataset.dir); refreshSheet(); },
  'scan-fix': (el) => { Object.assign(scan, { step: 'fix', fix: +el.dataset.i, fixQuery: '', remember: true }); refreshSheet({ toTop: true }); },
  'scan-unfix': () => { scan.step = 'review'; scan.fix = null; refreshSheet(); },
  'scan-pick': (el) => applyFix(getIngredient(el.dataset.ing)),
  'scan-pick-new': (el) => {
    const l = scan.lines[scan.fix];
    const base = l.custom?.base || (getIngredient(l.ingredientId)?.base) || 'count';
    const custom = { ...makeCustomIngredient(el.dataset.name), base, store: l.location || 'pantry' };
    applyFix(custom);
  },
  'scan-ignore': () => applyFix(null, { ignore: true }),
  'scan-putaway': (el, ev, ctx) => {
    const lines = scan.lines.filter((l) => l.include);
    let r;
    closeSheet();
    ctx.store.update((s) => { r = putAway(s, lines, { tickList: scan.tickList, tombstone: (id) => ctx.store.tombstone(id) }); },
      { label: `📥 Put away ${lines.filter((l) => l.kind !== 'household').length} items` });
    const bits = [r?.ticked && `✓ ${r.ticked} ticked off your list`, r?.learned && `🧠 ${r.learned} storage place${r.learned > 1 ? 's' : ''} remembered`].filter(Boolean);
    if (bits.length) setTimeout(() => ctx.toast(`📥 Put away · ${bits.join(' · ')}`, { undo: () => ctx.store.undo() }), 50);
  },
};

export const inputs = {
  'fix-search': (el) => { scan.fixQuery = el.value; document.getElementById('fix-list').innerHTML = fixList(); },
};

export const changes = {
  'scan-file': (el) => { const f = el.files?.[0]; el.value = ''; if (f) processPhoto(f, el.dataset.kind); },
  'scan-ticklist': (el) => { scan.tickList = el.checked; },
  'scan-remember': (el) => { scan.remember = el.checked; },
};

export const submits = {
  'scan-paste': (form) => {
    scan.paste = form.text.value;
    const { store, lines, ignored } = parseReceiptText(scan.paste, { learned: learned() });
    toReview(lines, store, 'paste', '', ignored);
  },
};
