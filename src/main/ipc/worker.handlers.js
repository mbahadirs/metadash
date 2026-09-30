import { workerState, setExecutor, recall } from '../worker/sync.js';
import { generate, configure, setPreferences, test, tokens, pushToken, revokeToken, sync, disconnect } from '../worker/service.js';

/**
 * Self-hosted publish worker channels (v2.0 chunk E). Payloads/results: v20-contract.md, preload.cjs, lib/types.ts.
 * Not to be confused with the local publishing queue (publishing:* channels, src/main/publishing/worker.js).
 */
export const WORKER_CHANNELS = Object.freeze([
  'worker:getState',
  'worker:generatePairing',
  'worker:configure',
  'worker:test',
  'worker:tokens',
  'worker:pushToken',
  'worker:revokeToken',
  'worker:syncNow',
  'worker:setExecutor',
  'worker:recall',
  'worker:disconnect',
]);

const obj = (p) => (p && typeof p === 'object' && !Array.isArray(p) ? p : {});
const str = (v, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : undefined);

export function registerWorkerHandlers(handle) {
  handle('worker:getState', () => workerState());
  handle('worker:generatePairing', () => generate());
  // { url, pairing? | secret? } connects; without url/pairing/secret it only updates preferences
  // { defaultExecutor?: 'local'|'worker', enabled?: boolean, notify?: boolean } (those keys are not settings:set DEFAULTS).
  handle('worker:configure', (p) => {
    const o = obj(p);
    if (o.url == null && o.pairing == null && o.secret == null) {
      return setPreferences({ defaultExecutor: o.defaultExecutor === 'worker' ? 'worker' : o.defaultExecutor === 'local' ? 'local' : undefined, enabled: typeof o.enabled === 'boolean' ? o.enabled : undefined, notify: typeof o.notify === 'boolean' ? o.notify : undefined });
    }
    return configure({ url: str(o.url, 2048), pairing: str(o.pairing), secret: str(o.secret, 512) });
  });
  handle('worker:test', () => test());
  handle('worker:tokens', () => tokens());
  handle('worker:pushToken', (p) => {
    const o = obj(p);
    return pushToken({ accountId: str(o.accountId, 128), token: str(o.token, 4096), allowBroader: o.allowBroader === true });
  });
  handle('worker:revokeToken', (p) => revokeToken({ tokenKey: str(obj(p).tokenKey, 128) }));
  handle('worker:syncNow', () => sync());
  handle('worker:setExecutor', (p) => {
    const o = obj(p);
    const ids = Array.isArray(o.targetIds) ? o.targetIds.slice(0, 500).map(Number).filter(Number.isInteger) : [];
    return setExecutor({ targetIds: ids, executor: o.executor });
  });
  handle('worker:recall', (p) => recall({ targetId: Number(obj(p).targetId) }));
  handle('worker:disconnect', () => disconnect());
}
