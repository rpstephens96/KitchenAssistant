// State container: localStorage persistence, undo stack, revision counter, backup export/import.
import { buildSeedState, defaultSettings } from './data/seed.js';
import { setCustomIngredients } from './core/normalizer.js';
import { mergeState } from './core/merge.js';
import { nowISO, isoDate } from './core/util.js';

export const KEY = 'larder.v1';
const UNDO_LIMIT = 40;

export function migrate(s) {
  s.schemaVersion ??= 1;
  s.tombstones ??= {};
  s.customIngredients ??= [];
  s.receiptKey ??= [];
  s.shopping ??= { items: [] };
  const d = defaultSettings();
  s.settings = { ...d, ...(s.settings || {}) };
  s.settings.gist = { ...d.gist, ...(s.settings.gist || {}) };
  s.settings.ai = { ...d.ai, ...(s.settings.ai || {}) };
  return s;
}

/** Custom ingredients plus any defined only inside receipt-key entries. */
function registerAll(s) {
  const extra = (s.receiptKey || []).map((e) => e.custom).filter(Boolean);
  setCustomIngredients([...s.customIngredients, ...extra.filter((c) => !s.customIngredients.some((x) => x.id === c.id))]);
}

function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { console.warn('Could not read saved data', e); }
  return buildSeedState();
}

const listeners = new Set();
const undoStack = [];

export const store = {
  state: load(),
  rev: 0, // increments on every change; lets the assistant undo exactly its own changes

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { console.error('Save failed', e); } },

  /** Mutate with an undo snapshot. `source: 'sync'` marks changes that came from the other phone. */
  update(fn, { label = null, source = 'local' } = {}) {
    undoStack.push(JSON.stringify(this.state));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    fn(this.state);
    if (source !== 'sync') this.state.updatedAt = nowISO();
    this.rev++;
    registerAll(this.state);
    this.save();
    listeners.forEach((l) => l({ label, source }));
  },

  canUndo() { return undoStack.length > 0; },

  undo(times = 1) {
    let prev = null;
    for (let i = 0; i < times && undoStack.length; i++) prev = undoStack.pop();
    if (!prev) return false;
    this.state = JSON.parse(prev);
    this.rev++;
    registerAll(this.state);
    this.save();
    listeners.forEach((l) => l({ label: null, source: 'local' }));
    return true;
  },

  tombstone(id) { this.state.tombstones[id] = nowISO(); },
  replaceAll(next) { this.update((s) => { Object.keys(s).forEach((k) => delete s[k]); Object.assign(s, migrate(next)); }); },
  mergeIn(remote, opts = {}) { this.update((s) => Object.assign(s, mergeState(s, migrate(remote))), opts); },

  /** Secrets (GitHub token, AI key) never leave the device in a file or Gist. */
  exportJSON() {
    const copy = JSON.parse(JSON.stringify(this.state));
    if (copy.settings?.gist) copy.settings.gist.token = '';
    if (copy.settings?.ai) copy.settings.ai.key = '';
    return JSON.stringify({ app: 'larder', exportedAt: nowISO(), ...copy }, null, 2);
  },

  downloadBackup() {
    const blob = new Blob([this.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `larder-backup-${isoDate()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  resetToDemo() { const keep = this.state.settings; this.replaceAll({ ...buildSeedState(), settings: keep }); },
};

registerAll(store.state);
