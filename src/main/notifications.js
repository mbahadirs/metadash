import { Notification } from 'electron';
import { subDays } from 'date-fns';
import { getConfig } from './config/store.js';
import { getSetting, setSetting } from './db/queries/settings.js';
import { getActiveProfile } from './db/queries/profiles.js';
import { listAccounts } from './db/queries/accounts.js';
import { lastPostAt } from './db/queries/media.js';
import { anomalies } from './analytics/anomaly.js';
import { budgetPacing } from './analytics/budget.js';
import { fmtDate } from './analytics/util.js';
import { isDemoProfile } from './sync/orchestrator.js';
import { progressBus } from './sync/progress.js';
import { currentLang } from './i18n.js';
import { pickNotifications, pruneSent, markSent, NOTIFY_TYPES, DAY_MS } from './notifyRules.js';

/** Desktop notifications: gathers data, applies notifyRules.js, shows them and persists the sent log (`notify.sent`). */
const SENT_KEY = 'notify.sent';
const FIRST_RUN_MS = 30_000;
const TICK_MS = 3_600_000;
const AFTER_SYNC_MS = 2_000;
const NAVIGATE_DELAY_MS = 600;

let timers = [];
let lastRunAt = 0;
let getWindow = () => null;
const live = new Set(); // keeps Notification objects alive so click handlers survive GC

function readPrefs() {
  return { enabled: getConfig('notify.enabled') !== false, ...Object.fromEntries(NOTIFY_TYPES.map((t) => [t, getConfig(`notify.${t}`) !== false])) };
}

function isDemo() {
  return !!getSetting('demoMode', false) || isDemoProfile(getActiveProfile());
}

/** Collects only the data needed by the enabled notification types. */
function gatherData(prefs, now) {
  const today = fmtDate(new Date(now));
  const accounts = prefs.anomalies || prefs.silent ? listAccounts() : [];
  return {
    anomalies: prefs.anomalies && accounts.length ? anomalies({ from: fmtDate(subDays(new Date(now), 2)), to: today }) : [],
    budgets: prefs.budget ? budgetPacing() : [],
    silent: prefs.silent ? accounts.map((a) => { const p = lastPostAt(a.igId); return { igId: a.igId, username: a.username, daysSincePost: p ? Math.floor((now - p) / DAY_MS) : null }; }) : [],
    token: prefs.token ? { expiresAt: getActiveProfile()?.token_expires_at ?? null } : null,
  };
}

function navigateTo(route) {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  const send = () => progressBus.emit('app:navigate', { route });
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, NAVIGATE_DELAY_MS));
  else send();
}

function show(note) {
  const n = new Notification({ title: note.title, body: note.body });
  live.add(n);
  const release = () => live.delete(n);
  n.on('click', () => { release(); navigateTo(note.route); });
  n.on('close', release);
  n.show();
}

/** Evaluates and shows due notifications. Never throws; returns what was shown. */
export function runNotifications() {
  try {
    lastRunAt = Date.now();
    if (!Notification.isSupported() || isDemo()) return [];
    const prefs = readPrefs();
    if (!prefs.enabled) return [];
    const now = Date.now();
    const sent = pruneSent(getSetting(SENT_KEY, {}), now);
    const notes = pickNotifications({ now, lang: currentLang(), data: gatherData(prefs, now), sent, prefs });
    for (const note of notes) show(note);
    setSetting(SENT_KEY, markSent(sent, notes, now));
    return notes;
  } catch (e) {
    console.error('[notify] failed:', e);
    return [];
  }
}

function onSyncDone(payload) {
  if (payload?.status === 'failed') return;
  const id = setTimeout(() => { timers = timers.filter((t) => t !== id); runNotifications(); }, AFTER_SYNC_MS);
  timers = [...timers, id];
}

/** Runs ~30 s after start, after every completed sync and at least once a day. `win` returns (or recreates) the main window. */
export function startNotifications({ win } = {}) {
  stopNotifications();
  if (win) getWindow = win;
  progressBus.on('sync:done', onSyncDone);
  const daily = () => { if (Date.now() - lastRunAt >= DAY_MS) runNotifications(); };
  timers = [setTimeout(runNotifications, FIRST_RUN_MS), setInterval(daily, TICK_MS)];
}

export function stopNotifications() {
  progressBus.off('sync:done', onSyncDone);
  for (const t of timers) clearTimeout(t);
  timers = [];
}
