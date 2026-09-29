import { describe, it, expect } from 'vitest';
import {
  shouldQuitOnAllClosed, shouldHideDock, loginItemArgs, linuxAutostartDesktop, desktopExecQuote, startHidden,
  dueSoon, quitNeedsConfirm, nextPostLine, todayCount, supportedFeatures, sanitizeBackgroundPatch, HIDDEN_ARG,
} from '../src/main/lifecycleRules.js';

const NOW = new Date(2026, 8, 29, 12, 0, 0).getTime(); // Tue 29 Sep 2026, local noon
const MIN = 60_000;

describe('shouldQuitOnAllClosed', () => {
  it('always quits in smoke mode or while an update/explicit quit is in progress', () => {
    expect(shouldQuitOnAllClosed({ platform: 'darwin', trayMode: true, smoke: true })).toBe(true);
    expect(shouldQuitOnAllClosed({ platform: 'win32', trayMode: true, quitting: true })).toBe(true);
  });
  it('keeps running in tray mode on every platform', () => {
    for (const platform of ['darwin', 'win32', 'linux']) expect(shouldQuitOnAllClosed({ platform, trayMode: true })).toBe(false);
  });
  it('without tray mode: macOS stays in the dock, Windows/Linux quit', () => {
    expect(shouldQuitOnAllClosed({ platform: 'darwin', trayMode: false })).toBe(false);
    expect(shouldQuitOnAllClosed({ platform: 'win32', trayMode: false })).toBe(true);
    expect(shouldQuitOnAllClosed({ platform: 'linux' })).toBe(true);
  });
});

describe('shouldHideDock', () => {
  it('hides the macOS dock icon only in tray mode with no window', () => {
    expect(shouldHideDock({ platform: 'darwin', trayMode: true, windowCount: 0 })).toBe(true);
    expect(shouldHideDock({ platform: 'darwin', trayMode: true, windowCount: 1 })).toBe(false);
    expect(shouldHideDock({ platform: 'darwin', trayMode: false, windowCount: 0 })).toBe(false);
    expect(shouldHideDock({ platform: 'win32', trayMode: true, windowCount: 0 })).toBe(false);
  });
});

describe('loginItemArgs', () => {
  it('adds --hidden only when hidden start applies (tray mode + start hidden)', () => {
    expect(loginItemArgs({ openAtLogin: true, startHidden: true, trayMode: true })).toEqual({ openAtLogin: true, openAsHidden: true, args: [HIDDEN_ARG] });
    expect(loginItemArgs({ openAtLogin: true, startHidden: true, trayMode: false })).toEqual({ openAtLogin: true, openAsHidden: false, args: [] });
    expect(loginItemArgs({ openAtLogin: false, startHidden: true, trayMode: true })).toEqual({ openAtLogin: false, openAsHidden: false, args: [] });
  });
  it('passes the Windows executable path when given', () => {
    expect(loginItemArgs({ openAtLogin: true, startHidden: false, trayMode: true, path: 'C:\\MetaDash\\MetaDash.exe' }).path).toBe('C:\\MetaDash\\MetaDash.exe');
  });
});

describe('linuxAutostartDesktop', () => {
  it('builds an XDG autostart entry that prefers the AppImage path', () => {
    const txt = linuxAutostartDesktop({ execPath: '/opt/MetaDash/metadash', appImage: '/home/u/Apps/MetaDash 1.4.AppImage', hidden: true });
    expect(txt).toContain('[Desktop Entry]\n');
    expect(txt).toContain('Type=Application\n');
    expect(txt).toContain('Exec="/home/u/Apps/MetaDash 1.4.AppImage" --hidden\n');
    expect(txt).toContain('X-GNOME-Autostart-enabled=true\n');
    expect(txt.endsWith('\n')).toBe(true);
  });
  it('falls back to execPath and omits --hidden', () => {
    const txt = linuxAutostartDesktop({ execPath: '/usr/lib/metadash/metadash' });
    expect(txt).toContain('Exec="/usr/lib/metadash/metadash"\n');
  });
  it('escapes reserved characters in Exec per the Desktop Entry spec', () => {
    expect(desktopExecQuote('/a/b$c"d`e\\f 100%')).toBe('"/a/b\\$c\\"d\\`e\\\\f 100%%"');
  });
  it('strips newlines so the file cannot gain extra keys', () => {
    const txt = linuxAutostartDesktop({ execPath: '/x\nExec=evil' });
    expect(txt.split('\n').filter((l) => l.startsWith('Exec=')).length).toBe(1);
  });
});

describe('startHidden', () => {
  const base = { trayMode: true, startHiddenPref: true, launchAtLogin: true };
  it('never starts hidden without tray mode (no way back to the window)', () => {
    expect(startHidden({ ...base, trayMode: false, argv: ['x', '--hidden'], platform: 'win32' })).toBe(false);
  });
  it('honours --hidden on Windows/Linux', () => {
    expect(startHidden({ ...base, argv: ['x', '--hidden'], platform: 'win32' })).toBe(true);
    expect(startHidden({ ...base, argv: ['x'], platform: 'linux' })).toBe(false);
  });
  it('respects the start-hidden preference', () => {
    expect(startHidden({ ...base, startHiddenPref: false, argv: ['x', '--hidden'], platform: 'linux' })).toBe(false);
  });
  it('macOS: login-item flags, or a fresh boot heuristic when launch at login is on', () => {
    expect(startHidden({ ...base, argv: [], platform: 'darwin', loginSettings: { wasOpenedAtLogin: true } })).toBe(true);
    expect(startHidden({ ...base, argv: [], platform: 'darwin', loginSettings: {}, systemUptimeSec: 90 })).toBe(true);
    expect(startHidden({ ...base, argv: [], platform: 'darwin', loginSettings: {}, systemUptimeSec: 9000 })).toBe(false);
    expect(startHidden({ ...base, launchAtLogin: false, argv: [], platform: 'darwin', loginSettings: {}, systemUptimeSec: 90 })).toBe(false);
  });
});

describe('due items and quit confirmation', () => {
  const items = [
    { accountId: 'a', platform: 'instagram', mode: 'app', state: 'queued', scheduledAt: NOW + 30 * MIN, postRef: 'P-0001', username: 'brand' },
    { accountId: 'b', platform: 'facebook', mode: 'native', state: 'handed_off', scheduledAt: NOW + 20 * MIN, postRef: 'P-0002', username: 'page' },
    { accountId: 'c', platform: 'threads', mode: 'app', state: 'ready', scheduledAt: NOW + 3 * 60 * MIN, postRef: 'P-0003', username: 'th' },
    { accountId: 'd', platform: 'instagram', mode: 'app', state: 'published', scheduledAt: NOW + 10 * MIN, postRef: 'P-0004' },
  ];
  it('counts only app-mode pending targets within the window (FB native publishes without us)', () => {
    expect(dueSoon(items, NOW, 120 * MIN).map((i) => i.postRef)).toEqual(['P-0001']);
    expect(dueSoon(items, NOW, 240 * MIN).map((i) => i.postRef)).toEqual(['P-0001', 'P-0003']);
  });
  it('asks before quitting unless an update install is quitting', () => {
    expect(quitNeedsConfirm({ items, now: NOW, reason: null })).toBe(1);
    expect(quitNeedsConfirm({ items, now: NOW, reason: 'update' })).toBe(0);
    expect(quitNeedsConfirm({ items, now: NOW, reason: 'shutdown' })).toBe(0);
    expect(quitNeedsConfirm({ items: [], now: NOW })).toBe(0);
  });
  it('formats the tray status line', () => {
    const line = nextPostLine(items, NOW, 'en');
    expect(line).toMatch(/^Next: Tue \d{2}:\d{2} · @page \(FB\)$/);
    expect(nextPostLine([], NOW, 'en')).toBe('Nothing scheduled');
    expect(nextPostLine([], NOW, 'tr')).toBe('Planlanmış gönderi yok');
  });
  it('counts distinct posts scheduled for the rest of today', () => {
    expect(todayCount([...items, { ...items[0], accountId: 'z' }], NOW)).toBe(3);
  });
});

describe('supportedFeatures and sanitizeBackgroundPatch', () => {
  it('reports login-item support per platform', () => {
    expect(supportedFeatures('darwin')).toEqual({ loginItem: true, tray: true });
    expect(supportedFeatures('linux')).toEqual({ loginItem: true, tray: true });
    expect(supportedFeatures('freebsd')).toEqual({ loginItem: false, tray: true });
  });
  it('keeps only known boolean keys', () => {
    expect(sanitizeBackgroundPatch({ trayMode: true, launchAtLogin: 'yes', evil: true, keepAwakeForPosts: false })).toEqual({ trayMode: true, keepAwakeForPosts: false });
    expect(sanitizeBackgroundPatch(null)).toEqual({});
  });
});
