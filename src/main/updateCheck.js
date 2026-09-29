/** Pure update-check helpers (no Electron imports, unit-tested). */
export const REPO = 'mbahadirs/metadash';
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const RELEASE_URL_PREFIX = `https://github.com/${REPO}/releases`;

const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]*)?$/i;

/** '1.2.3-beta.1' / 'v1.2' → { nums: [1, 2, 3], pre: ['beta', '1'] }; null when unparseable. */
export function parseVersion(v) {
  const m = VERSION_RE.exec(String(v ?? '').trim());
  if (!m) return null;
  return { nums: [m[1], m[2] ?? 0, m[3] ?? 0].map(Number), pre: m[4] ? m[4].split('.') : [] };
}

function comparePre(a, b) {
  if (!a.length || !b.length) return a.length === b.length ? 0 : a.length ? -1 : 1; // release > prerelease
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const an = /^\d+$/.test(a[i]);
    const bn = /^\d+$/.test(b[i]);
    if (an && bn) { if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]) ? 1 : -1; continue; }
    if (an !== bn) return an ? -1 : 1; // numeric identifiers sort before alphanumeric ones
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

/** Semver-ish compare → -1 | 0 | 1. Unparseable input compares as equal, so it is never "newer". */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
  return comparePre(x.pre, y.pre);
}

export const isNewer = (latest, current) => compareVersions(latest, current) > 0;

/** 'auto' = electron-updater (Windows NSIS, Linux AppImage); 'manual' = notify + release page (unsigned macOS, .deb); 'off' in dev. */
export function updateMode({ platform, env = {}, isPackaged }) {
  if (!isPackaged) return 'off';
  if (platform === 'win32') return 'auto';
  if (platform === 'linux' && env.APPIMAGE) return 'auto';
  return 'manual';
}

/** Only ever open this repository's GitHub release pages. */
export function safeReleaseUrl(url) {
  return typeof url === 'string' && url.startsWith(RELEASE_URL_PREFIX) ? url : RELEASES_PAGE;
}

export const releaseTagUrl = (version) => `${RELEASE_URL_PREFIX}/tag/v${version}`;

/** GitHub "latest release" JSON → update status for the manual channel. */
export function statusFromRelease(release, currentVersion) {
  const tag = release?.tag_name;
  if (!parseVersion(tag)) return { state: 'error', error: 'invalid release data' };
  const version = String(tag).trim().replace(/^v/i, '');
  if (!isNewer(version, currentVersion)) return { state: 'not-available', version };
  return { state: 'available', version, url: safeReleaseUrl(release.html_url), manual: true };
}

/** Folds an electron-updater event into the previous status (returns a new object, or prev for unknown events). */
export function reduceUpdateStatus(prev, event, payload) {
  switch (event) {
    case 'checking-for-update': return { state: 'checking' };
    case 'update-available': return { state: 'available', version: payload?.version, url: releaseTagUrl(payload?.version), manual: false };
    case 'update-not-available': return { state: 'not-available', version: payload?.version };
    case 'download-progress': return { ...prev, state: 'downloading', percent: Math.round(Number(payload?.percent ?? 0)) };
    case 'update-downloaded': return { ...prev, state: 'downloaded', version: payload?.version ?? prev.version, percent: undefined };
    case 'error': return { state: 'error', error: payload?.message ?? String(payload ?? 'error') };
    default: return prev;
  }
}
