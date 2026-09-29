import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { api, call } from '@/lib/api';

/** Which accounts have a client logo ({ igId: true }); shared by all rows. */
export const useClientLogoFlags = () => useQuery<Record<string, boolean>>({ queryKey: ['clientLogos'], queryFn: () => call(api.accounts.clientLogos()) });

/** Per-account client logo (shown on single-account reports): upload, thumbnail, remove. */
export function ClientLogoCell({ igId, has }: { igId: string; has: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const logo = useQuery<string | null>({ queryKey: ['clientLogo', igId], queryFn: () => call(api.accounts.getClientLogo(igId)), enabled: has });
  const apply = async (dataUrl: string | null) => {
    setErr(null);
    try {
      await call(api.accounts.setClientLogo(igId, dataUrl));
      qc.invalidateQueries({ queryKey: ['clientLogos'] });
      qc.invalidateQueries({ queryKey: ['clientLogo', igId] });
    } catch (e) { setErr((e as Error).message); }
  };
  const pick = async () => {
    try { const r = await call<{ dataUrl: string } | null>(api.export.pickLogo()); if (r) await apply(r.dataUrl); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <span className="flex items-center gap-1" title={err ?? t('client_logo')}>
      {has && logo.data ? <img src={logo.data} alt="" className="h-6 max-w-[64px] object-contain" /> : null}
      <button className="btn btn-ghost btn-sm" onClick={pick} aria-label={t('upload_logo')}>{has ? '↻' : '+'}</button>
      {has && <button className="btn btn-ghost btn-sm text-ink-2" onClick={() => apply(null)} aria-label={t('remove_logo')}>✕</button>}
      {err && <span className="text-xs text-neg">!</span>}
    </span>
  );
}
