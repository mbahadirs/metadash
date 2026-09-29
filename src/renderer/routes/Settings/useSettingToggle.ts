import { useQueryClient } from '@tanstack/react-query';
import { useSettings } from '@/hooks/queries';
import { api, call } from '@/lib/api';

/** Reads boolean settings (missing = true) and writes them back, refreshing the settings query. */
export function useSettingToggle() {
  const qc = useQueryClient();
  const settings = useSettings();
  const values = (settings.data ?? {}) as Record<string, unknown>;
  const get = (key: string) => values[key] !== false;
  const set = async (key: string, value: boolean) => { await call(api.settings.set(key, value)); qc.invalidateQueries({ queryKey: ['settings'] }); };
  return { get, set, loading: settings.isLoading };
}
