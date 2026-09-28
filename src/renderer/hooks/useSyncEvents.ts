import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/lib/api';
import { useAppStore } from '@/store/app';
import type { SyncProgress, SyncStatus } from '@/lib/types';

/** Subscribes to main-process sync events and keeps the store + query cache fresh. */
export function useSyncEvents() {
  const qc = useQueryClient();
  const { setProgress, setSync, setTokenWarning, setOnline } = useAppStore();
  useEffect(() => {
    const offProgress = api.on('sync:progress', (p: SyncProgress) => setProgress(p));
    const offDone = api.on('sync:done', async () => {
      setProgress(null);
      const s = await call<SyncStatus>(api.sync.status()).catch(() => null);
      setSync(s);
      qc.invalidateQueries();
    });
    const offToken = api.on('token:warning', (p: { message: string }) => setTokenWarning(p.message));
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
  return async (params: { scope?: string; igIds?: string[] } = {}) => {
    await call(api.sync.run(params));
    const s = await call<SyncStatus>(api.sync.status());
    setSync(s);
  };
}
