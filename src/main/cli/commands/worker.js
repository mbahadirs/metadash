import { EXIT } from '../exitCodes.js';
import { services, cliT } from '../args.js';
import { workerState, syncNow } from '../../worker/sync.js';
import { test as testConnection, rotateSecret } from '../../worker/service.js';

/**
 * `worker` command (self-hosted publish worker): metadash worker status | worker sync | worker test
 *   status  connection, queue on the worker, tokens (no secrets are ever printed)
 *   sync    push pending worker items and pull their status now (exit 3 when some items failed to sync)
 *   test    health + signed request round trip
 *   rotate  new shared secret (the worker stores it; update MD_WORKER_SECRET in its .env when convenient)
 * Pairing and tokens are managed in Settings → Publishing → Self-hosted worker.
 */
const USAGE = 'metadash worker status | worker sync | worker test | worker rotate';
const DEFAULTS = { workerState, syncNow, testConnection, rotateSecret };

function summary(s) {
  return {
    configured: s.configured, enabled: s.enabled, url: s.url, defaultExecutor: s.defaultExecutor, lastSyncAt: s.lastSyncAt, lastError: s.lastError,
    version: s.info?.version ?? null, queue: s.info?.queue ?? null, publicMediaUrl: s.info?.publicMediaUrl ?? null,
    tokens: s.tokens.map((t) => ({ tokenKey: t.tokenKey, platform: t.platform, status: t.status, expiresAt: t.expiresAt })),
  };
}

export const command = {
  name: 'worker',
  summary: USAGE,
  help: USAGE,
  options: {},
  async run(_args, io) {
    const s = services(io, DEFAULTS);
    const sub = io.positionals?.[0] ?? 'status';
    if (!['status', 'sync', 'test', 'rotate'].includes(sub)) {
      io.out.error(`usage: ${USAGE}`);
      return EXIT.USAGE;
    }
    const state = s.workerState();
    if (sub === 'status') {
      io.out.result(summary(state));
      return EXIT.OK;
    }
    if (!state.configured) {
      io.out.error(`worker: ${cliT(io)('worker_err_not_configured')}`);
      return EXIT.ERROR;
    }
    try {
      if (sub === 'rotate') {
        const r = await s.rotateSecret();
        io.out.result(io.out.json ? { rotated: true } : 'Secret rotated. Optionally put the new MD_WORKER_SECRET into the worker .env (shown on stderr).');
        io.out.warn(r.envLine);
        return EXIT.OK;
      }
      if (sub === 'test') {
        io.out.result(await s.testConnection());
        return EXIT.OK;
      }
      const r = await s.syncNow({ reason: 'cli' });
      io.out.result({ pushed: r.pushed, pulled: r.pulled, errors: r.errors });
      return r.errors.length ? EXIT.PARTIAL : EXIT.OK;
    } catch (e) {
      io.out.error(`worker: ${e.message}`);
      return e.code === 'WORKER_AUTH' ? EXIT.AUTH : EXIT.ERROR;
    }
  },
};
