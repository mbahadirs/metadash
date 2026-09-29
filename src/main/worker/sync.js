/**
 * Desktop ↔ self-hosted worker sync — STUB (v2.0 chunk B). Chunk E owns src/main/worker/** (client.js, sync.js,
 * tokens.js, pairing.js). Not to be confused with the v1.4 local publishing queue in src/main/publishing/worker.js.
 *
 *   syncNow({ reason }) → { pushed, pulled, errors }   push dirty planner_targets (executor 'worker', revision > worker_revision), pull /v1/changes
 *   workerState() → { configured, url, lastSyncAt, lastError, queue }
 *   periodic: null | { id: 'worker-sync', intervalMs: 120_000, run }
 */
export async function syncNow() {
  throw Object.assign(new Error('Worker sync is not implemented yet'), { code: 'NOT_IMPLEMENTED' });
}

export function workerState() {
  return { configured: false, url: null, lastSyncAt: null, lastError: null, queue: null };
}

export const periodic = null;
