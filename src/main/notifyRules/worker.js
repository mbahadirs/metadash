/**
 * Notification rule "worker" — STUB (v2.0 chunk B). Chunk E owns this file: worker items failed / missed, token expiring on the worker, route /planner.
 * Contract (see notifyRules.js EXTRA_RULES):
 *   export const rule = null | {
 *     type: 'worker',                          // notify.worker preference key; must be unique
 *     cooldownMs: number,
 *     gather: (now) => object,             // impure data read (DB), called by notifications.js only when enabled
 *     pick: (data, ctx) => note | null,    // pure; ctx = { now, lang, sent, wasSent, nameList, cooldownMs }
 *   }
 *   note = { type, key, keys, title, body, route }
 */
export const rule = null;
