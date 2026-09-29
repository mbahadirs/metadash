/**
 * Pure background-mode rules (v1.4 chunk C): quit/close policy, login-item arguments, the Linux XDG autostart file,
 * hidden-start detection and tray/quit summaries of scheduled targets. No Electron imports; lifecycle.js and tray.js
 * feed these with app/process state.
 */
import { translate, intlLocale } from './locales/catalog.js';

export const HIDDEN_ARG = '--hidden';
/** macOS 13+ no longer reports wasOpenedAtLogin; an app started this soon after boot with launch-at-login on counts as a login start. */
export const BOOT_GRACE_SEC = 300;
export const QUIT_CONFIRM_WINDOW_MS = 2 * 3_600_000;
/** Target states that still need MetaDash to be running (or, for handed_off, that Facebook publishes). */
export const SCHEDULED_TARGET_STATES = Object.freeze(['queued', 'hosting', 'container', 'ready', 'handed_off', 'publishing', 'commenting', 'paused']);
const PENDING_STATES = new Set(SCHEDULED_TARGET_STATES);
const APP_PENDING_STATES = new Set(['queued', 'hosting', 'container', 'ready', 'publishing', 'commenting']);
const PLATFORM_SHORT = { instagram: 'IG', facebook: 'FB', threads: 'Threads' };
const BACKGROUND_KEYS = ['trayMode', 'launchAtLogin', 'startHidden', 'keepAwakeForPosts'];

/** window-all-closed: quit? Smoke runs and explicit quits (update install, tray Quit) always quit. */
export function shouldQuitOnAllClosed({ platform, trayMode = false, smoke = false, quitting = false }) {
  if (smoke || quitting) return true;
  if (trayMode) return false;
  return platform !== 'darwin';
}

/** macOS: hide the dock icon while the app lives only in the menu bar. */
export function shouldHideDock({ platform, trayMode, windowCount }) {
  return platform === 'darwin' && !!trayMode && windowCount === 0;
}

/** Hidden start needs tray mode, otherwise there would be no visible way back into the app. */
const hiddenStartApplies = ({ trayMode, startHidden: pref }) => !!trayMode && pref !== false;

/**
 * Settings for app.setLoginItemSettings (macOS/Windows). `args` is used on Windows, `openAsHidden` on macOS < 13.
 * @returns {{ openAtLogin: boolean, openAsHidden: boolean, args: string[], path?: string }}
 */
export function loginItemArgs({ openAtLogin, startHidden: pref = true, trayMode = false, path }) {
  const hidden = !!openAtLogin && hiddenStartApplies({ trayMode, startHidden: pref });
  return { openAtLogin: !!openAtLogin, openAsHidden: hidden, args: hidden ? [HIDDEN_ARG] : [], ...(path ? { path } : {}) };
}

/** Quotes one Exec argument (Desktop Entry spec: escape " ` $ \ inside double quotes; % becomes %%). */
export function desktopExecQuote(arg) {
  const clean = String(arg).replace(/[\r\n]+/g, ' ');
  return `"${clean.replace(/(["`$\\])/g, '\\$1').replace(/%/g, '%%')}"`;
}

/** ~/.config/autostart/metadash.desktop content. AppImage builds must point at $APPIMAGE (execPath is a temp mount). */
export function linuxAutostartDesktop({ execPath, appImage, hidden = false, name = 'MetaDash' }) {
  const exec = [desktopExecQuote(appImage || execPath), ...(hidden ? [HIDDEN_ARG] : [])].join(' ');
  const safeName = String(name).replace(/[\r\n]+/g, ' ');
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${safeName}`,
    `Exec=${exec}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    'Comment=Publishes scheduled posts in the background',
    '',
  ].join('\n');
}

/**
 * Should this launch create no window? Windows/Linux: the `--hidden` argument from the login item. macOS: the login
 * item flags where available, else "launch at login is on and the system booted less than BOOT_GRACE_SEC ago" (VERIFY
 * on macOS 13+, where wasOpenedAtLogin/openAsHidden are no longer reported).
 */
export function startHidden({ argv = [], platform, trayMode, startHiddenPref, launchAtLogin, loginSettings = {}, systemUptimeSec }) {
  if (!hiddenStartApplies({ trayMode, startHidden: startHiddenPref })) return false;
  if (argv.includes(HIDDEN_ARG)) return true;
  if (platform !== 'darwin' || !launchAtLogin) return false;
  if (loginSettings.wasOpenedAtLogin || loginSettings.wasOpenedAsHidden) return true;
  return Number.isFinite(systemUptimeSec) && systemUptimeSec < BOOT_GRACE_SEC;
}

const pendingTime = (i) => i.scheduledAt ?? i.nextAttemptAt ?? null;

/** App-mode targets that would publish within `windowMs` (FB native hand-offs publish without MetaDash). */
export function dueSoon(items, now, windowMs = QUIT_CONFIRM_WINDOW_MS) {
  return (items ?? []).filter((i) => i.mode !== 'native' && APP_PENDING_STATES.has(i.state)
    && pendingTime(i) != null && pendingTime(i) <= now + windowMs);
}

/** Number of due posts to warn about when quitting; 0 = quit without asking (update install, OS shutdown). */
export function quitNeedsConfirm({ items, now, reason = null, windowMs = QUIT_CONFIRM_WINDOW_MS }) {
  if (reason === 'update' || reason === 'shutdown') return 0;
  return new Set(dueSoon(items, now, windowMs).map((i) => i.postId ?? i.postRef)).size;
}

const upcoming = (items, now) => (items ?? [])
  .filter((i) => PENDING_STATES.has(i.state) && i.scheduledAt != null && i.scheduledAt >= now - 60_000)
  .sort((a, b) => a.scheduledAt - b.scheduledAt);

/** "Next: Tue 14:00 · @brand (IG)" / "Nothing scheduled". */
export function nextPostLine(items, now, lang = 'en') {
  const next = upcoming(items, now)[0];
  if (!next) return translate('lc_none', null, lang);
  const d = new Date(next.scheduledAt);
  const locale = intlLocale(lang);
  const day = d.toLocaleDateString(locale, { weekday: 'short' });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  const who = next.username ? `@${next.username}` : next.postRef ?? '';
  return `${translate('lc_next', null, lang)}: ${day} ${time} · ${who} (${PLATFORM_SHORT[next.platform] ?? next.platform})`;
}

/** Distinct posts still to publish between now and local midnight. */
export function todayCount(items, now) {
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  return new Set(upcoming(items, now).filter((i) => i.scheduledAt < end.getTime()).map((i) => i.postId ?? i.postRef)).size;
}

/** What BackgroundSettings.supported reports. Linux login items use an XDG autostart file. */
export function supportedFeatures(platform) {
  return { loginItem: ['darwin', 'win32', 'linux'].includes(platform), tray: true };
}

/** Keeps only the known boolean background keys of an IPC patch. */
export function sanitizeBackgroundPatch(patch) {
  if (!patch || typeof patch !== 'object') return {};
  return Object.fromEntries(BACKGROUND_KEYS.filter((k) => typeof patch[k] === 'boolean').map((k) => [k, patch[k]]));
}
