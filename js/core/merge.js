// Two-device merge: per-record last-write-wins + tombstones for deletions.
// receiptKey (learned receipt wording) is shared too, so one person's corrections help the other.
export const COLLECTIONS = ['inventory', 'recipes', 'customIngredients', 'receiptKey'];

function newer(a, b) { return (a?.updatedAt || '') >= (b?.updatedAt || '') ? a : b; }

function mergeList(a = [], b = [], tomb = {}) {
  const map = new Map();
  for (const x of [...a, ...b]) { const prev = map.get(x.id); map.set(x.id, prev ? newer(prev, x) : x); }
  return [...map.values()].filter((x) => !(tomb[x.id] && tomb[x.id] >= (x.updatedAt || '')));
}

export function mergeState(local, remote) {
  if (!remote) return local;
  const tombstones = { ...(remote.tombstones || {}) };
  for (const [id, t] of Object.entries(local.tombstones || {})) if (!tombstones[id] || t > tombstones[id]) tombstones[id] = t;
  const out = { ...local, tombstones };
  for (const c of COLLECTIONS) out[c] = mergeList(local[c], remote[c], tombstones);
  out.plans = { ...(remote.plans || {}) };
  for (const [wk, plan] of Object.entries(local.plans || {})) out.plans[wk] = out.plans[wk] ? newer(plan, out.plans[wk]) : plan;
  const ls = local.shopping || { items: [] }; const rs = remote.shopping || { items: [] };
  out.shopping = { ...newer(ls, rs), items: mergeList(ls.items, rs.items, tombstones) };
  out.settings = local.settings; // device settings (AI key, token) stay local
  out.updatedAt = [local.updatedAt, remote.updatedAt].sort().pop();
  return out;
}
