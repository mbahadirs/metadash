/**
 * Notification rule "inbox" — STUB (v2.0 chunk B). Chunk D owns this file: "N comments past SLA" (inbox.slaHours), route /inbox.
 * Contract (see notifyRules.js EXTRA_RULES):
 *   export const rule = null | {
 *     type: 'inbox',                          // notify.inbox preference key; must be unique
 *     cooldownMs: number,
 *     gather: (now) => object,             // impure data read (DB), called by notifications.js only when enabled
 *     pick: (data, ctx) => note | null,    // pure; ctx = { now, lang, sent, wasSent, nameList, cooldownMs }
 *   }
 *   note = { type, key, keys, title, body, route }
 */
export const rule = null;
