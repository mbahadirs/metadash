import { msg } from '../i18n.js';
import { myUnseenMentions } from '../team/notes.js';
import { accountOfEntity } from '../team/scope.js';

/**
 * Notification rule "mentions": "@you were mentioned in a note" (notify.mentions preference, notifyRules.js EXTRA_RULES).
 * gather() reads unseen mentions of this machine's member; pick() is pure.
 */
const COOLDOWN_MS = 30 * 86_400_000; // one notification per note; the key embeds the note uid
const MAX_PREVIEW = 80;

function routeFor(n) {
  const account = accountOfEntity(n.entity_type, n.entity_id);
  if (n.entity_type === 'comment') return '/inbox';
  return account ? `/account/${encodeURIComponent(account)}` : '/';
}

export function gatherMentions() {
  return { mentions: myUnseenMentions().map((n) => ({ uid: n.uid, author: n.author_name ?? '', body: n.body, route: routeFor(n) })) };
}

export function pickMentions({ mentions = [] }, ctx) {
  const fresh = mentions.filter((m) => !ctx.wasSent(ctx.sent, `mention:${m.uid}`, ctx.now, COOLDOWN_MS));
  if (!fresh.length) return null;
  const first = fresh[0];
  const preview = first.body.length > MAX_PREVIEW ? `${first.body.slice(0, MAX_PREVIEW - 1)}…` : first.body;
  const body = fresh.length === 1
    ? msg('team_notify_mention_one', { author: first.author || '?', text: preview }, ctx.lang)
    : msg('team_notify_mention_many', { n: fresh.length }, ctx.lang);
  const keys = fresh.map((m) => `mention:${m.uid}`);
  return { type: 'mentions', key: keys[0], keys, title: msg('team_notify_mentions_title', null, ctx.lang), body, route: fresh.length === 1 ? first.route : '/' };
}

export const rule = Object.freeze({ type: 'mentions', cooldownMs: COOLDOWN_MS, gather: () => gatherMentions(), pick: pickMentions });
