import { notImplemented } from './notImplemented.js';

/**
 * Command-line tool channels (Settings → Command-line tool) — STUB (v2.0 chunk B). Chunk F2 owns this file and replaces each handler; the channel list,
 * payloads and results are the contract (v20-contract.md; renderer: preload.cjs + lib/types.ts).
 */
export const CLI_CHANNELS = Object.freeze([
  'cli:status',
  'cli:installShim',
  'cli:uninstallShim',
]);

export function registerCliHandlers(handle) {
  for (const channel of CLI_CHANNELS) handle(channel, () => { throw notImplemented(); });
}
