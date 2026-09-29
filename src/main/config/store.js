import crypto from 'node:crypto';
import { getSetting, setSetting, getAllSettings } from '../db/queries/settings.js';
import { machineId } from './machine.js';

/**
 * Secrets (Meta token, app secret) are encrypted at rest with AES-256-GCM.
 * The key is derived from the machine identifier, so the database is useless on another computer.
 * (Electron's safeStorage was deliberately avoided: on macOS it needs the Keychain and prompts for the
 * login password whenever an unsigned/re-signed build touches the entry.)
 */
const ENC_PREFIX = 'gcm:';
const LEGACY_PLAIN = 'plain:';
const KEY_SALT = 'metadash-store-v1';

export const DEFAULTS = {
  theme: 'dark',
  lang: 'en',
  autoSyncDaily: false,
  storyIntervalHours: 4,
  refreshTiers: { fresh: 48, recent: 24, month: 168, old: 720 },
  mediaLookbackDays: 365,
  disabledMetrics: [],
  setupStep: 0,
  lastPeriod: 28,
  autoUpdateCheck: true,
  'notify.enabled': true,
  'notify.anomalies': true,
  'notify.budget': true,
  'notify.silent': true,
  'notify.token': true,
  // White-label report branding (the logo data URL lives in 'reportBranding.logo', outside DEFAULTS, to keep settings:all small).
  reportBranding: { agencyName: '', accent: '#4F7CFF', footerText: '', hideCredit: false },
  // Optional bring-your-own-key AI assistant (off by default; keys live encrypted under 'token:ai:<provider>').
  'ai.enabled': false,
  'ai.provider': 'anthropic',
  'ai.model': null,
  'ai.ollamaUrl': 'http://127.0.0.1:11434',
  // v1.4 background mode (chunk C applies them) and planner/publishing. S3 keys live encrypted under 'token:planner:s3'.
  'app.trayMode': false,
  'app.launchAtLogin': false,
  'app.startHidden': true,
  'app.keepAwakeForPosts': false,
  'planner.paused': false,
  'planner.missedPolicy': 'ask', // ask | publish | skip
  'planner.missedGraceMin': 15,
  'planner.maxLateMin': 180,
  'planner.requireApproval': false,
  'planner.minGapHours': 3,
  'planner.weekStartsOn': 1,
  'planner.mediaHost': { type: 'none' }, // none | s3 | fbpage | url
  'planner.s3': { endpoint: '', region: 'auto', bucket: '', prefix: 'metadash/', pathStyle: false, publicBaseUrl: '', urlTtlSec: 86400, deleteAfterPublish: true },
  'notify.publishSuccess': true,
  'notify.publishFailure': true,
};

export function getConfig(key) {
  return getSetting(key, DEFAULTS[key] ?? null);
}

export function setConfig(key, value) {
  setSetting(key, value);
}

export function getAllConfig() {
  const all = getAllSettings();
  const ui = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('ui.')));
  return { ...ui, ...Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, getConfig(k)])) };
}

let keyCache = null;
function key() {
  if (!keyCache) keyCache = crypto.createHash('sha256').update(KEY_SALT + '|' + machineId()).digest();
  return keyCache;
}

export function encryptString(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptString(stored) {
  if (!stored) return null;
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
      decipher.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      return null; // different machine or corrupted → treat as missing
    }
  }
  if (stored.startsWith(LEGACY_PLAIN)) return Buffer.from(stored.slice(LEGACY_PLAIN.length), 'base64').toString('utf8');
  if (stored.startsWith('enc:')) return null; // old safeStorage entries are no longer readable
  return stored;
}

/** Stores a secret and returns the settings key that references it. */
export function storeToken(profileKey, token) {
  const ref = `token:${profileKey}`;
  setSetting(ref, token ? encryptString(token) : '');
  return ref;
}

export function readToken(ref) {
  const raw = getSetting(ref);
  if (!raw) return null;
  return decryptString(raw);
}

export function storeAppSecret(appId, secret) {
  return storeToken(`secret:${appId}`, secret);
}

export function readAppSecret(appId) {
  return readToken(`token:secret:${appId}`);
}
