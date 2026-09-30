import { getSetting } from '../db/queries/settings.js';

/**
 * Inbox settings (settings table, `inbox.*` keys). Read defensively: a missing/invalid value falls back to the default.
 *   inbox.poll         periodic polling while the app/tray runs (default on)
 *   inbox.pollMinutes  polling interval (default 30, 5..1440)
 *   inbox.lookbackDays posts polled every run (default 14, 1..90)
 *   inbox.slaHours     first-response target (default 24, 1..720)
 *   inbox.aiSentiment  classify new comments with the configured AI provider after each poll (default off; ai.enabled too)
 */
export const INBOX_DEFAULTS = Object.freeze({ poll: true, pollMinutes: 30, lookbackDays: 14, slaHours: 24, aiSentiment: false });

const clampNum = (v, min, max, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
};

function read(key, fallback) {
  try { return getSetting(`inbox.${key}`, fallback); } catch { return fallback; }
}

export function inboxSettings() {
  return {
    poll: read('poll', INBOX_DEFAULTS.poll) !== false,
    pollMinutes: clampNum(read('pollMinutes', INBOX_DEFAULTS.pollMinutes), 5, 1440, INBOX_DEFAULTS.pollMinutes),
    lookbackDays: clampNum(read('lookbackDays', INBOX_DEFAULTS.lookbackDays), 1, 90, INBOX_DEFAULTS.lookbackDays),
    slaHours: clampNum(read('slaHours', INBOX_DEFAULTS.slaHours), 1, 720, INBOX_DEFAULTS.slaHours),
    aiSentiment: read('aiSentiment', INBOX_DEFAULTS.aiSentiment) === true,
  };
}
