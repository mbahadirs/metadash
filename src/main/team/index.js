/**
 * Team bootstrap — STUB (v2.0 chunk B). Chunk F1 owns this file. Called once by src/main/index.js right after the
 * database opens (GUI and CLI): restore the session, register the account scope filter
 * (db/queries/accounts.js setAccountScopeFilter) and, in subscriber mode, switch to the workspace database.
 */
export async function initTeam() {
  return { workspace: 'local' };
}
