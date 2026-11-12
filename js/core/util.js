export const uid = (p = '') => p + (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
export const nowISO = () => new Date().toISOString();

/** Local calendar date YYYY-MM-DD. */
export function isoDate(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function parseISODate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(iso, n) { const d = parseISODate(iso); d.setDate(d.getDate() + n); return isoDate(d); }
export function daysBetween(fromIso, toIso) { return Math.round((parseISODate(toIso) - parseISODate(fromIso)) / 86400000); }

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
export const MEALS = ['breakfast', 'lunch', 'dinner'];

export function weekStartOf(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return isoDate(x);
}

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const EMOJI_RULES = [
  [/cookie|biscuit/, '🍪'], [/cake|brownie|muffin|cupcake/, '🍰'], [/pancake|waffle/, '🥞'], [/pizza/, '🍕'],
  [/taco|fajita|burrito|quesadilla|enchilada/, '🌮'], [/burger/, '🍔'], [/curry|dal|dhal|tikka|masala|korma/, '🍛'],
  [/risotto|mushroom/, '🍄'], [/pasta|spaghetti|bolognese|lasagne|lasagna|carbonara|penne|linguine|mac/, '🍝'],
  [/noodle|ramen|pad thai|stir.?fry/, '🍜'], [/soup|stew|chilli|chili|casserole/, '🍲'], [/salad/, '🥗'],
  [/salmon|fish|cod|haddock|tuna|prawn|shrimp/, '🐟'], [/sausage|hot dog/, '🌭'], [/omelette|egg|frittata|shakshuka/, '🍳'],
  [/pie|tart|quiche/, '🥧'], [/bread|loaf|focaccia/, '🍞'], [/chicken/, '🍗'], [/beef|steak/, '🥩'], [/rice|paella|biryani/, '🍚'],
  [/porridge|oat|granola/, '🥣'], [/sandwich|toastie|wrap/, '🥪'],
];
export function guessEmoji(title = '') {
  const t = title.toLowerCase();
  for (const [re, e] of EMOJI_RULES) if (re.test(t)) return e;
  return '🍽️';
}
