import { notImplemented } from './notImplemented.js';

/**
 * Team workspace channels (+ v2.0 note channels) — STUB (v2.0 chunk B). Chunk F1 owns this file and replaces each handler; the channel list,
 * payloads and results are the contract (v20-contract.md; renderer: preload.cjs + lib/types.ts).
 */
export const TEAM_CHANNELS = Object.freeze([
  'team:getState',
  'team:setIdentity',
  'team:pickFolder',
  'team:create',
  'team:join',
  'team:leave',
  'team:publishNow',
  'team:pullNow',
  'team:members',
  'notes:update',
  'notes:mentions',
  'notes:markSeen',
]);

export function registerTeamHandlers(handle) {
  for (const channel of TEAM_CHANNELS) handle(channel, () => { throw notImplemented(); });
}
