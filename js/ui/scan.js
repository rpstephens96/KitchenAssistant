// "Just been shopping?" — receipt photo / photo of the shopping / pasted order / "everything on my list"
// -> one review screen -> put away into fridge/freezer/cupboard and tick off the shopping list.
import { esc, openSheet, closeSheet, sheetHeader, refreshSheet } from './dom.js';
import { parseReceiptText, linesFromAI } from '../core/receipt.js';
import { putAway, linesFromShoppingList, LOCATION_LABEL, LOCATIONS } from '../core/kitchen.js';
import { formatQty, getIngredient } from '../core/normalizer.js';
import { isConfigured } from '../ai/llm.js';
import { readImageWithAI, ocrImage, loadImage, toCanvas, canvasToImagePart } from '../ai/vision.js';

const LOC_EMOJI = { fridge: '❄️', freezer: '🧊', pantry: '🗄️' };
const scan = { step: 'choose', status: '', progress: 0, lines: [], store: null, source: '', error: '', notice: '', tickList: true, paste: '' };
let ctxRef = null;

export function openScan(ctx) {
  ctxRef = ctx;
  Object.assign(scan, { step: 'choose', status: '', progress: 0, lines: [], store: null, source: '', error: '', notice: '', paste: '' });
  openSheet(render, { focus: false });
}

function aiOn() { const ai = ctxRef.store.state.settings.ai; return isConfigured(ai); }

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
  if (scan.step === 'review') return reviewView();

  const listCount = ctxRef.store.state.shopping.items.length;
  const ai = aiOn();
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
    <p class="muted hint">Tip: flatten the receipt on a dark table in good light.</p>`;
}

function reviewView() {
  const inc = scan.lines.filter((l) => l.include);
  const food = inc.filter((l) => l.kind !== 'household').length;
  const listIds = new Set(ctxRef.store.state.shopping.items.map((i) => i.ingredientId));
  const onList = inc.filter((l) => listIds.has(l.ingredientId)).length;
  const groups = [
    ['Found', scan.lines.filter((l) => l.kind === 'food')],
    ['Not stored — just ticks off your list', scan.lines.filter((l) => l.kind === 'household')],
    ["Didn't recognise — tick to add anyway", scan.lines.filter((l) => l.kind === 'unknown')],
  ].filter(([, l]) => l.length);
  return `${sheetHeader('🧾', `${scan.lines.length} item${scan.lines.length === 1 ? '' : 's'} found${scan.store ? ` · ${esc(scan.store)}` : ''}`, 'Untick anything wrong · tap 📍 to change where it goes')}
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
  return `<div class="rv-row ${l.include ? '' : 'off'}">
    <button type="button" class="box-btn" data-action="scan-toggle" data-i="${idx}" aria-pressed="${l.include}" aria-label="Include ${esc(l.name)}"><span class="box">✓</span></button>
    <span class="em" aria-hidden="true">${l.emoji}</span>
    <span class="txt grow"><span class="nm">${esc(l.name)}</span><span class="src">${esc(l.raw)}</span></span>
    ${store ? `<span class="rv-qty">
      <button type="button" data-action="scan-step" data-i="${idx}" data-dir="-1" aria-label="Less">−</button>
      <output>${esc(l.display || '—')}</output>
      <button type="button" data-action="scan-step" data-i="${idx}" data-dir="1" aria-label="More">+</button></span>
    <button type="button" class="loc-btn" data-action="scan-loc" data-i="${idx}" aria-label="Store in ${LOCATION_LABEL[l.location]}, tap to change">${LOC_EMOJI[l.location]}<small>${LOCATION_LABEL[l.location]}</small></button>` : ''}
  </div>`;
}

function setStatus(status, progress) { scan.status = status; if (progress != null) scan.progress = progress; refreshSheet(); }

function toReview(lines, store, source, notice = '') {
  if (!lines.length) { Object.assign(scan, { step: 'choose', error: "Couldn't find any products. Try a flatter, brighter photo — or paste the list instead." }); refreshSheet(); return; }
  Object.assign(scan, { step: 'review', lines, store, source, notice, error: '', tickList: true });
  refreshSheet();
}

async function processPhoto(file, kind) {
  const settings = ctxRef.store.state.settings;
  Object.assign(scan, { step: 'busy', error: '', progress: 0.05 });
  setStatus('Preparing photo…');
  let img;
  try { img = await loadImage(file); } catch { toReview([], null, ''); return; }

  if (aiOn() && (kind === 'haul' || settings.ai.useForReceipts)) {
    try {
      setStatus('Asking your assistant to read it…', 0.35);
      const { store, items } = await readImageWithAI(canvasToImagePart(toCanvas(img, 1600)), settings.ai);
      toReview(linesFromAI(items), store, 'ai');
      return;
    } catch (e) {
      if (kind === 'haul') { Object.assign(scan, { step: 'choose', error: e.message }); refreshSheet(); return; }
      scan.notice = `AI couldn't read it (${e.message}). Used the on-phone reader instead.`;
    }
  }
  try {
    const text = await ocrImage(toCanvas(img, 2200, { ocr: true }), (p, status) => setStatus(status, 0.1 + p * 0.85));
    const { store, lines } = parseReceiptText(text);
    toReview(lines, store, 'ocr', scan.notice);
  } catch (e) { Object.assign(scan, { step: 'choose', error: e.message }); refreshSheet(); }
}

function stepQty(l, dir) {
  const ing = getIngredient(l.ingredientId) || l.custom || { base: 'count' };
  const step = ing.base === 'count' ? 1 : ing.pack?.size || (ing.base === 'tsp' ? 1 : 100);
  const next = Math.max(0, (l.qty ?? 0) + step * dir);
  l.qty = next || null; l.approx = false;
  l.display = l.qty != null ? formatQty(l.qty, ing.base) : '';
  if (!l.qty) l.include = false; else l.include = true;
}

export const actions = {
  'scan-back': () => { scan.step = 'choose'; scan.error = ''; refreshSheet(); },
  'scan-to-paste': () => { scan.step = 'paste'; refreshSheet(); },
  'scan-list': () => toReview(linesFromShoppingList(ctxRef.store.state.shopping.items), null, 'list'),
  'scan-toggle': (el) => { const l = scan.lines[+el.dataset.i]; l.include = !l.include; refreshSheet(); },
  'scan-loc': (el) => { const l = scan.lines[+el.dataset.i]; l.location = LOCATIONS[(LOCATIONS.indexOf(l.location) + 1) % 3]; refreshSheet(); },
  'scan-step': (el) => { stepQty(scan.lines[+el.dataset.i], +el.dataset.dir); refreshSheet(); },
  'scan-putaway': (el, ev, ctx) => {
    const lines = scan.lines.filter((l) => l.include);
    let r;
    closeSheet();
    ctx.store.update((s) => { r = putAway(s, lines, { tickList: scan.tickList, tombstone: (id) => ctx.store.tombstone(id) }); },
      { label: `📥 Put away ${lines.filter((l) => l.kind !== 'household').length} items` });
    if (r?.ticked) setTimeout(() => ctx.toast(`📥 Put away · ✓ ${r.ticked} ticked off your list`, { undo: () => ctx.store.undo() }), 50);
  },
};

export const changes = {
  'scan-file': (el) => { const f = el.files?.[0]; el.value = ''; if (f) processPhoto(f, el.dataset.kind); },
  'scan-ticklist': (el) => { scan.tickList = el.checked; },
};

export const submits = {
  'scan-paste': (form) => {
    scan.paste = form.text.value;
    const { store, lines } = parseReceiptText(scan.paste);
    toReview(lines, store, 'paste');
  },
};
