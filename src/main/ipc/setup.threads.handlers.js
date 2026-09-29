import { setSetting } from '../db/queries/settings.js';
import {
  threadsState, saveThreadsApp, requireApp, validRedirectUri, connectThreads, refreshThreadsToken, disconnectThreads,
  setThreadsTracked, SETTING_REDIRECT_URI,
} from '../providers/threads/connection.js';
import { buildAuthUrl } from '../providers/threads/auth.js';

/**
 * Threads setup channels. Contract:
 *  setup:threads:getState      () → { hasApp, appId, hasToken, expiresAt, username, tracked }
 *  setup:threads:saveApp       ({ appId, appSecret }) → { appId }
 *  setup:threads:authUrl       ({ redirectUri? }?) → string   (redirect must be https; remembered for the code exchange)
 *  setup:threads:exchangeToken ({ shortToken?, code?, redirectUri? }) → { expiresAt, username }
 *                               `code` may be the bare code, code + '#_', or the whole redirect URL
 *  setup:threads:refresh       () → { expiresAt }
 *  setup:threads:disconnect    () → true
 *  setup:threads:saveTracked   ({ tracked: boolean }) → { tracked: boolean }
 */
export const THREADS_SETUP_CHANNELS = [
  'setup:threads:getState', 'setup:threads:saveApp', 'setup:threads:authUrl', 'setup:threads:exchangeToken',
  'setup:threads:refresh', 'setup:threads:disconnect', 'setup:threads:saveTracked',
];

export function registerThreadsSetupHandlers(handle) {
  handle('setup:threads:getState', () => threadsState());

  handle('setup:threads:saveApp', (p) => saveThreadsApp(p ?? {}));

  handle('setup:threads:authUrl', (p) => {
    const { appId } = requireApp();
    const redirectUri = validRedirectUri(p?.redirectUri);
    setSetting(SETTING_REDIRECT_URI, redirectUri);
    return buildAuthUrl({ appId, redirectUri });
  });

  handle('setup:threads:exchangeToken', (p) => connectThreads(p ?? {}));

  handle('setup:threads:refresh', () => refreshThreadsToken());

  handle('setup:threads:disconnect', () => disconnectThreads());

  handle('setup:threads:saveTracked', (p) => setThreadsTracked(!!p?.tracked));
}
