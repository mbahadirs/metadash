import { getSession, setRole, enterClientView, exitClientView } from '../team/session.js';

/**
 * Session / roles channels. session:get answers with the current session (team/session.js). Roles are UI and
 * workflow guardrails, not a security boundary (docs/team.md).
 */
export const SESSION_CHANNELS = Object.freeze([
  'session:get',
  'session:setRole',
  'session:enterClientView',
  'session:exitClientView',
]);

export function registerSessionHandlers(handle) {
  handle('session:get', () => getSession());
  handle('session:setRole', (p = {}) => setRole(p?.role));
  handle('session:enterClientView', (p = {}) => enterClientView({ clientNames: p?.clientNames, pin: p?.pin }));
  handle('session:exitClientView', (p = {}) => exitClientView({ pin: p?.pin }));
}
