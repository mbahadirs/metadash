import crypto from 'node:crypto';
import { getSetting, setSetting, deleteSetting } from '../db/queries/settings.js';
import { progressBus } from '../sync/progress.js';
import { teamError } from './errors.js';
import { applySessionScope, normalizeClientNames, knownClientNames } from './scope.js';

/**
 * Session = { role: 'admin' | 'analyst' | 'client', clientScope: string[] | null, readOnly: boolean, workspace: 'local' | teamId }.
 * - The own install defaults to admin, a subscriber (read-only shared workspace) to analyst and can never be admin.
 * - The client view ("Present to client") is entered with client names and a PIN; exiting needs the PIN.
 * Everything lives in machine-local settings (session.*, team.config), so a snapshot swap never changes it.
 * Roles are UI and workflow guardrails on an untrusted machine, not a security boundary (docs/team.md).
 */
export const DEFAULT_SESSION = Object.freeze({ role: 'admin', clientScope: null, readOnly: false, workspace: 'local' });
export const SESSION_KEYS = Object.freeze({ role: 'session.role', scope: 'session.clientScope', pin: 'session.clientPinHash' });
export const BASE_ROLES = Object.freeze(['admin', 'analyst']);
const PIN_RE = /^\d{4,8}$/;
const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MS = 30_000;
/** In-memory PIN failure counter (lockout after MAX_PIN_FAILURES wrong PINs). */
let failures = { count: 0, until: 0 };

const fail = (code) => teamError(code);

export function getSession() {
  try {
    const cfg = getSetting('team.config', null);
    const readOnly = cfg?.mode === 'subscriber';
    const workspace = readOnly && cfg.teamId ? String(cfg.teamId) : 'local';
    let base = getSetting(SESSION_KEYS.role, null);
    if (!BASE_ROLES.includes(base)) base = readOnly ? 'analyst' : 'admin';
    if (readOnly && base === 'admin') base = 'analyst';
    const scope = normalizeClientNames(getSetting(SESSION_KEYS.scope, null));
    const client = scope.length > 0;
    return Object.freeze({ role: client ? 'client' : base, clientScope: client ? Object.freeze(scope) : null, readOnly, workspace });
  } catch {
    return DEFAULT_SESSION; // database not open yet
  }
}

/** Re-applies the account scope and tells the renderer. Returns the session. */
export function sessionChanged() {
  const s = getSession();
  applySessionScope(s);
  progressBus.emit('session:changed', s);
  return s;
}

export function setRole(role) {
  const s = getSession();
  if (s.role === 'client') throw fail('TEAM_FORBIDDEN');
  if (!BASE_ROLES.includes(role)) throw fail('TEAM_BAD_ROLE');
  if (s.readOnly && role === 'admin') throw fail('TEAM_SUBSCRIBER_NOT_ADMIN');
  setSetting(SESSION_KEYS.role, role);
  return sessionChanged();
}

export function hashPin(pin, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(String(pin), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPin(pin, stored) {
  const [kind, saltB64, hashB64] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !saltB64 || !hashB64) return false;
  const a = Buffer.from(hashPin(pin, Buffer.from(saltB64, 'base64')).split('$')[2], 'base64');
  const b = Buffer.from(hashB64, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function enterClientView({ clientNames, pin } = {}) {
  const s = getSession();
  if (s.role === 'client') throw fail('TEAM_ALREADY_CLIENT');
  const names = normalizeClientNames(clientNames);
  if (!names.length) throw fail('TEAM_CLIENTS_REQUIRED');
  const known = new Set(knownClientNames());
  if (names.some((n) => !known.has(n))) throw fail('TEAM_UNKNOWN_CLIENT');
  if (!PIN_RE.test(String(pin ?? ''))) throw fail('TEAM_PIN_FORMAT');
  setSetting(SESSION_KEYS.pin, hashPin(pin));
  setSetting(SESSION_KEYS.scope, names);
  failures = { count: 0, until: 0 };
  return sessionChanged();
}

export function exitClientView({ pin } = {}, now = Date.now()) {
  const s = getSession();
  if (s.role !== 'client') return s;
  if (failures.until > now) throw fail('TEAM_PIN_LOCKED');
  if (!verifyPin(pin, getSetting(SESSION_KEYS.pin, null))) {
    const count = failures.count + 1;
    failures = count >= MAX_PIN_FAILURES ? { count: 0, until: now + PIN_LOCK_MS } : { count, until: 0 };
    throw fail('TEAM_PIN_WRONG');
  }
  failures = { count: 0, until: 0 };
  deleteSetting(SESSION_KEYS.scope);
  deleteSetting(SESSION_KEYS.pin);
  return sessionChanged();
}

/** Resets the session to the defaults of the current mode (team leave). */
export function resetSession() {
  for (const k of Object.values(SESSION_KEYS)) deleteSetting(k);
  return sessionChanged();
}
