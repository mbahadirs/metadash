import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { api, call, ApiCallError } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import type { FacebookDiscovery } from '@/lib/types';
import { Avatar, Spinner } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { useAccounts } from '@/hooks/queries';

const errText = (e: unknown) => { const x = e as ApiCallError; return x.message + (x.hint ? ` — ${x.hint}` : ''); };

export interface FacebookPagesState { data: FacebookDiscovery | null; error: string | null; notImplemented: boolean; busy: boolean; selected: Set<string>; discover: () => Promise<void>; toggle: (id: string) => void; setSelected: (s: Set<string>) => void }

/** setup:facebook:discover + local selection (defaults to what is already tracked). */
export function useFacebookPages(auto = true): FacebookPagesState {
  const [data, setData] = useState<FacebookDiscovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notImplemented, setNotImplemented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const discover = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await call<FacebookDiscovery>(api.setup.facebook.discover());
      setData(res);
      setSelected(new Set(res.items.filter((p) => p.tracked).map((p) => p.accountId)));
    } catch (e) {
      if ((e as ApiCallError).code === 'NOT_IMPLEMENTED') setNotImplemented(true); else setError(errText(e));
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { if (auto) discover(); }, [auto, discover]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return { data, error, notImplemented, busy, selected, discover, toggle, setSelected };
}

/** Saves the Page selection; returns the tracked count. Linked IG client/tags are copied by the backend. */
export async function saveFacebookPages(state: FacebookPagesState): Promise<number | null> {
  if (!state.data) return null;
  const ids = [...state.selected];
  const res = await call<{ tracked: number }>(api.setup.facebook.saveTracked(ids, {}));
  return res?.tracked ?? ids.length;
}

/** Page list with opt-in checkboxes (Setup step 4 and Settings → Connections). */
export function FacebookPagesList({ state }: { state: FacebookPagesState }) {
  const t = useT();
  const { data, error, notImplemented, busy, selected, toggle } = state;
  const accounts = useAccounts({ onlyTracked: false });
  const igName = (id: string) => accounts.data?.find((a) => a.igId === id)?.username ?? id;
  if (notImplemented) return <div className="text-sm text-ink-2">{t('not_in_build')}</div>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button className="btn btn-sm" onClick={state.discover} disabled={busy}>{busy ? <Spinner size={12} /> : <Icon.refresh />} {t('discover_again')}</button>
        {data && data.items.length > 0 && <><button className="btn btn-sm" onClick={() => state.setSelected(new Set(data.items.filter((p) => p.canAnalyze).map((p) => p.accountId)))}>{t('select_all')}</button><button className="btn btn-sm" onClick={() => state.setSelected(new Set())}>{t('clear')}</button><span className="text-xs text-ink-2 num ml-auto">{selected.size} / {data.items.length}</span></>}
      </div>
      {error && <div className="text-sm text-neg">{error}</div>}
      {data && data.missingScopes?.length > 0 && <div className="text-sm text-warn flex items-center gap-1.5"><Icon.warn /> {t('fb_missing_scopes', { s: data.missingScopes.join(', ') })} <Link to="/setup?step=3" className="ml-1">{t('renew_token')} →</Link></div>}
      {busy && !data && <div className="py-6 text-center"><Spinner /></div>}
      {data && !data.items.length && <div className="text-sm text-ink-2">{t('fb_pages_none')}</div>}
      <div className="grid grid-cols-2 gap-3">
        {(data?.items ?? []).map((p) => { const on = selected.has(p.accountId); return (
          <label key={p.accountId} className={`panel p-3 flex items-center gap-3 ${p.canAnalyze ? 'cursor-pointer' : 'opacity-60'} ${on ? 'border-accent' : ''}`} title={p.canAnalyze ? undefined : t('fb_no_analyze')}>
            <input type="checkbox" checked={on} disabled={!p.canAnalyze && !on} onChange={() => toggle(p.accountId)} />
            <Avatar username={p.name} url={p.pictureUrl} size={32} platform="facebook" />
            <div className="min-w-0">
              <div className="font-medium truncate">{p.name}</div>
              <div className="text-xs text-ink-2 truncate">{fmtNum(p.followers)} {t('followers').toLowerCase()}{p.linkedIgId ? ` · ${t('fb_linked_ig', { u: igName(p.linkedIgId) })}` : ''}</div>
              {!p.canAnalyze && <div className="text-xs text-warn">{t('fb_no_analyze')}</div>}
            </div>
          </label>
        ); })}
      </div>
    </div>
  );
}

/** Standalone panel with its own Save button (Settings → Connections). */
export function FacebookPagesPanel() {
  const t = useT();
  const qc = useQueryClient();
  const state = useFacebookPages(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true); setMsg(null); setErr(null);
    try { const n = await saveFacebookPages(state); if (n != null) setMsg(t('fb_pages_saved', { n })); qc.invalidateQueries({ queryKey: ['platforms'] }); qc.invalidateQueries({ queryKey: ['accounts'] }); qc.invalidateQueries({ queryKey: ['portfolio'] }); } catch (e) { setErr(errText(e)); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-2 m-0">{t('fb_pages_intro')}</p>
      <FacebookPagesList state={state} />
      {state.data && <div className="flex items-center gap-2"><button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>{saving ? <Spinner size={12} /> : null}{t('save')} ({state.selected.size})</button>{msg && <span className="text-xs text-pos">{msg}</span>}{err && <span className="text-xs text-neg">{err}</span>}</div>}
    </div>
  );
}
