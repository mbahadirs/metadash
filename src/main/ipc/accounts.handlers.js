import { listAccounts, getAccount, updateAccount } from '../db/queries/accounts.js';
import { listTags, createTag, deleteTag, setAccountTags } from '../db/queries/tags.js';
import { listNotesFor, addNoteV2, deleteNoteV2 } from '../team/notes.js';
import { msg } from '../i18n.js';
import { getClientLogo, setClientLogo, clientLogoFlags } from '../db/queries/accountLogos.js';

export function registerAccountHandlers(handle) {
  handle('accounts:list', (params = {}) => listAccounts(params));
  handle('accounts:get', (igId) => getAccount(igId));
  handle('accounts:update', (igId, patch) => { updateAccount(igId, patch ?? {}); return getAccount(igId); });
  handle('accounts:clientLogos', () => clientLogoFlags());
  handle('accounts:getClientLogo', (igId) => getClientLogo(igId));
  handle('accounts:setClientLogo', (igId, dataUrl) => {
    try { return setClientLogo(igId, dataUrl ?? null); } catch (e) { throw new Error(msg(e.message)); }
  });
  handle('accounts:setTags', (igId, tagIds) => { setAccountTags(igId, tagIds ?? []); return getAccount(igId); });
  handle('tags:list', () => listTags());
  handle('tags:create', (tag) => {
    if (!tag?.name?.trim()) throw new Error(msg('tag_name_empty'));
    return createTag({ name: tag.name.trim(), color: tag.color });
  });
  handle('tags:delete', (id) => { deleteTag(id); return true; });
  // v2.0 F1: notes carry author, @mentions and visibility; the client view only lists 'client' notes (team/notes.js).
  handle('notes:list', ({ entityType, entityId } = {}) => listNotesFor({ entityType, entityId }));
  handle('notes:add', ({ entityType, entityId, body, mentions, visibility } = {}) => {
    if (!body?.trim()) throw new Error(msg('note_empty'));
    return addNoteV2({ entityType, entityId, body, mentions, visibility });
  });
  handle('notes:delete', (id) => deleteNoteV2(id));
}
