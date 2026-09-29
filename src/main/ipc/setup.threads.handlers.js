import { notImplemented } from './notImplemented.js';

/**
 * Threads setup channels (implemented in chunk C). Contract:
 *  setup:threads:getState      () → { hasApp, appId, hasToken, expiresAt, username, tracked }
 *  setup:threads:saveApp       ({ appId, appSecret }) → { appId }
 *  setup:threads:authUrl       ({ redirectUri? }?) → string
 *  setup:threads:exchangeToken ({ shortToken?, code?, redirectUri? }) → { expiresAt, username }
 *  setup:threads:refresh       () → { expiresAt }
 *  setup:threads:disconnect    () → true
 *  setup:threads:saveTracked   ({ tracked: boolean }) → { tracked: boolean }
 */
export const THREADS_SETUP_CHANNELS = [
  'setup:threads:getState', 'setup:threads:saveApp', 'setup:threads:authUrl', 'setup:threads:exchangeToken',
  'setup:threads:refresh', 'setup:threads:disconnect', 'setup:threads:saveTracked',
];

export function registerThreadsSetupHandlers(handle) {
  for (const channel of THREADS_SETUP_CHANNELS) {
    handle(channel, () => { throw notImplemented(); });
  }
}
