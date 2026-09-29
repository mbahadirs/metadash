import { notImplemented } from './notImplemented.js';

/**
 * Self-hosted publish worker channels — STUB (v2.0 chunk B). Chunk E owns this file and replaces each handler; the channel list,
 * payloads and results are the contract (v20-contract.md; renderer: preload.cjs + lib/types.ts).
 */
export const WORKER_CHANNELS = Object.freeze([
  'worker:getState',
  'worker:generatePairing',
  'worker:configure',
  'worker:test',
  'worker:tokens',
  'worker:pushToken',
  'worker:revokeToken',
  'worker:syncNow',
  'worker:setExecutor',
  'worker:recall',
  'worker:disconnect',
]);

export function registerWorkerHandlers(handle) {
  for (const channel of WORKER_CHANNELS) handle(channel, () => { throw notImplemented(); });
}
