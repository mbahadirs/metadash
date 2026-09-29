import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/lib/api';

export interface Branding { agencyName: string; logo: string | null; accent: string; footerText: string; hideCredit: boolean }

export const DEFAULT_ACCENT = '#4F7CFF';
export const isHex = (v: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());

/** Report branding (validated in main); save() merges a partial update and refreshes the cache. */
export function useBranding() {
  const qc = useQueryClient();
  const q = useQuery<Branding>({ queryKey: ['branding'], queryFn: () => call(api.export.branding()) });
  const save = async (patch: Partial<Branding>) => {
    const next = await call<Branding>(api.export.setBranding(patch));
    qc.setQueryData(['branding'], next);
    return next;
  };
  return { branding: q.data, loading: q.isLoading, save };
}
