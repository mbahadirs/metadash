import { dialog, BrowserWindow } from 'electron';
import {
  getTeamState, setIdentity, createTeam, joinTeam, leaveTeam, publishNow, pullNow,
} from '../team/index.js';
import { listMembers } from '../db/queries/team.js';
import { updateNoteV2, myUnseenMentions, markSeen } from '../team/notes.js';

/**
 * Team workspace channels (+ v2.0 note channels). Payloads/results: v20-contract.md, renderer lib/types.ts.
 * Access rules (admin-only team:create, read-only workspace, client view) are enforced by team/policy.js.
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
  handle('team:getState', () => getTeamState());
  handle('team:setIdentity', (p = {}) => setIdentity({ name: p?.name, handle: p?.handle }));
  handle('team:pickFolder', async (_p, event) => {
    const win = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    return { folder: res.filePaths[0] };
  });
  handle('team:create', (p = {}) => createTeam({ folder: p?.folder, name: p?.name, encrypt: !!p?.encrypt, passphrase: p?.passphrase ?? null }));
  handle('team:join', (p = {}) => joinTeam({ folder: p?.folder, passphrase: p?.passphrase ?? null }));
  handle('team:leave', (p = {}) => leaveTeam({ keepCopy: !!p?.keepCopy }));
  handle('team:publishNow', () => publishNow());
  handle('team:pullNow', () => pullNow());
  handle('team:members', () => listMembers());
  handle('notes:update', (p = {}) => updateNoteV2({ id: p?.id, uid: p?.uid, body: p?.body, mentions: p?.mentions, visibility: p?.visibility }));
  handle('notes:mentions', () => myUnseenMentions());
  handle('notes:markSeen', (p = {}) => markSeen(p?.uids));
}
