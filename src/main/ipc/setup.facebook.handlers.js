import { notImplemented } from './notImplemented.js';

/**
 * Facebook Pages setup channels (implemented in chunk B). Contract:
 *  setup:facebook:discover    () → { items: [{ accountId, pageId, name, pictureUrl, followers, linkedIgId, canAnalyze, tracked, known }], missingScopes: string[] }
 *  setup:facebook:saveTracked ({ accountIds: string[], meta?: Record<accountId, { clientName?, tags?: string[] }> }) → { tracked: number }
 */
export const FACEBOOK_SETUP_CHANNELS = ['setup:facebook:discover', 'setup:facebook:saveTracked'];

export function registerFacebookSetupHandlers(handle) {
  for (const channel of FACEBOOK_SETUP_CHANNELS) {
    handle(channel, () => { throw notImplemented(); });
  }
}
