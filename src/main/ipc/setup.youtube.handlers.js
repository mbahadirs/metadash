import {
  youtubeState, saveClient, connectChannel, cancelConnect, saveTracked, disconnectChannel,
} from '../providers/youtube/connection.js';
import { currentLang } from '../i18n.js';

/**
 * YouTube setup channels (v2.0 C1). Contract (v20-contract.md; renderer: preload.cjs + lib/types.ts):
 *  setup:youtube:getState       () → YouTubeSetupState { hasClient, clientId, channels[], quota }
 *  setup:youtube:saveClient     ({ clientId, clientSecret }) → { clientId }
 *  setup:youtube:connect        ({ reply? }) → { accountId, title }   blocks until the browser returns (5 min timeout)
 *  setup:youtube:cancelConnect  () → true
 *  setup:youtube:saveTracked    ({ accountIds }) → { accountIds }
 *  setup:youtube:disconnect     ({ profileId, deleteData }) → true   revokes the grant; deleteData defaults to true
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
  handle('setup:youtube:getState', () => youtubeState());
  handle('setup:youtube:saveClient', (p) => saveClient(p ?? {}));
  handle('setup:youtube:connect', (p) => connectChannel({ reply: p?.reply === true }, { lang: currentLang() }));
  handle('setup:youtube:cancelConnect', () => cancelConnect());
  handle('setup:youtube:saveTracked', (p) => saveTracked(p ?? {}));
  handle('setup:youtube:disconnect', (p) => disconnectChannel({ profileId: p?.profileId, deleteData: p?.deleteData !== false }));
}
