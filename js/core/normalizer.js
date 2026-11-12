// UK Unit Converter & Ingredient Normaliser
// ------------------------------------------------------------------
// Pure functions only (no DOM) so they run in the browser *and* in Node tests.
//
//   "1/2 cup unsalted butter, softened"
//     -> parseLine()      { qty: 0.5, unit: 'cup', text: 'unsalted butter', note: 'softened' }
//     -> findIngredient() butter  (base 'g', cupG 227, tbspG 15)
//     -> toBase()         113.5 g
//     -> display          "115 g"
// Every line for an ingredient shares that ingredient's base unit, so aggregation is a plain sum.

import { INGREDIENTS } from '../data/ingredients.js';

export const US_CUP_ML = 236.588;

export const UNITS = {
  g: { kind: 'mass', f: 1 }, kg: { kind: 'mass', f: 1000 }, oz: { kind: 'mass', f: 28.3495 }, lb: { kind: 'mass', f: 453.592 },
  ml: { kind: 'volume', f: 1 }, cl: { kind: 'volume', f: 10 }, l: { kind: 'volume', f: 1000 },
  tsp: { kind: 'volume', f: 5 }, dsp: { kind: 'volume', f: 10 }, tbsp: { kind: 'volume', f: 15 },
  cup: { kind: 'volume', f: US_CUP_ML }, floz: { kind: 'volume', f: 29.5735 },
  pint: { kind: 'volume', f: 473.176 }, // US default; UK = 568.261 via opts.pint
  quart: { kind: 'volume', f: 946.353 }, gallon: { kind: 'volume', f: 3785.41 },
  pinch: { kind: 'volume', f: 0.3125 }, dash: { kind: 'volume', f: 0.625 },
  each: { kind: 'count', f: 1 }, clove: { kind: 'count', f: 1 }, slice: { kind: 'count', f: 1 }, rasher: { kind: 'count', f: 1 },
  fillet: { kind: 'count', f: 1 }, piece: { kind: 'count', f: 1 }, sprig: { kind: 'count', f: 1 },
  head: { kind: 'container', f: 1 }, can: { kind: 'container', f: 1 }, pack: { kind: 'container', f: 1 },
  stick: { kind: 'special', f: 1 }, knob: { kind: 'special', f: 1 }, handful: { kind: 'special', f: 1 },
  bunch: { kind: 'special', f: 1 }, cm: { kind: 'special', f: 1 },
};

const UNIT_PATTERNS = [
  ['fluid ounces?|fl\\.?\\s?oz\\.?', 'floz'],
  ['tablespoons?|tbsps?\\.?|tbls?\\.?|tbs\\.?', 'tbsp'],
  ['teaspoons?|tsps?\\.?', 'tsp'],
  ['dessertspoons?|dsps?', 'dsp'],
  ['kilograms?|kilos?|kgs?', 'kg'],
  ['grams?|grammes?|gr|g', 'g'],
  ['millilit(?:er|re)s?|mls?', 'ml'],
  ['centilit(?:er|re)s?|cl', 'cl'],
  ['lit(?:er|re)s?|ltrs?|l', 'l'],
  ['ounces?|oz\\.?', 'oz'],
  ['pounds?|lbs?\\.?', 'lb'],
  ['cups?|c\\.', 'cup'],
  ['pints?|pts?', 'pint'],
  ['quarts?|qts?', 'quart'],
  ['gallons?|gal', 'gallon'],
  ['pinch(?:es)?', 'pinch'],
  ['dash(?:es)?|splash(?:es)?', 'dash'],
  ['cloves?', 'clove'],
  ['slices?', 'slice'],
  ['rashers?|strips?', 'rasher'],
  ['fillets?', 'fillet'],
  ['pieces?|chunks?', 'piece'],
  ['sprigs?', 'sprig'],
  ['heads?|bulbs?', 'head'],
  ['cans?|tins?|jars?|cartons?|bottles?|tubs?|pots?', 'can'],
  ['packs?|packets?|pkts?|bags?|boxes|box|blocks?|punnets?|sheets?|balls?', 'pack'],
  ['sticks?|stalks?', 'stick'],
  ['knobs?', 'knob'],
  ['handfuls?', 'handful'],
  ['bunch(?:es)?', 'bunch'],
  ['cm|centimet(?:er|re)s?', 'cm'],
];
const UNIT_RE = new RegExp(`^(${UNIT_PATTERNS.map(([p]) => `(?:${p})`).join('|')})(?![a-z])\\.?\\s*`, 'i');

export function unitKeyFor(token) {
  for (const [p, key] of UNIT_PATTERNS) if (new RegExp(`^(?:${p})\\.?$`, 'i').test(token.trim())) return key;
  return null;
}

// ── Text helpers ──────────────────────────────────────────────────
const FRACTIONS = { '¼': '1/4', '½': '1/2', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅕': '1/5', '⅙': '1/6' };
const WORD_NUMS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, dozen: 12, 'a dozen': 12, 'a couple of': 2, 'a couple': 2, 'couple of': 2, 'a few': 3, 'few': 3 };

export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&frac12;/g, '½').replace(/&frac14;/g, '¼').replace(/&frac34;/g, '¾')
    .replace(/&deg;/g, '°').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Lower-case, strip accents/punctuation: "Crème fraîche" == "creme-fraiche". */
export function normText(s = '') {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/['’`]/g, ' ').replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function expandFractions(s) {
  return s.replace(/(\d)\s*([¼½¾⅓⅔⅛⅜⅝⅞⅕⅙])/g, (_, d, f) => `${d} ${FRACTIONS[f]}`)
    .replace(/[¼½¾⅓⅔⅛⅜⅝⅞⅕⅙]/g, (f) => FRACTIONS[f]).replace(/⁄/g, '/');
}

/** "1 1/2" -> 1.5, "3/4" -> 0.75, "2,5" -> 2.5 */
export function parseNumber(str) {
  if (str == null) return null;
  const s = String(str).trim().replace(',', '.');
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return +m[1] + (+m[2] / +m[3]);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return +m[2] ? +m[1] / +m[2] : null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const NUM = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?)';
const QTY_RE = new RegExp(`^(${NUM})(?:\\s*(?:-|–|—|to|or)\\s*(${NUM}))?\\s*`);

/** Leading quantity. Ranges ("2-3") use the max for shopping and keep the min. */
export function parseQuantity(input) {
  const s = expandFractions(String(input)).trim();
  const m = s.match(QTY_RE);
  if (m) {
    const a = parseNumber(m[1]);
    const b = m[2] ? parseNumber(m[2]) : null;
    return { qty: b ?? a, qtyMin: b != null ? a : null, rest: s.slice(m[0].length) };
  }
  const lower = s.toLowerCase();
  for (const w of Object.keys(WORD_NUMS).sort((x, y) => y.length - x.length)) {
    if (lower.startsWith(w + ' ')) return { qty: WORD_NUMS[w], qtyMin: null, rest: s.slice(w.length + 1).trim() };
  }
  return { qty: null, qtyMin: null, rest: s };
}

function matchUnit(rest) {
  let m = rest.match(/^T\.?\s+(?=[a-zA-Z])/);
  if (m) return { unit: 'tbsp', rest: rest.slice(m[0].length) };
  m = rest.match(/^t\.?\s+(?=[a-zA-Z])/);
  if (m) return { unit: 'tsp', rest: rest.slice(m[0].length) };
  m = rest.match(UNIT_RE);
  if (m) return { unit: unitKeyFor(m[1]), rest: rest.slice(m[0].length) };
  return { unit: null, rest };
}

const PREP_WORDS = ['finely', 'roughly', 'thinly', 'coarsely', 'freshly', 'chopped', 'diced', 'minced', 'sliced', 'grated',
  'shredded', 'crushed', 'peeled', 'deseeded', 'seeded', 'trimmed', 'halved', 'quartered', 'cubed', 'beaten', 'whisked',
  'melted', 'softened', 'cold', 'warm', 'room temperature', 'packed', 'heaped', 'heaping', 'level', 'rounded', 'large',
  'small', 'medium', 'ripe', 'fresh', 'organic', 'boneless', 'skinless', 'drained', 'rinsed', 'sifted', 'cooked', 'raw'];

export function titleCase(s) { return s.replace(/\b([a-z])/g, (c) => c.toUpperCase()); }

// ── Catalogue & alias index ───────────────────────────────────────
let catalog = new Map();
let aliasIndex = [];

function variants(alias) {
  const out = new Set([alias]);
  if (alias.endsWith('y') && !/[aeiou]y$/.test(alias)) out.add(alias.slice(0, -1) + 'ies');
  if (/(s|sh|ch|x|o)$/.test(alias)) out.add(alias + 'es');
  out.add(alias + 's');
  return [...out];
}

function buildIndex(list) {
  catalog = new Map(list.map((i) => [i.id, i]));
  const entries = [];
  for (const ing of list) {
    const explicit = new Set([normText(ing.name), ...(ing.aliases || []).map(normText)]);
    for (const a of explicit) for (const v of variants(a)) entries.push({ alias: v, id: ing.id, explicit: v === a });
  }
  // Longest alias wins ("red pepper flakes" > "red pepper" > "pepper"); explicit beats generated plural.
  entries.sort((x, y) => y.alias.length - x.alias.length || (y.explicit - x.explicit));
  const seen = new Set();
  aliasIndex = entries.filter((e) => !seen.has(e.alias) && seen.add(e.alias))
    .map((e) => ({ ...e, re: new RegExp(`(?:^| )${e.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`) }));
}
buildIndex(INGREDIENTS);

/** Register user-created ingredients (persisted in state.customIngredients). */
export function setCustomIngredients(custom = []) {
  const ids = new Set(INGREDIENTS.map((i) => i.id));
  buildIndex([...INGREDIENTS, ...custom.filter((c) => !ids.has(c.id))]);
}

export function getIngredient(id) { return catalog.get(id) || null; }
export function allIngredients() { return [...catalog.values()]; }

/** Canonical ingredient mentioned in free text (or null). */
export function findIngredient(text) {
  const t = normText(text);
  if (!t) return null;
  for (const e of aliasIndex) if (e.re.test(t)) return catalog.get(e.id);
  return null;
}

/** Autocomplete by prefix / word-prefix / substring. */
export function suggestIngredients(query, limit = 6) {
  const q = normText(query).replace(/^\d+\s*\S*\s*/, '') || normText(query);
  if (!q) return [];
  const scored = [];
  for (const ing of catalog.values()) {
    let best = Infinity;
    for (const n of [ing.name, ...(ing.aliases || [])].map(normText)) {
      if (n.startsWith(q)) best = Math.min(best, n.length / 100);
      else if (n.split(' ').some((w) => w.startsWith(q))) best = Math.min(best, 1 + n.length / 100);
      else if (n.includes(q)) best = Math.min(best, 2 + n.length / 100);
    }
    if (best < Infinity) scored.push([best, ing]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, i]) => i);
}

function slug(s) { return normText(s).replace(/ /g, '-').slice(0, 40); }

/** Minimal catalogue entry for something we don't recognise. */
export function makeCustomIngredient(name, unitKey) {
  const kind = UNITS[unitKey]?.kind;
  const base = ['tsp', 'pinch', 'dash'].includes(unitKey) ? 'tsp' : kind === 'mass' ? 'g' : kind === 'volume' ? 'ml' : 'count';
  const clean = titleCase(normText(name)) || 'Item';
  return { id: `x-${slug(clean)}`, name: clean, emoji: '🛒', aisle: 'Other', base, store: 'pantry', aliases: [], custom: true };
}

// ── Line parsing ──────────────────────────────────────────────────
/**
 * Splits a raw line into quantity / unit / ingredient text / note. Handles "1 1/2 cups", "½ tsp",
 * "2-3 cloves", "1 (14 oz) can", "2 x 400g tins", "400g/14oz", "juice of 1 lemon", "salt, to taste".
 */
export function parseLine(raw) {
  let s = decodeEntities(raw).replace(/^[\s•\-*–▢□☐·]+/, '').replace(/\s+/g, ' ').trim();
  const optional = /\boptional\b/i.test(s);
  const toTaste = /\bto taste\b|\bas needed\b|\bfor serving\b|\bto serve\b|\bfor garnish\b/i.test(s);
  s = s.replace(/^(?:the\s+)?(?:finely\s+grated\s+)?(?:zest|juice)(?:\s+and\s+(?:zest|juice))?\s+of\s+/i, '');
  s = expandFractions(s);

  let { qty, qtyMin, rest } = parseQuantity(s);
  let unit = null; let packQty = null; let packUnit = null;

  if (qty != null) {
    const mult = rest.match(/^[x×]\s*/i);
    if (mult) {
      const inner = parseQuantity(rest.slice(mult[0].length));
      if (inner.qty != null) {
        const u = matchUnit(inner.rest);
        if (u.unit) { packQty = inner.qty; packUnit = u.unit; rest = u.rest; }
      }
    }
    if (!packUnit) ({ unit, rest } = matchUnit(rest));
    const paren = rest.match(/^\(\s*(?:about\s+|approx\.?\s+)?([\d.,/ ]+)\s*([a-zA-Z. ]+?)\s*\)\s*/);
    if (paren && (!unit || UNITS[unit]?.kind === 'container' || UNITS[unit]?.kind === 'count')) {
      const pq = parseNumber(paren[1].trim());
      const pu = unitKeyFor(paren[2]);
      if (pq != null && pu && ['mass', 'volume'].includes(UNITS[pu].kind)) {
        packQty = pq; packUnit = pu; rest = rest.slice(paren[0].length);
        const c = matchUnit(rest);
        if (c.unit && UNITS[c.unit].kind === 'container') rest = c.rest;
      }
    }
    rest = rest.replace(/^\/\s*[\d.,/ ]+\s*[a-zA-Z.]+\s*/, '')
      .replace(/^\(\s*[\d.,/ ]+\s*(?:g|grams?|ml|oz|ounces?|lbs?|cups?|tbsp|tsp)\.?\s*\)\s*/i, '');
  } else {
    const u = matchUnit(rest);
    if (u.unit && ['pinch', 'dash', 'knob', 'handful', 'bunch'].includes(u.unit)) { qty = 1; unit = u.unit; rest = u.rest; }
  }

  rest = rest.replace(/^of\s+/i, '').trim();
  let note = '';
  let text = rest;
  const commaIdx = rest.indexOf(',');
  if (commaIdx > 0) { note = rest.slice(commaIdx + 1).trim(); text = rest.slice(0, commaIdx).trim(); }
  const bracket = text.match(/\(([^)]*)\)/g);
  if (bracket) { note = [note, ...bracket.map((b) => b.slice(1, -1))].filter(Boolean).join('; '); text = text.replace(/\([^)]*\)/g, ' ').trim(); }

  if (packUnit) return { raw: String(raw).trim(), qty: (qty ?? 1) * packQty, qtyMin: qtyMin != null ? qtyMin * packQty : null, unit: packUnit, text, note, optional, toTaste };
  return { raw: String(raw).trim(), qty, qtyMin, unit, text, note, optional, toTaste };
}

// ── Conversion to base unit ───────────────────────────────────────
function gramsPerMl(ing) {
  if (ing.density) return ing.density;
  if (ing.cupG) return ing.cupG / US_CUP_ML;
  return 1;
}

/** qty + unit -> ingredient base unit. @returns {{ qty: number|null, approx: boolean }} */
export function toBase(qty, unitKey, ing, opts = {}) {
  if (qty == null) return { qty: null, approx: false };
  const u = unitKey ? UNITS[unitKey] : null;
  let g = null; let ml = null; let count = null; let approx = false; let spoon = null;

  if (!u) count = qty;
  else if (u.kind === 'mass') g = qty * u.f;
  else if (u.kind === 'volume') {
    const f = unitKey === 'pint' && opts.pint === 'UK' ? 568.261 : unitKey === 'floz' && opts.pint === 'UK' ? 28.4131 : u.f;
    ml = qty * f;
    if (['tsp', 'tbsp', 'dsp', 'pinch', 'dash'].includes(unitKey)) spoon = ml;
  } else if (u.kind === 'count') count = qty;
  else if (u.kind === 'container') count = ing.base === 'count' ? qty * (ing.pack?.size || 1) : qty;
  else if (u.kind === 'special') {
    approx = unitKey !== 'stick';
    if (unitKey === 'stick') { if (ing.id === 'butter') g = qty * 113.4; else count = qty; }
    else if (unitKey === 'knob') g = qty * 15;
    else if (unitKey === 'handful') { if (ing.base === 'count') count = qty * 3; else g = qty * 25; }
    else if (unitKey === 'bunch') { if (ing.base === 'count') count = qty * (ing.pack?.size || 1); else g = qty * (ing.unitG || 30); }
    else if (unitKey === 'cm') g = qty * 5;
  }

  const tspG = ing.tspG ?? (ing.tbspG ? ing.tbspG / 3 : ing.cupG ? ing.cupG / 48 : 2.5);
  const containerG = u?.kind === 'container' ? (ing.unitG ?? ing.pack?.size) : ing.unitG;
  const containerMl = u?.kind === 'container' ? (ing.unitMl ?? ing.pack?.size) : ing.unitMl;

  let out = null;
  if (ing.base === 'g') {
    if (g != null) out = g;
    else if (ml != null) {
      if (spoon != null && ing.tbspG) out = (spoon / 15) * ing.tbspG;
      else if (spoon != null && ing.tspG) out = (spoon / 5) * ing.tspG;
      else { out = ml * gramsPerMl(ing); approx = approx || !ing.cupG; }
    } else if (count != null && containerG) { out = count * containerG; approx = approx || u?.kind !== 'container'; }
  } else if (ing.base === 'ml') {
    if (ml != null) out = ml;
    else if (g != null) { out = g / gramsPerMl(ing); approx = true; }
    else if (count != null && containerMl) out = count * containerMl;
  } else if (ing.base === 'tsp') {
    if (ml != null) out = ml / 5;
    else if (g != null) { out = g / tspG; approx = true; }
  } else if (ing.base === 'count') {
    if (count != null) out = count;
    else if (g != null && ing.unitG) { out = g / ing.unitG; approx = true; }
    else if (ml != null && ing.unitMl) { out = ml / ing.unitMl; approx = true; }
    else if (ml != null && ing.cupG && ing.unitG) { out = (ml / US_CUP_ML) * ing.cupG / ing.unitG; approx = true; }
  }
  return { qty: out != null && Number.isFinite(out) ? out : null, approx };
}

// ── Formatting ────────────────────────────────────────────────────
/** UK-friendly rounding: 7.5 g, 42 g, 115 g, 1.25 kg */
export function roundSmart(x) {
  if (x == null || !Number.isFinite(x)) return x;
  const a = Math.abs(x);
  if (a < 10) return Math.round(x * 2) / 2;
  if (a < 100) return Math.round(x);
  if (a < 1000) return Math.round(x / 5) * 5;
  return Math.round(x / 10) * 10;
}

const FRAC_GLYPH = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
function niceFraction(x) {
  const q = Math.round(x * 4) / 4;
  const whole = Math.floor(q); const frac = +(q - whole).toFixed(2);
  if (q === 0) return x > 0 ? '¼' : '0';
  return `${whole || ''}${FRAC_GLYPH[frac] || ''}` || String(whole);
}
function trimNum(n, dp = 2) { return String(+n.toFixed(dp)); }

/** "195 g", "1.25 kg", "475 ml", "1½ tsp", "2 tbsp", "3" */
export function formatQty(qty, baseUnit) {
  if (qty == null) return '';
  if (baseUnit === 'g') { const r = roundSmart(qty); return r >= 1000 ? `${trimNum(r / 1000)} kg` : `${trimNum(r, 1)} g`; }
  if (baseUnit === 'ml') { const r = roundSmart(qty); return r >= 1000 ? `${trimNum(r / 1000)} l` : `${trimNum(r, 1)} ml`; }
  if (baseUnit === 'tsp') {
    if (qty >= 3 && Math.abs(qty / 3 - Math.round(qty / 3 * 2) / 2) < 0.01) return `${niceFraction(qty / 3)} tbsp`;
    return `${niceFraction(qty)} tsp`;
  }
  const r = Math.max(0.5, Math.round(qty * 2) / 2);
  return Number.isInteger(r) ? String(r) : niceFraction(r);
}

// ── Public: normalise lines ───────────────────────────────────────
export function normalizeLine(raw, opts = {}) {
  const p = parseLine(raw);
  let ing = findIngredient(p.text) || findIngredient(`${p.text} ${p.note}`);
  let custom = null;
  if (!ing) {
    const name = p.text.split(' ').filter((w) => !PREP_WORDS.includes(w.toLowerCase())).join(' ') || p.text;
    custom = makeCustomIngredient(name, p.unit);
    ing = catalog.get(custom.id) || custom;
  }
  const { qty: baseQty, approx } = toBase(p.qty, p.unit, ing, opts);
  return {
    raw: p.raw,
    ingredientId: ing.id,
    name: ing.name,
    qty: p.qty,
    unit: p.unit,
    baseQty: baseQty != null ? +baseQty.toFixed(3) : null,
    baseUnit: ing.base,
    approx,
    note: p.note,
    optional: p.optional,
    toTaste: p.toTaste || (p.qty == null && !!ing.always),
    display: baseQty != null ? `${approx ? '≈ ' : ''}${formatQty(baseQty, ing.base)}` : (p.toTaste ? 'to taste' : ''),
    newIngredient: custom && !catalog.has(custom.id) ? custom : undefined,
  };
}

/** US if the recipe uses cups / °F / sticks of butter (affects pints & fl oz). */
export function detectSystem(lines = [], text = '') {
  const all = `${lines.join(' ')} ${text}`.toLowerCase();
  return /\bcups?\b|°f|\bfahrenheit\b|\bsticks? of butter\b/.test(all) ? 'US' : 'UK';
}

export function normalizeIngredients(lines, opts = {}) {
  const pint = opts.pint || detectSystem(lines);
  return lines.filter((l) => String(l).trim()).map((l) => normalizeLine(l, { ...opts, pint }));
}

// ── Aggregation ───────────────────────────────────────────────────
/** Sums lines per ingredient: 50 g + 30 g + 113.5 g = 193.5 g -> "195 g". */
export function aggregate(lines, scale = 1) {
  const map = new Map();
  for (const l of lines) {
    if (!l || !l.ingredientId) continue;
    const ing = getIngredient(l.ingredientId) || { id: l.ingredientId, name: l.name, base: l.baseUnit };
    const e = map.get(l.ingredientId) || { ingredientId: l.ingredientId, name: ing.name, baseUnit: ing.base, baseQty: 0, parts: [], unresolved: [], toTaste: false, optional: true, approx: false, sources: [] };
    if (l.baseQty != null) { const q = l.baseQty * (l.scale ?? scale); e.baseQty += q; e.parts.push(q); e.approx = e.approx || l.approx; }
    else if (l.toTaste) e.toTaste = true;
    else e.unresolved.push(l.raw);
    e.optional = e.optional && !!l.optional;
    if (l.source && !e.sources.includes(l.source)) e.sources.push(l.source);
    map.set(l.ingredientId, e);
  }
  for (const e of map.values()) e.display = e.parts.length ? formatQty(e.baseQty, e.baseUnit) : (e.toTaste ? 'to taste' : '');
  return [...map.values()];
}

/** "50 g + 30 g + 115 g = 195 g Butter" */
export function explainAggregate(entry) {
  return `${entry.parts.map((p) => formatQty(p, entry.baseUnit)).join(' + ')} = ${formatQty(entry.baseQty, entry.baseUnit)} ${entry.name}`;
}

// ── Temperatures & method text ────────────────────────────────────
const GAS = [[135, '1'], [150, '2'], [165, '3'], [180, '4'], [190, '5'], [200, '6'], [220, '7'], [230, '8'], [240, '9']];
export function fToC(f) { return (f - 32) * 5 / 9; }

/** 350°F -> { c: 180, fan: 160, gas: '4' } */
export function ovenFromF(f) {
  const c = Math.round(fToC(f) / 10) * 10;
  let gas = null; let best = Infinity;
  for (const [t, g] of GAS) if (Math.abs(t - c) < best) { best = Math.abs(t - c); gas = g; }
  return { c, fan: c - 20, gas: c >= 120 ? gas : null };
}

/** Rewrites °F and inch tin sizes inside method text. */
export function convertTextToUK(text = '') {
  return String(text)
    .replace(/(\d{2,3})\s*(?:°|º|˚|degrees?)\s*(?:F\b|Fahrenheit)(?:\s*\(\s*\d{2,3}\s*(?:°|º|degrees?)?\s*C\)?)?|(\d{3})\s?F\b/gi, (m, a, b) => {
      const f = +(a || b);
      if (f < 200) return `${Math.round(fToC(f))}°C`;
      const o = ovenFromF(f);
      return `${o.c}°C (${o.fan}°C fan${o.gas ? `, gas ${o.gas}` : ''})`;
    })
    .replace(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*|-)(?:inch(?:es)?|in\.|")/gi, (_, a, b) => `${Math.round(a * 2.54)} x ${Math.round(b * 2.54)}cm`)
    .replace(/(\d+(?:\.\d+)?)(?:\s*|-)(?:inch(?:es)?|")(?=[\s-])/gi, (_, a) => `${Math.round(a * 2.54)}cm`);
}
