/**
 * Notification rule "mentions" — STUB (v2.0 chunk B). Chunk F1 owns this file: "@you were mentioned in a note", route to the note entity.
 * Contract (see notifyRules.js EXTRA_RULES):
 *   export const rule = null | {
 *     type: 'mentions',                          // notify.mentions preference key; must be unique
 *     cooldownMs: number,
 *     gather: (now) => object,             // impure data read (DB), called by notifications.js only when enabled
 *     pick: (data, ctx) => note | null,    // pure; ctx = { now, lang, sent, wasSent, nameList, cooldownMs }
 *   }
 *   note = { type, key, keys, title, body, route }
 */
export const rule = null;
