#!/usr/bin/env node
import fs from 'node:fs';
import { createWorkerApp } from './server.js';
import { createLogger } from './log.js';

/**
 * Entry point. Configuration (environment; *_FILE variants read Docker secrets):
 *   MD_WORKER_SECRET     shared secret from the desktop pairing wizard (≥ 32 chars)            required
 *   MD_WORKER_DATA_KEY   key for encryption at rest (≥ 32 chars; never stored in /data)          required
 *   MD_PUBLIC_URL        public https base URL for signed media links (optional)
 *   MD_DATA_DIR          state + media directory (default /data)
 *   PORT / HOST          listen address (default 8787 / 0.0.0.0)
 *   MD_STRICT_SCOPES     1 (default) re-checks token scopes with Meta on receipt
 *   MD_TRUST_PROXY       1 = use X-Forwarded-For for rate limiting (required behind a reverse proxy; only honoured
 *                        from private/loopback peers, right-most public entry; docker-compose.yml defaults to 1)
 *   MD_LOG_LEVEL         debug | info (default) | warn | error
 *   TZ                   time zone shown in /v1/info
 * No telemetry: the worker only talks to the Meta APIs and to whoever calls it.
 */
function env(name, fallback = undefined) {
  const file = process.env[`${name}_FILE`];
  if (file) return fs.readFileSync(file, 'utf8').trim();
  return process.env[name] ?? fallback;
}

function publicUrlFrom(value) {
  if (!value) return null;
  const u = new URL(value);
  if (u.protocol !== 'https:' && process.env.MD_ALLOW_HTTP_PUBLIC_URL !== '1') throw new Error('MD_PUBLIC_URL must be https (Meta fetches media over HTTPS)');
  return u.toString().replace(/\/+$/, '');
}

async function main() {
  const log = createLogger({ level: env('MD_LOG_LEVEL', 'info') });
  let app;
  try {
    app = createWorkerApp({
      dataDir: env('MD_DATA_DIR', '/data'),
      secret: env('MD_WORKER_SECRET'),
      dataKey: env('MD_WORKER_DATA_KEY'),
      publicUrl: publicUrlFrom(env('MD_PUBLIC_URL')),
      strictScopes: env('MD_STRICT_SCOPES', '1') !== '0',
      trustProxy: env('MD_TRUST_PROXY', '0') === '1',
      tz: process.env.TZ,
      log,
    });
  } catch (e) {
    log.error('configuration error', { message: e.message });
    process.exit(2);
  }
  const port = Number(env('PORT', '8787'));
  const host = env('HOST', '0.0.0.0');
  await app.listen(port, host);
  app.scheduler.start();
  log.info('metadash worker listening', { port, host });
  const shutdown = async (sig) => {
    log.info('shutting down', { on: sig });
    await app.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
