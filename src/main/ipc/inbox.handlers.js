import { notImplemented } from './notImplemented.js';

/**
 * Unified inbox channels — STUB (v2.0 chunk B). Chunk D owns this file and replaces each handler; the channel list,
 * payloads and results are the contract (v20-contract.md; renderer: preload.cjs + lib/types.ts).
 */
export const INBOX_CHANNELS = Object.freeze([
  'inbox:list',
  'inbox:thread',
  'inbox:reply',
  'inbox:retry',
  'inbox:setStatus',
  'inbox:assign',
  'inbox:hide',
  'inbox:refresh',
  'inbox:suggest',
  'inbox:classify',
  'inbox:classifyPreview',
  'inbox:sla',
  'inbox:capabilities',
  'inbox:counts',
]);

export function registerInboxHandlers(handle) {
  for (const channel of INBOX_CHANNELS) handle(channel, () => { throw notImplemented(); });
}
