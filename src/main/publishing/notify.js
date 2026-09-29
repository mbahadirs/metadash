import { getConfig } from '../config/store.js';
import { msg } from '../i18n.js';

/**
 * Desktop notifications for publishing (success, failure, missed posts, paused auth, quota). Clicking one opens the
 * Planner through appWindow.navigateTo (recreating the window in tray mode). Respects notify.enabled,
 * notify.publishSuccess and notify.publishFailure; silent in demo mode. Electron is loaded lazily so the module stays
 * importable in tests (ELECTRON_RUN_AS_NODE); tests inject `show`.
 */
const live = new Set(); // keeps Notification objects alive so click handlers survive GC
const DEDUPE_MS = 6 * 3_600_000;

async function electronShow(note) {
  const electron = await import('electron');
  const Notification = electron.Notification ?? electron.default?.Notification;
  if (!Notification?.isSupported?.()) return false;
  const { navigateTo } = await import('../appWindow.js');
  const n = new Notification({ title: note.title, body: note.body });
  live.add(n);
  const release = () => live.delete(n);
  n.on('click', () => { release(); navigateTo(note.route); });
  n.on('close', release);
  n.show();
  return true;
}

const label = (account, target) => (account?.username ? `@${account.username}` : target?.accountId ?? '');
const PLATFORM_NAMES = { instagram: 'Instagram', facebook: 'Facebook', threads: 'Threads', meta: 'Meta' };

/**
 * @param {{ show?: (note: {title, body, route}) => Promise<boolean>|boolean, config?: (key: string) => unknown,
 *   isDemo?: () => boolean, now?: () => number }} [deps]
 */
export function createPublishNotifier({ show = electronShow, config = getConfig, isDemo = () => false, now = Date.now } = {}) {
  const recent = new Map(); // dedupe key → at
  const enabled = (pref) => config('notify.enabled') !== false && (!pref || config(pref) !== false) && !isDemo();
  const once = (key) => {
    const at = recent.get(key);
    if (at != null && now() - at < DEDUPE_MS) return false;
    recent.set(key, now());
    return true;
  };
  const send = (note) => {
    try {
      return Promise.resolve(show(note)).catch((e) => { console.error('[publishing] notification failed:', e?.message ?? e); return false; });
    } catch (e) {
      console.error('[publishing] notification failed:', e?.message ?? e);
      return Promise.resolve(false);
    }
  };

  return {
    published({ post, target, account }) {
      if (!enabled('notify.publishSuccess')) return Promise.resolve(false);
      return send({ title: msg('notify_publish_ok_title'), body: msg('notify_publish_ok_body', { ref: post.ref, account: label(account, target), platform: PLATFORM_NAMES[target.platform] ?? target.platform }), route: `/planner?post=${post.id}` });
    },
    failed({ post, target, account, message }) {
      if (!enabled('notify.publishFailure')) return Promise.resolve(false);
      return send({ title: msg('notify_publish_fail_title'), body: msg('notify_publish_fail_body', { ref: post.ref, account: label(account, target), platform: PLATFORM_NAMES[target.platform] ?? target.platform, error: String(message ?? '').slice(0, 160) }), route: `/planner?tab=queue&post=${post.id}` });
    },
    missed(count) {
      if (!count || !enabled('notify.publishFailure')) return Promise.resolve(false);
      return send({ title: msg('notify_missed_title'), body: msg(count === 1 ? 'notify_missed_body_one' : 'notify_missed_body', { n: count }), route: '/planner?tab=queue&missed=1' });
    },
    authPaused(auth) {
      if (!enabled('notify.publishFailure') || !once(`auth:${auth}`)) return Promise.resolve(false);
      return send({ title: msg('notify_auth_paused_title'), body: msg('notify_auth_paused_body', { platform: PLATFORM_NAMES[auth] ?? auth }), route: '/settings' });
    },
    quota({ account, target }) {
      if (!enabled('notify.publishFailure') || !once(`quota:${target.accountId}`)) return Promise.resolve(false);
      return send({ title: msg('notify_quota_title'), body: msg('notify_quota_body', { account: label(account, target) }), route: '/planner?tab=queue' });
    },
  };
}
