// GitHub Gist sync between the two phones (token with ONLY the "gist" scope). Sync = pull -> merge -> push.
const API = 'https://api.github.com/gists';
const FILE = 'larder-data.json';
const headers = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' });

export async function pullGist({ token, id }) {
  const res = await fetch(`${API}/${id}`, { headers: headers(token), cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'Gist not found — check the ID' : res.status === 401 ? 'Token rejected — it needs the "gist" scope' : `GitHub said ${res.status}`);
  const f = (await res.json()).files?.[FILE];
  if (!f) return null;
  return JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
}

export async function pushGist({ token, id }, json) {
  const body = JSON.stringify({ description: 'Larder kitchen data (auto-synced)', files: { [FILE]: { content: json } }, ...(id ? {} : { public: false }) });
  const res = await fetch(id ? `${API}/${id}` : API, { method: id ? 'PATCH' : 'POST', headers: headers(token), body });
  if (!res.ok) throw new Error(res.status === 401 ? 'Token rejected — it needs the "gist" scope' : `GitHub said ${res.status}`);
  return (await res.json()).id;
}

export const syncReady = (s) => !!(s.settings.gist?.token && s.settings.gist?.id);

let running = null;
/** Pull, merge (newest edit of each record wins, deletions carry over), push. Concurrent calls share one run. */
export function syncNow(store) {
  running ||= (async () => {
    try {
      const g = store.state.settings.gist;
      if (!g?.token) throw new Error('Add a GitHub token first');
      if (g.id) { const remote = await pullGist(g); if (remote) store.mergeIn(remote, { source: 'sync' }); }
      const id = await pushGist(g, store.exportJSON());
      store.update((s) => { s.settings.gist.id = id; s.settings.lastSync = new Date().toISOString(); }, { source: 'sync' });
      return id;
    } finally { running = null; }
  })();
  return running;
}
