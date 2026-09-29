import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/lib/api';
import { useAppStore } from '@/store/app';
import type { AuthPlatform, Platform, SyncDone, SyncProgress, SyncStatus, TokenWarning } from '@/lib/types';

const authOf = (p: unknown): AuthPlatform => (p === 'threads' ? 'threads' : 'meta');

/** Subscribes to main-process sync events and keeps the store + query cache fresh. */
export function useSyncEvents() {
  const qc = useQueryClient();
  const { setProgress, setSync, setTokenWarning, setOnline } = useAppStore();
  useEffect(() => {
    const offProgress = api.on('sync:progress', (p: SyncProgress) => setProgress(p));
    const offDone = api.on('sync:done', async (d?: Partial<SyncDone>) => {
      setProgress(null);
      const s = await call<SyncStatus>(api.sync.status()).catch(() => null);
      setSync(s);
      // A Threads-only token failure doesn't cancel the run; make sure the banner shows even if no event arrived.
      if (d?.invalidAuth?.includes('threads') && !useAppStore.getState().tokenWarning) setTokenWarning({ platform: 'threads', message: '' });
      qc.invalidateQueries();
    });
    // token:warning carries { platform: 'meta' | 'threads', code, message } since v1.3; older payloads had no platform.
    const offToken = api.on('token:warning', (p: Partial<TokenWarning> & { message: string }) => setTokenWarning({ platform: authOf(p.platform), message: p.message }));
    call<SyncStatus>(api.sync.status()).then(setSync).catch(() => {});
    const ping = async () => {
      const online = await call<boolean>(api.system.online()).catch(() => false);
      setOnline(online);
    };
    ping();
    const timer = setInterval(ping, 60_000);
    return () => { offProgress(); offDone(); offToken(); clearInterval(timer); };
  }, [qc, setProgress, setSync, setTokenWarning, setOnline]);
}

export function useRunSync() {
  const setSync = useAppStore((s) => s.setSync);
  return async (params: { scope?: string; igIds?: string[]; platforms?: Platform[] } = {}) => {
    await call(api.sync.run(params));
    const s = await call<SyncStatus>(api.sync.status());
    setSync(s);
  };
}
