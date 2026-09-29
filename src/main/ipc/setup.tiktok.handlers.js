import { notImplemented } from './notImplemented.js';

/**
 * TikTok setup channels (experimental) — STUB (v2.0 chunk B). Chunk C2 owns this file and replaces each handler; the channel list,
 * payloads and results are the contract (v20-contract.md; renderer: preload.cjs + lib/types.ts).
 */
export const TIKTOK_SETUP_CHANNELS = Object.freeze([
  'setup:tiktok:getState',
  'setup:tiktok:saveClient',
  'setup:tiktok:connect',
  'setup:tiktok:cancelConnect',
  'setup:tiktok:authUrl',
  'setup:tiktok:exchangeCode',
  'setup:tiktok:saveTracked',
  'setup:tiktok:disconnect',
]);

export function registerTikTokSetupHandlers(handle) {
  for (const channel of TIKTOK_SETUP_CHANNELS) handle(channel, () => { throw notImplemented(); });
}
