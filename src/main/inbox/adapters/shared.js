/** Helpers shared by the built-in inbox adapters. Comment text is untrusted data: it is stored and shown as text only. */
export const TEXT_MAX = 8000;

export const cleanText = (v) => String(v ?? '').replace(/\u0000/g, '').slice(0, TEXT_MAX);
export const toMs = (v) => {
  const t = typeof v === 'number' ? v : Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? t : null;
};
export const metaToken = (ctx) => (ctx.tokenFor ? ctx.tokenFor('meta') : ctx.token);

/**
 * Follows `parentOf` (raw id → raw parent id) to the top-level comment of a flattened conversation. Stops at `rootId`
 * (the post) or when a parent is unknown in this batch (the last known id is used).
 */
export function topLevelOf(id, parentOf, rootId) {
  let cur = id;
  const seen = new Set([id]);
  for (;;) {
    const p = parentOf.get(cur);
    if (p == null || p === rootId) return cur === id ? null : cur;
    if (!parentOf.has(p) || seen.has(p)) return p;
    seen.add(p);
    cur = p;
  }
}
