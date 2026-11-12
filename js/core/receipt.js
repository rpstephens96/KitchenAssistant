// UK supermarket receipt / online-order parser with a learning "receipt key".
//
//   "BRIT CHKN BRST FLLT 640G   4.95"  ->  Chicken Breast · 640 g · Fridge
//
// Matching order for each product line:
//   1. Receipt key — wording you've corrected before (exact, then "contains")  ← always wins
//   2. Built-in catalogue aliases after expanding supermarket abbreviations
//   3. Cautious fuzzy match (receipt abbreviations only, e.g. "STRWB" -> strawberries)
//   4. Unknown -> shown unticked so you can teach it
// Pure functions, unit-tested in tests/receipt.test.js.
import { normText, findIngredient, getIngredient, toBase, formatQty, makeCustomIngredient, allIngredients, titleCase } from './normalizer.js';
import { uid, nowISO } from './util.js';

const STORES = [
  [/tesco/i, 'Tesco'], [/sainsbury/i, "Sainsbury's"], [/\basda\b/i, 'Asda'], [/morrisons/i, 'Morrisons'], [/\baldi\b/i, 'Aldi'],
  [/\blidl\b/i, 'Lidl'], [/co-?op\b/i, 'Co-op'], [/waitrose/i, 'Waitrose'], [/marks\s*(&|and)\s*spencer|\bm&s\b/i, 'M&S'],
  [/iceland/i, 'Iceland'], [/ocado/i, 'Ocado'],
];

const SKIP_RE = /\b(sub ?-?total|total|balance|change|cash|card|visa|mastercard|amex|maestro|contactless|debit|credit|vat|clubcard|nectar|points?|savings?|discount|promotion|promo|price ?cut|price ?match|multi ?buy|meal deal|offer|voucher|coupon|refund|tel|phone|www|http|thank|receipt|till|cashier|operator|served by|auth|merchant|terminal|aid|pan seq|ref no|items? sold|no of items|total items|bag for life|carrier bag|bags? charge|reg no|customer copy|retain|returns|signature|approved|transaction|superstore|express|extra store|metro|store no|st:|op:|tr:)\b/i;

// Supermarket abbreviations -> words (applied per token after normText).
const ABBR = {
  chkn: 'chicken', chk: 'chicken', ckn: 'chicken', brst: 'breast', brsts: 'breast', bst: 'breast', fllt: 'fillet', flt: 'fillet', fllts: 'fillet', fil: 'fillet',
  thgh: 'thigh', thghs: 'thigh', mnce: 'mince', mnc: 'mince', bf: 'beef', saus: 'sausages', sausg: 'sausages', bcn: 'bacon',
  rshrs: 'rasher', salm: 'salmon', slmn: 'salmon', prwn: 'prawns', prwns: 'prawns', kng: 'king',
  mlk: 'milk', skim: 'skimmed', skmd: 'skimmed', skmmd: 'skimmed', ss: 'semi skimmed', whl: 'whole',
  ched: 'cheddar', chdr: 'cheddar', chedd: 'cheddar', mat: 'mature', mtr: 'mature', xmat: 'extra mature', chs: 'cheese', chse: 'cheese',
  moz: 'mozzarella', mozz: 'mozzarella', parm: 'parmesan', btr: 'butter', bttr: 'butter', crm: 'cream', dbl: 'double', sgl: 'single',
  yog: 'yogurt', yogh: 'yogurt', ygt: 'yogurt', grk: 'greek', nat: 'natural', frm: 'free range',
  lrg: 'large', med: 'medium',
  tom: 'tomatoes', toms: 'tomatoes', tmt: 'tomatoes', tmts: 'tomatoes', chpd: 'chopped', chop: 'chopped', chp: 'chopped', chry: 'cherry', chrry: 'cherry',
  pot: 'potatoes', pots: 'potatoes', ptts: 'potatoes', bby: 'baby', ons: 'onions', onio: 'onions', spr: 'spring', sprg: 'spring',
  pepp: 'peppers', ppr: 'pepper', pprs: 'peppers', mush: 'mushrooms', mshrm: 'mushrooms', mshrms: 'mushrooms', chstnt: 'chestnut', brocc: 'broccoli', broc: 'broccoli',
  carr: 'carrots', crrt: 'carrots', crrts: 'carrots', courg: 'courgettes', crgt: 'courgettes', aub: 'aubergine', cucumb: 'cucumber', cuc: 'cucumber',
  spin: 'spinach', spnch: 'spinach', lett: 'lettuce', avo: 'avocado', avoc: 'avocados', ban: 'bananas', bnna: 'bananas', bnnas: 'bananas', appl: 'apples', aples: 'apples',
  strwb: 'strawberries', strawb: 'strawberries', bluebs: 'blueberries', blueb: 'blueberries', rasp: 'raspberries', grps: 'grapes', lem: 'lemons', lmn: 'lemons', lmns: 'lemons',
  wmelon: 'watermelon', wtrmln: 'watermelon', wtrmelon: 'watermelon', mln: 'melon', pineapp: 'pineapple', pnapl: 'pineapple',
  gngr: 'ginger', grlc: 'garlic', corr: 'coriander', cori: 'coriander',
  bns: 'beans', bkd: 'baked', kidny: 'kidney', chkpea: 'chickpeas', chkpeas: 'chickpeas', chickp: 'chickpeas', ccnut: 'coconut', stk: 'stock', cubes: 'cube',
  psta: 'pasta', spag: 'spaghetti', spagh: 'spaghetti', spaghet: 'spaghetti', bas: 'basmati', basm: 'basmati', ndls: 'noodles', ndl: 'noodles',
  brd: 'bread', wht: 'white', wmeal: 'wholemeal', whlml: 'wholemeal', sdough: 'sourdough', trtla: 'tortilla', tort: 'tortilla', wrps: 'wraps',
  flr: 'flour', pln: 'plain', sr: 'self raising', sug: 'sugar', cast: 'caster', gran: 'granulated', olv: 'olive', ev: 'extra virgin', sunfl: 'sunflower',
  frz: 'frozen', frzn: 'frozen', swcorn: 'sweetcorn', swtcrn: 'sweetcorn', chps: 'chips', ovn: 'oven', icecrm: 'ice cream',
  oj: 'orange juice', jce: 'juice', jc: 'juice', tbags: 'tea bags', teabag: 'tea bags', coff: 'coffee', inst: 'instant', crsps: 'crisps', bisc: 'biscuits', biscs: 'biscuits', dig: 'digestives', digest: 'digestives',
  kit: 'kitchen', kitch: 'kitchen', kr: 'kitchen roll', tlt: 'toilet', tltrl: 'toilet roll', loo: 'toilet', wup: 'washing up', liq: 'liquid', dw: 'dishwasher', tabs: 'tablets',
  wtr: 'water', sprklng: 'sparkling', sprk: 'sparkling', stl: 'still',
};

// Brands / marketing words removed before matching and from receipt-key text.
const STOP = new Set(['tesco', 'sainsburys', 'sainsbury', 'js', 'asda', 'morrisons', 'aldi', 'lidl', 'coop', 'co', 'op', 'waitrose', 'wtrs', 'wr', 'ms',
  'finest', 'ttd', 'taste', 'difference', 'extra', 'special', 'essential', 'essentials', 'everyday', 'value', 'smart', 'price', 'stockwell', 'hearty', 'food',
  'by', 'the', 'best', 'british', 'brit', 'scottish', 'welsh', 'english', 'irish', 'fresh', 'loose', 'organic', 'org', 'lge', 'class',
  'classic', 'deluxe', 'specially', 'selected', 'nature', 's', 'pk', 'pack', 'x', 'kg', 'g', 'ml', 'l', 'ltr', 'each', 'ea', 'reduced', 'yellow', 'sticker', 'and', 'with']);

// Receipt-only hints for things the recipe catalogue deliberately treats differently.
const RECEIPT_HINTS = [[/\bwater\b/, 'bottled-water']];

const SIZE_UNIT = { KG: 'kg', G: 'g', GR: 'g', GM: 'g', GRM: 'g', ML: 'ml', CL: 'cl', L: 'l', LT: 'l', LTR: 'l', LITRE: 'l', LITRES: 'l' };
const PRICE_RE = /\s[£Ef]?\s?(-?\d{1,3}[.,]\d{2})\s*-?\s*(?:[A-Z*]{1,2})?\s*$/;

export function detectStore(text) {
  const head = String(text).split(/\n/).slice(0, 8).join(' ');
  for (const [re, name] of STORES) if (re.test(head)) return name;
  for (const [re, name] of STORES) if (re.test(text)) return name;
  return null;
}

/** Pulls pack size / multipack / pints / pack count out of a product name. */
export function extractSize(upper) {
  let s = ` ${upper} `;
  let size = null; let mult = 1; let packCount = null;
  let m = s.match(/\s(\d+)\s*[X×]\s*(\d+(?:[.,]\d+)?)\s*(KG|GRM|GR|GM|G|ML|CL|LTR|LT|LITRES?|L)(?=[^A-Z]|$)/);
  if (m) { mult = +m[1]; size = { qty: +m[2].replace(',', '.'), unit: SIZE_UNIT[m[3]] }; s = s.replace(m[0], ' '); }
  if (!size) {
    m = s.match(/(\d+(?:[.,]\d+)?)\s*(KG|GRM|GR|GM|G|ML|CL|LTR|LT|LITRES?|L)(?=[^A-Z]|$)/);
    if (m) { size = { qty: +m[1].replace(',', '.'), unit: SIZE_UNIT[m[2]] }; s = s.replace(m[0], ' '); }
  }
  if (!size) {
    m = s.match(/(\d+)\s*(PT|PINTS?)(?=[^A-Z]|$)/);
    if (m) { size = { qty: +m[1] * 568.261, unit: 'ml' }; s = s.replace(m[0], ' '); }
  } else s = s.replace(/\d+\s*(PT|PINTS?)(?=[^A-Z]|$)/, ' ');
  m = s.match(/(\d+)\s*(PK|PACK|PCS|PIECES|ROLLS|CT)(?=[^A-Z]|$)/) || s.match(/\sX\s?(\d+)(?=[^A-Z0-9]|$)/) || s.match(/\s(\d+)\s?X(?=\s|$)/);
  if (m) { packCount = +m[1]; s = s.replace(m[0], ' '); }
  return { size, mult, packCount, rest: s.replace(/\s+/g, ' ').trim() };
}

export function expandAbbrev(text) {
  return normText(text).split(' ').map((w) => ABBR[w] ?? w).join(' ')
    .split(' ').filter((w) => w && !STOP.has(w) && !/^\d+%?$/.test(w)).join(' ');
}

/** Splits leading count ("6 EGGS"), trailing "x 2" or an online-order quantity column. */
function splitCount(text, count = null) {
  let upper = String(text).toUpperCase().replace(/[’']/g, '').replace(/\//g, ' ');
  let m = upper.match(/^\s*(\d{1,2})\s*[X×]?\s+(?=[A-Z])/);
  if (m && count == null) { count = +m[1]; upper = upper.slice(m[0].length); }
  m = upper.match(/\s[X×]\s?(\d{1,2})\s*$/);
  if (m && count == null) { count = +m[1]; upper = upper.slice(0, m.index); }
  m = upper.match(/\s(\d{1,2})\s*$/);
  if (m && count == null && /[A-Z]{3}/.test(upper.slice(0, m.index))) { count = +m[1]; upper = upper.slice(0, m.index); }
  return { upper, count };
}

/**
 * The stable "receipt wording" used as the key for learning: no sizes, counts, prices or brand words.
 * "TESCO WATERMELON EACH" and "Watermelon" -> "watermelon"; "WTRS GOCHUJANG 170G" -> "gochujang".
 */
export function receiptKeyText(text) {
  const { upper } = splitCount(text);
  const { rest } = extractSize(upper);
  return normText(rest).split(' ').filter((w) => w && !STOP.has(w) && !/^\d+%?$/.test(w)).join(' ');
}

export const receiptKeyId = (keyText) => `rk_${keyText.replace(/ /g, '-').slice(0, 60)}`;

/** state.receiptKey (array) -> Map(keyText -> entry). */
export function learnedMap(entries = []) {
  return new Map(entries.filter((e) => e && e.key).map((e) => [e.key, e]));
}

/** Exact wording first, then the longest learned wording contained (as whole words) in this one. */
export function lookupLearned(keyText, learned) {
  if (!learned?.size || !keyText) return null;
  if (learned.has(keyText)) return learned.get(keyText);
  let best = null;
  const padded = ` ${keyText} `;
  for (const [k, e] of learned) if (k.length >= 4 && padded.includes(` ${k} `) && (!best || k.length > best.key.length)) best = e;
  return best;
}

/**
 * Cautious fuzzy match for abbreviations: every word of a catalogue alias must be the expansion of a
 * receipt word ("STRWB" -> strawberries). A receipt word may NOT be a longer word that merely starts
 * with the alias — that was the "WATERMELON -> water" bug.
 */
export function fuzzyFind(text) {
  const words = text.split(' ').filter((w) => w.length >= 3);
  if (!words.length) return null;
  let best = null; let bestScore = 0;
  for (const ing of allIngredients()) {
    if (ing.notOnReceipts || ing.custom) continue;
    for (const a of [ing.name, ...(ing.aliases || [])].map(normText)) {
      const at = a.split(' ');
      if (!at.every((t) => words.some((w) => t === w || (t.startsWith(w) && w.length >= 4)))) continue;
      if (a.length > bestScore) { best = ing; bestScore = a.length; }
    }
  }
  return bestScore >= 4 ? best : null;
}

function catalogueMatch(words) {
  const ing = findIngredient(words, (i) => i.notOnReceipts);
  if (ing) return ing;
  for (const [re, id] of RECEIPT_HINTS) if (re.test(words)) return getIngredient(id);
  return fuzzyFind(words);
}

/**
 * Interprets one product description into a review line.
 * @param {string} text  e.g. "TESCO S/SKIM MILK 4PT"
 * @param {{ count?, price?, kg?, frozen?, household?, raw?, learned?: Map, force?: object }} o
 *   force = ingredient chosen by the user (re-interpret with the correct item)
 */
export function interpretItem(text, o = {}) {
  const { upper, count } = splitCount(text, o.count ?? null);
  const frozen = o.frozen || /\b(FROZEN|FRZN|FRZ)\b/.test(upper);
  const { size, mult, packCount, rest } = extractSize(upper);
  const keyText = receiptKeyText(text);
  const raw = o.raw ?? String(text).trim();
  const src = { text: String(text), count: o.count ?? null, price: o.price ?? null, kg: o.kg ?? null, frozen: !!o.frozen, household: !!o.household, raw };

  let ing = o.force || null;
  let learned = null;
  if (!ing) {
    learned = lookupLearned(keyText, o.learned);
    if (learned?.ignore) return { id: uid('l_'), ignored: true, raw, keyText };
    if (learned) ing = getIngredient(learned.ingredientId) || learned.custom || null;
  }
  const words = expandAbbrev(rest);
  if (!ing) ing = catalogueMatch(words);

  const defaultLoc = (i) => learned?.location || (frozen ? 'freezer' : i.store || 'pantry');

  if (!ing) {
    const custom = makeCustomIngredient(titleCase(words) || titleCase(normText(rest)) || 'Item', size?.unit);
    let qty = null;
    if (size && (custom.base === 'g' || custom.base === 'ml')) qty = toBase(size.qty, size.unit, custom).qty * mult * (count || 1);
    else if (custom.base === 'count') qty = (packCount || 1) * (count || 1);
    return line({ raw, ing: custom, qty, approx: false, location: frozen ? 'freezer' : 'pantry', price: o.price,
      kind: o.household ? 'household' : 'unknown', include: false, custom, keyText, src });
  }

  let qty = null; let approx = false;
  if (o.kg != null) { ({ qty, approx } = toBase(o.kg, 'kg', ing)); if (ing.base === 'count') approx = true; }
  else {
    if (size) ({ qty, approx } = toBase(size.qty, size.unit, ing));
    else if (packCount) ({ qty, approx } = toBase(packCount, null, ing));
    if (qty != null) qty *= mult * (count || 1);
    else if (count && ing.base === 'count') qty = count;
    else if (ing.pack) { qty = ing.pack.size * mult * (count || 1); approx = true; }
    else if (ing.base === 'count') qty = mult * (count || 1);
  }
  if (qty != null && ing.base === 'count') qty = Math.max(1, Math.round(qty));

  const household = ing.aisle === 'Household' || o.household;
  return line({ raw, ing, qty, approx, location: defaultLoc(ing), price: o.price, kind: household ? 'household' : 'food',
    include: true, keyText, src, learned: !!learned || !!o.force, ...(ing.custom ? { custom: ing } : {}) });
}

function line({ raw, ing, qty, approx, location, price, kind, include, custom, keyText, src, learned = false }) {
  return { id: uid('l_'), raw, name: ing.name, emoji: ing.emoji || '🛒', ingredientId: ing.id, qty: qty != null ? +qty.toFixed(3) : null,
    baseUnit: ing.base, display: qty != null ? `${approx ? '≈ ' : ''}${formatQty(qty, ing.base)}` : '', approx, location,
    price: price ?? null, kind, include, keyText, src, learned, ...(custom ? { custom } : {}) };
}

/** Re-runs a review line with the ingredient the user picked (keeps its count/size/weight). */
export function reinterpret(l, ing, location = null) {
  const parts = l.parts || [l];
  const lines = parts.map((p) => interpretItem(p.src?.text ?? p.raw, { ...(p.src || {}), force: ing }));
  const merged = mergeLines(lines)[0];
  if (location) merged.location = location;
  return { ...merged, id: l.id, raw: l.raw, keyText: l.keyText, learned: true };
}

const near = (a, b) => Math.abs(a - b) < 0.015;

/**
 * Parses a whole receipt / order / list.
 * Receipt mode (≥3 priced lines): only priced lines are items; "2 x £0.79" and "0.950 kg @ £0.68/kg"
 * lines modify the neighbouring item. List mode: every line is an item.
 * @returns {{ store, lines, ignored }}  ignored = lines skipped because you taught "not food"
 */
export function parseReceiptText(text, { learned = null } = {}) {
  const rawLines = String(text).replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const store = detectStore(text);
  const priced = rawLines.filter((l) => PRICE_RE.test(` ${l}`)).length;
  const receiptMode = priced >= 3;

  const entries = []; const mods = [];
  for (const l of rawLines) {
    const mult = l.match(/^(\d{1,2})\s*[x×@]\s*[£Ef]?\s?(\d{1,3}[.,]\d{2})/i);
    if (mult) { mods.push({ at: entries.length, count: +mult[1], unit: +mult[2].replace(',', '.') }); continue; }
    const kg = l.match(/(\d+[.,]\d{1,3})\s*kg\s*[@x]/i);
    if (kg) { if (entries.length) entries[entries.length - 1].kg = +kg[1].replace(',', '.'); continue; }
    if (SKIP_RE.test(l) || /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}:\d{2}/.test(l)) continue;
    const pm = ` ${l}`.match(PRICE_RE);
    const letters = (l.match(/[A-Za-z]/g) || []).length;
    if (letters < 3) {
      const prev = entries[entries.length - 1];
      if (pm && prev?.pending && +pm[1].replace(',', '.') > 0) { prev.price = +pm[1].replace(',', '.'); prev.pending = false; }
      continue;
    }
    if (receiptMode && !pm) { entries.push({ text: l.replace(/^\d{5,}\s+/, ''), price: null, pending: true }); continue; }
    const price = pm ? +pm[1].replace(',', '.') : null;
    if (price != null && price < 0) continue;
    const name = (pm ? ` ${l}`.slice(0, pm.index) : l).replace(/^\d{5,}\s+/, '').trim();
    entries.push({ text: name, price });
  }
  for (const m of mods) {
    const next = entries[m.at]; const prev = entries[m.at - 1];
    const total = m.count * m.unit;
    const target = next && next.price != null && near(next.price, total) ? next
      : prev && prev.price != null && near(prev.price, total) ? prev : (prev || next);
    if (target) target.count = m.count;
  }

  let ignored = 0;
  const lines = [];
  for (const e of entries.filter((x) => !receiptMode || x.price != null || x.kg != null)) {
    const l = interpretItem(e.text, { count: e.count, price: e.price, kg: e.kg, raw: e.text, learned });
    if (l.ignored) ignored++; else lines.push(l);
  }
  return { store, lines: mergeLines(lines), ignored };
}

/** Same ingredient + location bought twice -> one line (keeps the parts for re-interpreting). */
export function mergeLines(lines) {
  const out = [];
  for (const l of lines) {
    const prev = out.find((o) => o.ingredientId === l.ingredientId && o.location === l.location && o.kind === l.kind);
    if (!prev) { out.push({ ...l, parts: [l] }); continue; }
    prev.parts.push(l);
    if (prev.qty != null && l.qty != null) prev.qty += l.qty;
    prev.approx = prev.approx || l.approx;
    if (!prev.raw.includes(l.raw)) prev.raw += ` · ${l.raw}`;
    prev.price = prev.price != null && l.price != null ? +(prev.price + l.price).toFixed(2) : prev.price;
    prev.display = prev.qty != null ? `${prev.approx ? '≈ ' : ''}${formatQty(prev.qty, prev.baseUnit)}` : '';
  }
  return out;
}

/** AI vision output -> review lines. items: [{ name, quantity, size, frozen, household }] */
export function linesFromAI(items = [], { learned = null } = {}) {
  const lines = items.filter((i) => i && i.name).map((i) => interpretItem(`${i.name} ${i.size || ''}`.trim(), {
    count: Number.isFinite(+i.quantity) && +i.quantity > 0 ? +i.quantity : null,
    frozen: !!i.frozen, household: !!i.household, learned,
    raw: [i.quantity > 1 ? `${i.quantity} ×` : '', i.name, i.size].filter(Boolean).join(' '),
  })).filter((l) => !l.ignored);
  return mergeLines(lines);
}

// ── Teaching (mutates draft state; call inside store.update) ─────────
/**
 * Remembers what a piece of receipt wording means. Same wording -> same id, so the two phones'
 * corrections merge cleanly through sync (newest wins).
 */
export function teachReceipt(state, { keyText, ingredientId = null, custom = null, location = null, ignore = false, example = '' }) {
  if (!keyText) return null;
  state.receiptKey ||= [];
  const id = receiptKeyId(keyText);
  const entry = { id, key: keyText, ingredientId: ignore ? null : (custom?.id || ingredientId), location: ignore ? null : location,
    ignore: !!ignore, example: example || keyText, updatedAt: nowISO(), ...(custom ? { custom } : {}) };
  const i = state.receiptKey.findIndex((e) => e.id === id);
  if (i >= 0) state.receiptKey[i] = { ...state.receiptKey[i], ...entry }; else state.receiptKey.push(entry);
  return entry;
}
