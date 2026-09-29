import { notImplemented } from './notImplemented.js';

/**
 * YouTube setup channels — STUB (v2.0 chunk B). Chunk C1 owns this file and replaces each handler; the channel list,
 * payloads and results are the contract (v20-contract.md; renderer: preload.cjs + lib/types.ts).
 */
export const YOUTUBE_SETUP_CHANNELS = Object.freeze([
  'setup:youtube:getState',
  'setup:youtube:saveClient',
  'setup:youtube:connect',
  'setup:youtube:cancelConnect',
  'setup:youtube:saveTracked',
  'setup:youtube:disconnect',
]);

export function registerYouTubeSetupHandlers(handle) {
  for (const channel of YOUTUBE_SETUP_CHANNELS) handle(channel, () => { throw notImplemented(); });
}
