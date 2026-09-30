import {
  tiktokState, saveTikTokClient, connectTikTokLoopback, cancelTikTokConnect, tiktokAuthUrl, exchangeTikTokCode,
  setTikTokTracked, disconnectTikTok,
} from '../providers/tiktok/connection.js';
import { currentLang } from '../i18n.js';

/**
 * TikTok setup channels (experimental, v2.0 chunk C2). Contract (v20-contract.md; renderer: preload.cjs + lib/types.ts):
 *  setup:tiktok:getState      () → TikTokSetupState
 *  setup:tiktok:saveClient    ({ clientKey, clientSecret, redirectUri?, sandbox? }) → { clientKey }
 *                               (redirectUri/sandbox are optional extensions: paste-code page URL, sandbox flag)
 *  setup:tiktok:connect       () → { accountId, username }   loopback http://127.0.0.1:<port>/callback/ (blocks until the browser returns)
 *  setup:tiktok:cancelConnect () → true
 *  setup:tiktok:authUrl       () → { url, state }             paste-code flow (https callback page)
 *  setup:tiktok:exchangeCode  ({ code, state }) → { accountId, username }   code may be the whole redirect URL
 *  setup:tiktok:saveTracked   ({ accountIds }) → { accountIds }
 *  setup:tiktok:disconnect    ({ profileId, deleteData }) → true
 */
export const TIKTOK_SETUP_CHANNELS = Object.freeze([
  'setup:tiktok:getState',
  'setup:tiktok:saveClient',
  'setup:tiktok:connect',
  'setup:tiktok:cancelConnect',
  'setup:tiktok:authUrl',
  'setup:tiktok:exchangeCode',
  'setup:tiktok:saveTracked',
  'setup:tiktok:disconnect',
]);

export function registerTikTokSetupHandlers(handle) {
  handle('setup:tiktok:getState', () => tiktokState());
  handle('setup:tiktok:saveClient', (p) => saveTikTokClient(p ?? {}));
  handle('setup:tiktok:connect', () => connectTikTokLoopback({ lang: currentLang() }));
  handle('setup:tiktok:cancelConnect', () => { cancelTikTokConnect(); return true; });
  handle('setup:tiktok:authUrl', () => tiktokAuthUrl());
  handle('setup:tiktok:exchangeCode', (p) => exchangeTikTokCode(p ?? {}));
  handle('setup:tiktok:saveTracked', (p) => setTikTokTracked(Array.isArray(p?.accountIds) ? p.accountIds : []));
  handle('setup:tiktok:disconnect', (p) => disconnectTikTok(p ?? {}));
}
