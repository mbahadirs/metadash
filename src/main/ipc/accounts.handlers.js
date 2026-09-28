import { listAccounts, getAccount, updateAccount } from '../db/queries/accounts.js';
import { listTags, createTag, deleteTag, setAccountTags } from '../db/queries/tags.js';
import { listNotes, addNote, deleteNote } from '../db/queries/media.js';
import { msg } from '../i18n.js';

export function registerAccountHandlers(handle) {
  handle('accounts:list', (params = {}) => listAccounts(params));
  handle('accounts:get', (igId) => getAccount(igId));
  handle('accounts:update', (igId, patch) => { updateAccount(igId, patch ?? {}); return getAccount(igId); });
  handle('accounts:setTags', (igId, tagIds) => { setAccountTags(igId, tagIds ?? []); return getAccount(igId); });
  handle('tags:list', () => listTags());
  handle('tags:create', (tag) => {
    if (!tag?.name?.trim()) throw new Error(msg('tag_name_empty'));
    return createTag({ name: tag.name.trim(), color: tag.color });
  });
  handle('tags:delete', (id) => { deleteTag(id); return true; });
  handle('notes:list', ({ entityType, entityId }) => listNotes(entityType, entityId));
  handle('notes:add', ({ entityType, entityId, body }) => {
    if (!body?.trim()) throw new Error(msg('note_empty'));
    return addNote(entityType, entityId, body.trim());
  });
  handle('notes:delete', (id) => { deleteNote(id); return true; });
}
