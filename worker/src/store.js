import fs from 'node:fs';
import path from 'node:path';

/**
 * Worker state: one JSON file (<dataDir>/state.json) plus an in-memory copy. Queues stay small (a few thousand items at
 * most), so a JSON file avoids native modules and keeps multi-arch images simple.
 *
 * Crash safety: every mutation is written to state.json.tmp, fsync'ed, renamed over state.json and the directory is
 * fsync'ed, so the file on disk is always a complete old or new version. `seq` is a monotonic cursor: every item change
 * stamps the item with ++seq and GET /v1/changes returns items with seq > since.
 *
 * Shape: { version, seq, items: {id: Item}, tokens: {key: StoredToken}, media: {sha256: MediaMeta}, meta: {} }
 */
export const STATE_VERSION = 1;
const FILE = 'state.json';
const DEFAULT_CHANGES_LIMIT = 500;

const empty = () => ({ version: STATE_VERSION, seq: 0, items: {}, tokens: {}, media: {}, meta: {} });

function fsyncDir(dir) {
  let fd = null;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); } catch { /* not supported on every platform (e.g. Windows) */ } finally { if (fd != null) fs.closeSync(fd); }
}

/** Atomic write: tmp + fsync + rename + dir fsync. */
export function atomicWriteJson(file, value) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fsyncDir(path.dirname(file));
}

/** @param {{ dir: string, now?: () => number }} opts */
export function createStore({ dir, now = Date.now }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, FILE);
  let state = load();

  function load() {
    if (!fs.existsSync(file)) return empty();
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || raw.version !== STATE_VERSION) throw Object.assign(new Error(`unsupported state version ${raw?.version}`), { code: 'STATE_VERSION' });
    return { ...empty(), ...raw };
  }

  const save = () => atomicWriteJson(file, state);
  const clone = (v) => (v == null ? v : structuredClone(v));

  function mutate(fn) {
    const next = structuredClone(state);
    const out = fn(next);
    atomicWriteJson(file, next);
    state = next;
    return out;
  }

  return {
    file,
    reload() { state = load(); },
    seq: () => state.seq,

    getItem: (id) => clone(state.items[id] ?? null),
    listItems: () => Object.values(state.items).map(clone),

    /** Inserts/replaces an item and stamps it with the next seq. @returns the stored item */
    putItem(item) {
      return mutate((s) => {
        s.seq += 1;
        const stored = { ...item, seq: s.seq, updatedAt: now() };
        s.items[item.id] = stored;
        return clone(stored);
      });
    },

    deleteItem(id) {
      return mutate((s) => { const had = !!s.items[id]; delete s.items[id]; return had; });
    },

    /** @returns {{ seq: number, changes: object[], more: boolean }} */
    changesSince(since = 0, limit = DEFAULT_CHANGES_LIMIT) {
      const all = Object.values(state.items).filter((i) => i.seq > since).sort((a, b) => a.seq - b.seq);
      const page = all.slice(0, limit);
      const more = all.length > page.length;
      return { seq: more ? page[page.length - 1].seq : state.seq, changes: page.map(clone), more };
    },

    getToken: (key) => clone(state.tokens[key] ?? null),
    listTokens: () => Object.entries(state.tokens).map(([key, t]) => ({ key, ...clone(t) })),
    putToken(key, token) { return mutate((s) => { s.tokens[key] = token; return clone(token); }); },
    deleteToken(key) { return mutate((s) => { const had = !!s.tokens[key]; delete s.tokens[key]; return had; }); },

    getMedia: (sha) => clone(state.media[sha] ?? null),
    listMedia: () => Object.entries(state.media).map(([sha, m]) => ({ sha, ...clone(m) })),
    putMedia(sha, meta) { return mutate((s) => { s.media[sha] = meta; return clone(meta); }); },
    deleteMedia(sha) { return mutate((s) => { delete s.media[sha]; }); },

    getMeta: (k) => clone(state.meta[k] ?? null),
    setMeta(k, v) { return mutate((s) => { if (v == null) delete s.meta[k]; else s.meta[k] = v; }); },

    /** Removes every item, token and media record (desktop "disconnect"); seq keeps growing. */
    reset() { return mutate((s) => { s.items = {}; s.tokens = {}; s.media = {}; }); },

    save,
  };
}
