import { notImplemented } from './notImplemented.js';
import { getSession } from '../team/session.js';

/**
 * Session / roles channels — STUB (v2.0 chunk B). Chunk F1 owns this file. session:get already answers with the
 * current session (team/session.js; the stub is always admin on the own install) so the renderer can rely on it.
 */
export const SESSION_CHANNELS = Object.freeze([
  'session:get',
  'session:setRole',
  'session:enterClientView',
  'session:exitClientView',
]);

export function registerSessionHandlers(handle) {
  handle('session:get', () => getSession());
  for (const channel of SESSION_CHANNELS.filter((c) => c !== 'session:get')) handle(channel, () => { throw notImplemented(); });
}
