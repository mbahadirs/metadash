import { teamError } from './errors.js';
import { scopedAccountIds, accountOfMedia, accountOfEntity, accountOfComment } from './scope.js';

/**
 * IPC policy: ipc/index.js handle() calls check(channel, args, session) before every handler; throwing denies the
 * call ({ code: 'FORBIDDEN' }). Rules (plan §5):
 *  1. client role: default-deny with an allowlist; account / media / note ids in the arguments must belong to the
 *     scoped clients, and list-style analytics calls without explicit accounts are narrowed to the scope.
 *  2. read-only (subscriber) workspace: sync, setup, replies/hide, publishing and other token-bound actions are off.
 *  3. admin-only: setup:*, settings:set (except UI/language/theme/notification preferences), transfer:*, db:*,
 *     worker:*, ai:setKey, team:create.
 * These are UI and workflow guardrails on an untrusted client machine, not a security boundary (docs/team.md).
 */
const UI_PREF_KEYS = new Set(['lang', 'theme', 'lastPeriod']);
export const isUiPrefKey = (k) => UI_PREF_KEYS.has(String(k)) || String(k).startsWith('ui.');
const isLocalPrefKey = (k) => isUiPrefKey(k) || String(k).startsWith('notify.');

export const ADMIN_ONLY_PREFIXES = Object.freeze(['setup:', 'transfer:', 'db:', 'worker:']);
export const ADMIN_ONLY = Object.freeze(['ai:setKey', 'team:create']);
/** Reads every role needs (the app shell asks for them on start). */
export const ALWAYS_ALLOWED = Object.freeze(['setup:getState', 'setup:getTokenHealth', 'session:get']);

export const CLIENT_ALLOW = Object.freeze([
  'accounts:list', 'accounts:get', 'accounts:clientLogos', 'accounts:getClientLogo', 'platforms:list',
  'export:pdf', 'export:html', 'export:preview', 'export:sections', 'export:branding',
  'notes:list', 'session:get', 'session:exitClientView', 'settings:get', 'settings:all', 'settings:set', 'i18n:msg',
  'sync:status', 'sync:suggest', 'sync:history', 'system:online', 'system:info', 'update:status', 'tags:list',
  'team:getState', 'setup:getState',
]);
export const CLIENT_ALLOW_PREFIXES = Object.freeze(['analytics:']);
/** Channels whose "no accounts given = all accounts" query must be narrowed to the client scope. */
export const CLIENT_SCOPE_INJECT = Object.freeze(['analytics:content', 'analytics:contentAnalysis', 'analytics:bestTime']);

export const READ_ONLY_BLOCK = Object.freeze([
  'sync:run', 'sync:cancel', 'sync:enableMetric',
  'inbox:reply', 'inbox:hide', 'inbox:retry', 'inbox:refresh',
  'studio:replies:send', 'studio:replies:refresh',
  'publishing:publishNow', 'publishing:schedule', 'publishing:retry', 'publishing:resolveMissed', 'publishing:setPaused',
  'publishing:mediaHost:set', 'publishing:mediaHost:test',
  'competitors:add', 'ads:setBudget', 'ads:setObjectBudget', 'ads:link', 'ads:setTracked',
  'team:create', 'team:publishNow', 'db:restore', 'transfer:import',
]);
export const READ_ONLY_BLOCK_PREFIXES = Object.freeze(['setup:', 'worker:']);

export function denied(channel) {
  return Object.assign(teamError('TEAM_FORBIDDEN'), { code: 'FORBIDDEN', channel });
}

const inList = (channel, exact, prefixes = []) => exact.includes(channel) || prefixes.some((p) => channel.startsWith(p));

/** Account keys referenced by a call's first argument (ids of accounts, media, notes' entities, comments). */
export function accountIdsInArgs(channel, args) {
  const p = args?.[0];
  const ids = [];
  const push = (v) => { if (v != null && v !== '') ids.push(String(v)); };
  if (typeof p === 'string' || typeof p === 'number') {
    if (channel === 'analytics:media') push(accountOfMedia(p) ?? `media:${p}`);
    else if (channel.startsWith('accounts:')) push(p); // accounts:get(igId), accounts:getClientLogo(igId)
    return ids;
  }
  const visit = (o) => {
    if (!o || typeof o !== 'object') return;
    push(o.igId); push(o.accountId);
    for (const k of ['igIds', 'accountIds']) if (Array.isArray(o[k])) o[k].forEach(push);
    if (o.mediaId != null) push(accountOfMedia(o.mediaId) ?? `media:${o.mediaId}`);
    if (Array.isArray(o.mediaIds)) o.mediaIds.forEach((m) => push(accountOfMedia(m) ?? `media:${m}`));
    if (o.commentId != null) push(accountOfComment(o.commentId) ?? `comment:${o.commentId}`);
    if (o.entityType && o.entityId != null) push(accountOfEntity(o.entityType, o.entityId) ?? `${o.entityType}:${o.entityId}`);
  };
  visit(p);
  if (p && typeof p === 'object') visit(p.params);
  return ids;
}

function checkClient(channel, args, session) {
  if (!inList(channel, CLIENT_ALLOW, CLIENT_ALLOW_PREFIXES)) throw denied(channel);
  if (channel === 'settings:set' && !isUiPrefKey(args?.[0])) throw denied(channel);
  if (args?.[0] && typeof args[0] === 'object' && args[0].unscoped) throw denied(channel); // listAccounts escape hatch
  const scope = scopedAccountIds(session.clientScope);
  const ids = accountIdsInArgs(channel, args);
  if (ids.some((id) => !scope.has(id))) throw denied(channel);
  if (CLIENT_SCOPE_INJECT.includes(channel) && Array.isArray(args)) {
    const p = args[0] && typeof args[0] === 'object' ? args[0] : {};
    // The handler receives this same array: an unscoped "all accounts" query becomes "the scoped accounts".
    if (!p.igId && !p.igIds?.length) args[0] = { ...p, igIds: [...scope] };
  }
}

export function check(channel, args, session) {
  if (!session) return;
  const ch = String(channel);
  if (session.role === 'client') {
    checkClient(ch, args, session);
    return;
  }
  if (ALWAYS_ALLOWED.includes(ch)) return;
  if (session.readOnly && inList(ch, READ_ONLY_BLOCK, READ_ONLY_BLOCK_PREFIXES)) throw denied(ch);
  if (session.role === 'admin') return;
  // A subscriber can never be admin but may use its own AI key (machine-local, never in the shared folder).
  if (session.readOnly && ch === 'ai:setKey') return;
  if (inList(ch, ADMIN_ONLY, ADMIN_ONLY_PREFIXES)) throw denied(ch);
  if (ch === 'settings:set' && !isLocalPrefKey(args?.[0])) throw denied(ch);
}
