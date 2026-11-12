// UK supermarket receipt / online-order parser.
// Turns OCR text (or pasted text, or AI-extracted items) into reviewable inventory lines:
//   "BRIT CHKN BRST FLLT 640G   4.95"  ->  Chicken Breast · 640 g · Fridge
// Pure functions, unit-tested in tests/receipt.test.js.
import { normText, findIngredient, getIngredient, toBase, formatQty, makeCustomIngredient, allIngredients, titleCase } from './normalizer.js';
import { uid } from './util.js';

const STORES = [
  [/tesco/i, 'Tesco'], [/sainsbury/i, "Sainsbury's"], [/\basda\b/i, 'Asda'], [/morrisons/i, 'Morrisons'], [/\baldi\b/i, 'Aldi'],
  [/\blidl\b/i, 'Lidl'], [/co-?op\b/i, 'Co-op'], [/waitrose/i, 'Waitrose'], [/marks\s*(&|and)\s*spencer|\bm&s\b/i, 'M&S'],
  [/iceland/i, 'Iceland'], [/ocado/i, 'Ocado'],
];

// Lines that are never products.
const SKIP_RE = /\b(sub ?-?total|total|balance|change|cash|card|visa|mastercard|amex|maestro|contactless|debit|credit|vat|clubcard|nectar|points?|savings?|discount|promotion|promo|price ?cut|price ?match|multi ?buy|meal deal|offer|voucher|coupon|refund|tel|phone|www|http|thank|receipt|till|cashier|operator|served by|auth|merchant|terminal|aid|pan seq|ref no|items? sold|no of items|total items|bag for life|carrier bag|bags? charge|reg no|customer copy|retain|returns|signature|approved|transaction|superstore|express|extra store|metro|store no|st:|op:|tr:)\b/i;

// Supermarket abbreviations -> words (applied per token after normText).
const ABBR = {
  chkn: 'chicken', chk: 'chicken', ckn: 'chicken', chick: 'chicken', brst: 'breast', brsts: 'breast', bst: 'breast', fllt: 'fillet', flt: 'fillet', fllts: 'fillet', fil: 'fillet',
  thgh: 'thigh', thghs: 'thigh', mnce: 'mince', mnc: 'mince', bf: 'beef', mince: 'mince', saus: 'sausages', sausg: 'sausages', bcn: 'bacon',
  rshrs: 'rasher', salm: 'salmon', slmn: 'salmon', prwn: 'prawns', prwns: 'prawns', kng: 'king',
  mlk: 'milk', skim: 'skimmed', skmd: 'skimmed', skmmd: 'skimmed', ss: 'semi skimmed', semi: 'semi', whl: 'whole',
  ched: 'cheddar', chdr: 'cheddar', chedd: 'cheddar', mat: 'mature', mtr: 'mature', xmat: 'extra mature', chs: 'cheese', chse: 'cheese',
  moz: 'mozzarella', mozz: 'mozzarella', parm: 'parmesan', btr: 'butter', bttr: 'butter', crm: 'cream', dbl: 'double', sgl: 'single', sour: 'soured',
  yog: 'yogurt', yogh: 'yogurt', ygt: 'yogurt', grk: 'greek', nat: 'natural', frm: 'free range', fr: 'free range',
  egg: 'eggs', eggs: 'eggs', lrg: 'large', med: 'medium',
  tom: 'tomatoes', toms: 'tomatoes', tmt: 'tomatoes', tmts: 'tomatoes', chpd: 'chopped', chop: 'chopped', chp: 'chopped', chry: 'cherry', chrry: 'cherry',
  pot: 'potatoes', pots: 'potatoes', ptts: 'potatoes', pots_: 'potatoes', bby: 'baby', ons: 'onions', onion: 'onions', onio: 'onions', spr: 'spring', sprg: 'spring',
  pepp: 'peppers', ppr: 'pepper', pprs: 'peppers', mush: 'mushrooms', mshrm: 'mushrooms', mshrms: 'mushrooms', chstnt: 'chestnut', brocc: 'broccoli', broc: 'broccoli',
  carr: 'carrots', crrt: 'carrots', crrts: 'carrots', courg: 'courgettes', crgt: 'courgettes', aub: 'aubergine', cucumb: 'cucumber', cuc: 'cucumber',
  spin: 'spinach', spnch: 'spinach', lett: 'lettuce', avo: 'avocado', avoc: 'avocados', ban: 'bananas', bnna: 'bananas', bnnas: 'bananas', appl: 'apples', aples: 'apples',
  strwb: 'strawberries', strawb: 'strawberries', bluebs: 'blueberries', blueb: 'blueberries', rasp: 'raspberries', grps: 'grapes', lem: 'lemons', lmn: 'lemons', lmns: 'lemons',
  gngr: 'ginger', grlc: 'garlic', corr: 'coriander', cori: 'coriander',
  bns: 'beans', bkd: 'baked', kidny: 'kidney', chkpea: 'chickpeas', chkpeas: 'chickpeas', chickp: 'chickpeas', ccnut: 'coconut', coco: 'coconut', stk: 'stock', cubes: 'cube',
  psta: 'pasta', spag: 'spaghetti', spagh: 'spaghetti', spaghet: 'spaghetti', bas: 'basmati', basm: 'basmati', ndls: 'noodles', ndl: 'noodles',
  brd: 'bread', wht: 'white', wmeal: 'wholemeal', whlml: 'wholemeal', sdough: 'sourdough', trtla: 'tortilla', tort: 'tortilla', wrps: 'wraps',
  flr: 'flour', pln: 'plain', sr: 'self raising', sug: 'sugar', cast: 'caster', gran: 'granulated', oil_: 'oil', olv: 'olive', ev: 'extra virgin', evoo: 'olive oil', sunfl: 'sunflower', veg: 'vegetable',
  frz: 'frozen', frzn: 'frozen', frozen: 'frozen', pea: 'peas', swcorn: 'sweetcorn', swtcrn: 'sweetcorn', chps: 'chips', ovn: 'oven', icecrm: 'ice cream',
  oj: 'orange juice', jce: 'juice', jc: 'juice', tbags: 'tea bags', teabag: 'tea bags', coff: 'coffee', inst: 'instant', crsps: 'crisps', bisc: 'biscuits', biscs: 'biscuits', dig: 'digestives', digest: 'digestives',
  kit: 'kitchen', kitch: 'kitchen', kr: 'kitchen roll', tlt: 'toilet', tltrl: 'toilet roll', loo: 'toilet', wash: 'washing', wup: 'washing up', liq: 'liquid', dw: 'dishwasher', tabs: 'tablets',
};

// Brands / marketing words that confuse matching.
const STOP = new Set(['tesco', 'sainsburys', 'sainsbury', 'js', 'asda', 'morrisons', 'aldi', 'lidl', 'coop', 'co', 'op', 'waitrose', 'wtrs', 'wr', 'ms',
  'finest', 'ttd', 'taste', 'difference', 'extra', 'special', 'essential', 'essentials', 'everyday', 'value', 'smart', 'price', 'stockwell', 'hearty', 'food',
  'by', 'the', 'best', 'british', 'brit', 'scottish', 'welsh', 'english', 'irish', 'fresh', 'loose', 'organic', 'org', 'large', 'lge', 'small', 'medium',
  'class', 'classic', 'deluxe', 'specially', 'selected', 'nature', 's', 'pk', 'pack', 'x', 'kg', 'g', 'ml', 'l', 'ltr', 'each', 'ea', 'reduced', 'yellow', 'sticker', 'and', 'with']);

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

/** Fallback when no alias matches exactly: every alias token must prefix-match a word (min 3 letters). */
export function fuzzyFind(text) {
  const words = text.split(' ').filter((w) => w.length >= 3);
  if (!words.length) return null;
  let best = null; let bestScore = 0;
  for (const ing of allIngredients()) {
    for (const a of [ing.name, ...(ing.aliases || [])].map(normText)) {
      const at = a.split(' ');
      if (!at.every((t) => words.some((w) => t.startsWith(w) || w.startsWith(t)))) continue;
      if (a.length > bestScore) { best = ing; bestScore = a.length; }
    }
  }
  return bestScore >= 4 ? best : null;
}

/**
 * Interprets one product description into a review line.
 * @param {string} text  e.g. "TESCO S/SKIM MILK 4PT" or "Semi skimmed milk 2.272L"
 * @param {{ count?: number, price?: number, frozen?: boolean, household?: boolean, raw?: string }} o
 *   count = number of items/packs bought (leading "6 ..." or "x 2" or a quantity column)
 */
export function interpretItem(text, o = {}) {
  let upper = String(text).toUpperCase().replace(/[’']/g, '').replace(/\//g, ' ');
  let count = o.count ?? null;
  let lm = upper.match(/^\s*(\d{1,2})\s*[X×]?\s+(?=[A-Z])/);
  if (lm && count == null) { count = +lm[1]; upper = upper.slice(lm[0].length); }
  lm = upper.match(/\s[X×]\s?(\d{1,2})\s*$/);
  if (lm && count == null) { count = +lm[1]; upper = upper.slice(0, lm.index); }
  lm = upper.match(/\s(\d{1,2})\s*$/); // quantity column of online orders
  if (lm && count == null && /[A-Z]{3}/.test(upper.slice(0, lm.index))) { count = +lm[1]; upper = upper.slice(0, lm.index); }

  const frozen = o.frozen || /\b(FROZEN|FRZN|FRZ)\b/.test(upper);
  const { size, mult, packCount, rest } = extractSize(upper);
  const words = expandAbbrev(rest);
  const ing = findIngredient(words) || fuzzyFind(words);
  const raw = o.raw ?? String(text).trim();

  if (!ing) {
    const name = titleCase(words) || titleCase(normText(rest)) || 'Item';
    const custom = makeCustomIngredient(name, size?.unit);
    let qty = null;
    if (size) qty = custom.base === 'g' || custom.base === 'ml' ? toBase(size.qty, size.unit, custom).qty * mult * (count || 1) : null;
    else if (custom.base === 'count') qty = (packCount || 1) * (count || 1);
    return line({ raw, ing: custom, qty, approx: false, location: frozen ? 'freezer' : 'pantry', price: o.price,
      kind: o.household ? 'household' : 'unknown', include: false, custom });
  }

  let qty = null; let approx = false;
  if (size) ({ qty, approx } = toBase(size.qty, size.unit, ing));
  else if (packCount) ({ qty, approx } = toBase(packCount, null, ing));
  if (qty != null) qty *= mult * (count || 1);
  else if (count && ing.base === 'count') qty = count; // "6 eggs", "bananas x 5"
  else if (ing.pack) { qty = ing.pack.size * mult * (count || 1); approx = true; }
  else if (ing.base === 'count') qty = mult * (count || 1);
  if (qty != null && ing.base === 'count') qty = Math.max(1, Math.round(qty));

  const household = ing.aisle === 'Household' || o.household;
  return line({ raw, ing, qty, approx, location: frozen ? 'freezer' : ing.store || 'pantry', price: o.price,
    kind: household ? 'household' : 'food', include: true });
}

function line({ raw, ing, qty, approx, location, price, kind, include, custom }) {
  return { id: uid('l_'), raw, name: ing.name, emoji: ing.emoji || '🛒', ingredientId: ing.id, qty: qty != null ? +qty.toFixed(3) : null,
    baseUnit: ing.base, display: qty != null ? `${approx ? '≈ ' : ''}${formatQty(qty, ing.base)}` : '', approx, location,
    price: price ?? null, kind, include, ...(custom ? { custom } : {}) };
}

const near = (a, b) => Math.abs(a - b) < 0.015;

/**
 * Parses a whole receipt / order / list.
 * Receipt mode (≥3 priced lines): only priced lines are items; "2 x £0.79" and "0.950 kg @ £0.68/kg"
 * lines modify the neighbouring item (matched by price). List mode: every line is an item.
 */
export function parseReceiptText(text) {
  const rawLines = String(text).replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const store = detectStore(text);
  const priced = rawLines.filter((l) => PRICE_RE.test(` ${l}`)).length;
  const receiptMode = priced >= 3;

  const entries = []; // { text, price, count, kg }
  const mods = [];    // { idx (position in entries when seen), count, unit, kg }
  for (const l of rawLines) {
    const mult = l.match(/^(\d{1,2})\s*[x×@]\s*[£Ef]?\s?(\d{1,3}[.,]\d{2})/i);
    if (mult) { mods.push({ at: entries.length, count: +mult[1], unit: +mult[2].replace(',', '.') }); continue; }
    const kg = l.match(/(\d+[.,]\d{1,3})\s*kg\s*[@x]/i);
    if (kg) { if (entries.length) entries[entries.length - 1].kg = +kg[1].replace(',', '.'); continue; }
    if (SKIP_RE.test(l) || /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}:\d{2}/.test(l)) continue;
    const pm = ` ${l}`.match(PRICE_RE);
    const letters = (l.match(/[A-Za-z]/g) || []).length;
    if (letters < 3) { // e.g. "  1.29 A" — price for the item name on the line above
      const prev = entries[entries.length - 1];
      if (pm && prev?.pending && +pm[1].replace(',', '.') > 0) { prev.price = +pm[1].replace(',', '.'); prev.pending = false; }
      continue;
    }
    if (receiptMode && !pm) { // item name without a price: next line may hold the price ("BANANAS LOOSE" + weight line)
      entries.push({ text: l.replace(/^\d{5,}\s+/, ''), price: null, pending: true });
      continue;
    }
    const price = pm ? +pm[1].replace(',', '.') : null;
    if (price != null && price < 0) continue; // discount line
    const name = (pm ? ` ${l}`.slice(0, pm.index) : l).replace(/^\d{5,}\s+/, '').trim();
    if ((name.match(/[A-Za-z]/g) || []).length < 3) {
      const prev = entries[entries.length - 1];
      if (prev?.pending) { prev.price = price; prev.pending = false; } // price on its own line
      continue;
    }
    entries.push({ text: name, price });
  }

  // Apply "2 x £0.79" modifiers to whichever neighbour's price matches count × unit.
  for (const m of mods) {
    const next = entries[m.at]; const prev = entries[m.at - 1];
    const total = m.count * m.unit;
    const target = next && next.price != null && near(next.price, total) ? next
      : prev && prev.price != null && near(prev.price, total) ? prev : (prev || next);
    if (target) target.count = m.count;
  }

  const lines = entries
    .filter((e) => !receiptMode || e.price != null || e.kg != null)
    .map((e) => {
      const l = interpretItem(e.text, { count: e.count, price: e.price, raw: e.text });
      if (e.kg != null) {
        const ing = getIngredient(l.ingredientId) || l.custom;
        const r = toBase(e.kg, 'kg', ing);
        if (r.qty != null) Object.assign(l, { qty: ing.base === 'count' ? Math.max(1, Math.round(r.qty)) : r.qty, approx: r.approx || ing.base === 'count' });
        l.display = l.qty != null ? `${l.approx ? '≈ ' : ''}${formatQty(l.qty, ing.base)}` : '';
      }
      return l;
    });
  return { store, lines: mergeLines(lines) };
}

/** Same ingredient + location bought twice -> one line. */
export function mergeLines(lines) {
  const out = [];
  for (const l of lines) {
    const prev = out.find((o) => o.ingredientId === l.ingredientId && o.location === l.location && o.kind === l.kind);
    if (!prev) { out.push(l); continue; }
    if (prev.qty != null && l.qty != null) prev.qty += l.qty;
    prev.approx = prev.approx || l.approx;
    prev.raw += ` · ${l.raw}`;
    prev.price = prev.price != null && l.price != null ? +(prev.price + l.price).toFixed(2) : prev.price;
    prev.display = prev.qty != null ? `${prev.approx ? '≈ ' : ''}${formatQty(prev.qty, prev.baseUnit)}` : '';
  }
  return out;
}

/** AI vision output -> review lines. items: [{ name, quantity, size, frozen, household }] */
export function linesFromAI(items = []) {
  const lines = items.filter((i) => i && i.name).map((i) => interpretItem(`${i.name} ${i.size || ''}`.trim(), {
    count: Number.isFinite(+i.quantity) && +i.quantity > 0 ? +i.quantity : null,
    frozen: !!i.frozen, household: !!i.household, raw: [i.quantity > 1 ? `${i.quantity} ×` : '', i.name, i.size].filter(Boolean).join(' '),
  }));
  return mergeLines(lines);
}
