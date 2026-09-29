import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions, isNewer, updateMode, statusFromRelease, reduceUpdateStatus, safeReleaseUrl, RELEASES_PAGE } from '../src/main/updateCheck.js';

describe('parseVersion', () => {
  it('parses plain, v-prefixed, partial and prerelease versions', () => {
    expect(parseVersion('1.2.3')).toEqual({ nums: [1, 2, 3], pre: [] });
    expect(parseVersion('v1.2.3')).toEqual({ nums: [1, 2, 3], pre: [] });
    expect(parseVersion('V2.0')).toEqual({ nums: [2, 0, 0], pre: [] });
    expect(parseVersion('1.0.0-beta.2+build.5')).toEqual({ nums: [1, 0, 0], pre: ['beta', '2'] });
  });
  it('returns null for garbage', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion('latest')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders major/minor/patch numerically', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
  });
  it('ranks a release above its prereleases', () => {
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.1.0-beta', '1.0.0')).toBe(1);
  });
  it('compares prerelease identifiers per semver', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
  });
  it('treats unparseable input as equal (never "newer")', () => {
    expect(compareVersions('nope', '1.0.0')).toBe(0);
    expect(isNewer('nope', '1.0.0')).toBe(false);
    expect(isNewer('1.0.1', '1.0.0')).toBe(true);
  });
});

describe('updateMode', () => {
  it('is off in development builds', () => {
    expect(updateMode({ platform: 'win32', env: {}, isPackaged: false })).toBe('off');
  });
  it('auto-updates on Windows and Linux AppImage', () => {
    expect(updateMode({ platform: 'win32', env: {}, isPackaged: true })).toBe('auto');
    expect(updateMode({ platform: 'linux', env: { APPIMAGE: '/x/MetaDash.AppImage' }, isPackaged: true })).toBe('auto');
  });
  it('only notifies on macOS and Linux .deb', () => {
    expect(updateMode({ platform: 'darwin', env: {}, isPackaged: true })).toBe('manual');
    expect(updateMode({ platform: 'linux', env: {}, isPackaged: true })).toBe('manual');
  });
});

describe('statusFromRelease', () => {
  const release = { tag_name: 'v1.2.0', html_url: 'https://github.com/mbahadirs/metadash/releases/tag/v1.2.0' };
  it('reports a newer release as a manual update', () => {
    expect(statusFromRelease(release, '1.0.0')).toEqual({ state: 'available', version: '1.2.0', url: release.html_url, manual: true });
  });
  it('reports not-available for the same or an older release', () => {
    expect(statusFromRelease(release, '1.2.0').state).toBe('not-available');
    expect(statusFromRelease(release, '1.3.0-beta.1').state).toBe('not-available');
  });
  it('rejects bad payloads and foreign URLs', () => {
    expect(statusFromRelease({}, '1.0.0').state).toBe('error');
    expect(statusFromRelease({ tag_name: 'v9.0.0', html_url: 'https://evil.example/x' }, '1.0.0').url).toBe(RELEASES_PAGE);
    expect(safeReleaseUrl('javascript:alert(1)')).toBe(RELEASES_PAGE);
  });
});

describe('reduceUpdateStatus', () => {
  it('maps electron-updater events to statuses', () => {
    expect(reduceUpdateStatus({ state: 'idle' }, 'checking-for-update')).toEqual({ state: 'checking' });
    const avail = reduceUpdateStatus({ state: 'checking' }, 'update-available', { version: '1.1.0' });
    expect(avail).toMatchObject({ state: 'available', version: '1.1.0', manual: false });
    expect(avail.url).toContain('v1.1.0');
    expect(reduceUpdateStatus(avail, 'update-not-available', { version: '1.0.0' }).state).toBe('not-available');
  });
  it('keeps the version while downloading and rounds percent', () => {
    const prev = { state: 'available', version: '1.1.0', url: 'u', manual: false };
    const d = reduceUpdateStatus(prev, 'download-progress', { percent: 41.7 });
    expect(d).toEqual({ state: 'downloading', version: '1.1.0', url: 'u', manual: false, percent: 42 });
    expect(reduceUpdateStatus(d, 'update-downloaded', { version: '1.1.0' })).toMatchObject({ state: 'downloaded', version: '1.1.0' });
  });
  it('maps errors and does not mutate the previous state', () => {
    const prev = Object.freeze({ state: 'checking' });
    expect(reduceUpdateStatus(prev, 'error', new Error('offline'))).toEqual({ state: 'error', error: 'offline' });
    expect(reduceUpdateStatus(prev, 'unknown-event')).toBe(prev);
  });
});
