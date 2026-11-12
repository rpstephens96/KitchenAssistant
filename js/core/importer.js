// Recipe import: URL (via CORS proxies) -> schema.org JSON-LD -> normalised recipe. No DOM, unit-testable.
import { normalizeIngredients, convertTextToUK, decodeEntities, detectSystem } from './normalizer.js';
import { uid, nowISO, guessEmoji } from './util.js';

export const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

export async function fetchHtml(url, { fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  let lastErr;
  for (const make of [(u) => u, ...PROXIES]) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(make(url), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (html && html.length > 200) return html;
      throw new Error('Empty response');
    } catch (e) { lastErr = e; } finally { clearTimeout(t); }
  }
  throw new Error(`Couldn't reach that page (${lastErr?.message || 'blocked'}). Try "Paste" instead.`);
}

/** PT1H30M -> 90 */
export function isoDurationToMinutes(d) {
  if (!d || typeof d !== 'string') return null;
  const m = d.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m) return null;
  return ((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + Math.round((+m[4] || 0) / 60)) || null;
}

function isRecipeType(t) { return Array.isArray(t) ? t.some(isRecipeType) : String(t || '').toLowerCase() === 'recipe'; }
function findRecipeNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipeNode(n); if (r) return r; } return null; }
  if (isRecipeType(node['@type'])) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) { const r = findRecipeNode(node[key]); if (r) return r; }
  return null;
}
function pickImage(img) {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return pickImage(img[0]);
  return img.url || img.contentUrl || '';
}
function stripTags(s) { return decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function flattenInstructions(ins) {
  if (!ins) return [];
  if (typeof ins === 'string') return ins.split(/\n+|(?<=\.)\s+(?=[A-Z])/).map(stripTags).filter(Boolean);
  if (Array.isArray(ins)) return ins.flatMap(flattenInstructions);
  if (ins.itemListElement) return flattenInstructions(ins.itemListElement);
  if (ins.text) return [stripTags(ins.text)];
  if (ins.name) return [stripTags(ins.name)];
  return [];
}
function parseYield(y) { const m = String((Array.isArray(y) ? y[0] : y) ?? '').match(/\d+/); return m ? +m[0] : null; }

export function extractRecipeFromHtml(html, sourceUrl = '') {
  for (const [, json] of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(json.trim()); } catch {
      try { data = JSON.parse(json.trim().replace(/[\u0000-\u001f]+/g, ' ')); } catch { continue; }
    }
    const r = findRecipeNode(data);
    if (!r) continue;
    return {
      title: stripTags(r.name || r.headline || 'Untitled recipe'),
      image: pickImage(r.image), sourceUrl,
      servings: parseYield(r.recipeYield),
      prepMins: isoDurationToMinutes(r.prepTime), cookMins: isoDurationToMinutes(r.cookTime), totalMins: isoDurationToMinutes(r.totalTime),
      ingredients: (r.recipeIngredient || r.ingredients || []).map(stripTags).filter(Boolean),
      method: flattenInstructions(r.recipeInstructions),
    };
  }
  const og = (p) => html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)`, 'i'))?.[1];
  const title = og('title') || html.match(/<title>([^<]+)/i)?.[1];
  if (title) return { title: stripTags(title), image: og('image') || '', sourceUrl, ingredients: [], method: [], partial: true };
  return null;
}

const ING_HEAD = /^\s*(ingredients?|you will need|you'll need|shopping list)\s*:?\s*$/i;
const METHOD_HEAD = /^\s*(method|instructions?|directions?|steps|preparation|how to make( it)?)\s*:?\s*$/i;

export function parseRecipeText(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  let title = lines[0];
  const ingredients = []; const method = [];
  let mode = null;
  for (const l of lines.slice(1)) {
    if (ING_HEAD.test(l)) { mode = 'ing'; continue; }
    if (METHOD_HEAD.test(l)) { mode = 'method'; continue; }
    if (mode === 'ing') ingredients.push(l);
    else if (mode === 'method') method.push(l.replace(/^(step\s*)?\d+[.):]\s*/i, ''));
    else if (/^([\d¼½¾⅓⅔]|[-•*]\s)/.test(l) && !/^\d+[.)]\s+[A-Z]/.test(l)) ingredients.push(l);
    else if (/^\d+[.)]\s+/.test(l)) method.push(l.replace(/^\d+[.)]\s*/, ''));
  }
  if (ING_HEAD.test(title)) title = 'My recipe';
  return { title, image: '', sourceUrl: '', servings: null, ingredients, method };
}

export function buildRecipe(raw, existing = {}) {
  const system = detectSystem(raw.ingredients, (raw.method || []).join(' '));
  const ingredients = normalizeIngredients(raw.ingredients, { pint: system });
  const now = nowISO();
  return {
    id: existing.id || uid('r_'),
    title: raw.title?.trim() || 'Untitled recipe',
    emoji: existing.emoji || raw.emoji || guessEmoji(raw.title),
    image: raw.image || '',
    sourceUrl: raw.sourceUrl || '',
    servings: raw.servings || 4,
    prepMins: raw.prepMins ?? null,
    cookMins: raw.cookMins ?? null,
    totalMins: raw.totalMins ?? ((raw.prepMins || 0) + (raw.cookMins || 0) || null),
    system,
    ingredients: ingredients.map(({ newIngredient, ...l }) => l),
    newIngredients: ingredients.map((l) => l.newIngredient).filter(Boolean),
    method: (raw.method || []).map(convertTextToUK),
    tags: raw.tags || existing.tags || [],
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}
