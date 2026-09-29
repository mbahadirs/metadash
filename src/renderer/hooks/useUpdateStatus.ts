import { useCallback, useEffect, useState } from 'react';
import { api, call } from '@/lib/api';
import type { UpdateStatus } from '@/lib/types';

/** Live app-update status from the main process plus the actions to act on it. */
export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  useEffect(() => {
    call<UpdateStatus>(api.update.status()).then(setStatus).catch(() => {});
    return api.on('update:status', (s: UpdateStatus) => setStatus(s));
  }, []);
  const check = useCallback(async () => {
    const s = await call<UpdateStatus>(api.update.check()).catch((e: Error) => ({ state: 'error', error: e.message }) as UpdateStatus);
    setStatus(s);
  }, []);
  const download = useCallback(() => call(api.update.download()).catch(() => {}), []);
  const install = useCallback(() => call(api.update.install()).catch(() => {}), []);
  const openRelease = useCallback(() => call(api.update.openRelease()).catch(() => {}), []);
  /** Primary action for an available/downloaded update: open the release page, download, or restart. */
  const act = useCallback(() => {
    if (status.state === 'downloaded') return install();
    if (status.state === 'available') return status.manual ? openRelease() : download();
    return undefined;
  }, [status, install, openRelease, download]);
  return { status, check, download, install, openRelease, act };
}
