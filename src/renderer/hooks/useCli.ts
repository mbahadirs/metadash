import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/lib/api';
import type { CliStatus } from '@/lib/types';

const KEY = ['cliStatus'];

/** Command-line tool status (cli:status) plus install / uninstall of the `metadash` shim. */
export function useCli() {
  const qc = useQueryClient();
  const status = useQuery<CliStatus>({ queryKey: KEY, queryFn: () => call<CliStatus>(api.cli.status()) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<CliStatus>) => {
    setBusy(true);
    setError(null);
    try { qc.setQueryData(KEY, await fn()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return {
    status,
    busy,
    error,
    install: (dir?: string) => run(() => call<CliStatus>(api.cli.installShim(dir ? { dir } : {}))),
    uninstall: () => run(() => call<CliStatus>(api.cli.uninstallShim())),
  };
}
