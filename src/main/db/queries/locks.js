import os from 'node:os';
import { q } from '../index.js';

/**
 * Cross-process leases in the `locks` table (migration 011). The GUI and the CLI (`--cli`) may share data.db; a lease
 * makes sure only one of them runs e.g. a sync at a time. A lease expires on its own (crash safety) unless renewed.
 *
 * acquireLease(name, owner, { ttlMs }) → true when this owner now holds it (free, expired, or already ours).
 * renewLease(name, owner, { ttlMs }) → false when the lease was lost (expired and taken by someone else).
 * releaseLease(name, owner) → only the holder can release.
 * leaseHolder(name) → { owner, pid, host, acquiredAt, expiresAt } | null (expired leases read as null).
 */
export const DEFAULT_LEASE_TTL_MS = 10 * 60_000;

/** Owner id for this process: `<kind>:<pid>:<random>` ('gui' | 'cli' | 'test'). */
export function makeOwner(kind = 'gui') {
  return `${kind}:${process.pid}:${os.hostname()}:${Math.random().toString(36).slice(2, 10)}`;
}

/** True when the lease row belongs to a process on this machine that no longer exists (crash recovery). */
function holderIsDead(row) {
  const [, pid, host] = String(row.owner ?? '').split(':');
  const n = Number(pid);
  if (!n || host !== os.hostname() || n === process.pid) return false;
  try { process.kill(n, 0); return false; } catch (e) { return e?.code === 'ESRCH'; }
}

export function acquireLease(name, owner, { ttlMs = DEFAULT_LEASE_TTL_MS, now = Date.now() } = {}) {
  return q.tx(() => {
    const row = q.get('SELECT owner, expires_at FROM locks WHERE name = ?', name);
    if (row && row.owner !== owner && row.expires_at > now && !holderIsDead(row)) return false;
    q.run(
      `INSERT INTO locks (name, owner, pid, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, pid = excluded.pid, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at`,
      name, owner, process.pid, now, now + ttlMs,
    );
    return true;
  }).immediate();
}

export function renewLease(name, owner, { ttlMs = DEFAULT_LEASE_TTL_MS, now = Date.now() } = {}) {
  return q.run('UPDATE locks SET expires_at = ? WHERE name = ? AND owner = ?', now + ttlMs, name, owner).changes === 1;
}

export function releaseLease(name, owner) {
  return q.run('DELETE FROM locks WHERE name = ? AND owner = ?', name, owner).changes === 1;
}

export function leaseHolder(name, { now = Date.now() } = {}) {
  const row = q.get('SELECT * FROM locks WHERE name = ?', name);
  if (!row || row.expires_at <= now) return null;
  const [kind, pid, host] = String(row.owner).split(':');
  return { owner: row.owner, kind, pid: Number(pid) || row.pid, host: host ?? null, acquiredAt: row.acquired_at, expiresAt: row.expires_at };
}

/**
 * Holds a lease while `fn` runs, renewing it every `heartbeatMs`. Throws Error('LEASE_BUSY') (with .holder) when
 * someone else holds it. The lease is released when fn settles.
 */
export async function withLease(name, owner, fn, { ttlMs = DEFAULT_LEASE_TTL_MS, heartbeatMs = 60_000 } = {}) {
  if (!acquireLease(name, owner, { ttlMs })) throw Object.assign(new Error('LEASE_BUSY'), { code: 'LEASE_BUSY', holder: leaseHolder(name) });
  const timer = setInterval(() => { try { renewLease(name, owner, { ttlMs }); } catch { /* db closed */ } }, heartbeatMs);
  timer.unref?.();
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    try { releaseLease(name, owner); } catch { /* db closed */ }
  }
}
