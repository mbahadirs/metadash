import { teamTick, POLL_INTERVAL_MS } from './index.js';

/**
 * Team timer, registered by sync/scheduler.js (GUI / tray only, never the CLI). Every minute: a subscriber polls the
 * shared folder (fs.watch is unreliable on cloud folders); the publisher publishes once team.publishIntervalMin has
 * passed (it also publishes after each successful sync, see team/index.js) and otherwise merges members' events.
 */
export const periodic = Object.freeze({ id: 'team', intervalMs: POLL_INTERVAL_MS, runOnStart: true, run: () => teamTick() });
