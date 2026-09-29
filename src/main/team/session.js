/**
 * Session — STUB (v2.0 chunk B). Chunk F1 owns this file.
 * Session = { role: 'admin' | 'analyst' | 'client', clientScope: string[] | null, readOnly: boolean, workspace: 'local' | teamId }.
 * The own install is admin; getSession() is read by ipc/index.js for policy.check and by session:get.
 */
export const DEFAULT_SESSION = Object.freeze({ role: 'admin', clientScope: null, readOnly: false, workspace: 'local' });

export function getSession() {
  return DEFAULT_SESSION;
}
