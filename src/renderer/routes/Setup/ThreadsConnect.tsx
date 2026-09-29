import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { api, call, ApiCallError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { ThreadsSetupState } from '@/lib/types';
import { Spinner, Toggle } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { PlatformIcon } from '@/components/PlatformBadge';

export const THREADS_GUIDE_URL = 'https://github.com/mbahadirs/metadash/blob/main/docs/threads-setup.md';

export const useThreadsState = () =>
  useQuery<ThreadsSetupState>({ queryKey: ['threadsState'], queryFn: () => call(api.setup.threads.getState()), retry: false });

const errText = (e: unknown) => { const x = e as ApiCallError; return x.message + (x.hint ? ` — ${x.hint}` : ''); };
const isNotImplemented = (e: unknown) => (e as ApiCallError | null)?.code === 'NOT_IMPLEMENTED';
/** expiresAt is epoch ms; tolerate seconds. */
const toMs = (v: number | null | undefined) => (v == null ? null : v < 1e12 ? v * 1000 : v);

export function ThreadsGuideButton() {
  const t = useT();
  return <button type="button" className="btn btn-sm" onClick={() => api.system.openExternal(THREADS_GUIDE_URL)}>{t('threads_guide')} <Icon.external /></button>;
}

/**
 * Threads connection (Setup step 6 and Settings → Connections): Threads app credentials, token/code exchange,
 * status with refresh/disconnect, and the "track this profile" switch.
 */
export function ThreadsConnect({ onChange }: { onChange?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const state = useThreadsState();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refreshAll = async () => { await qc.invalidateQueries({ queryKey: ['threadsState'] }); qc.invalidateQueries({ queryKey: ['platforms'] }); qc.invalidateQueries({ queryKey: ['accounts'] }); onChange?.(); };
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setErr(null);
    try { await fn(); await refreshAll(); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };

  if (state.isLoading) return <div className="py-6 text-center"><Spinner /></div>;
  if (state.error) return <div className="text-sm text-ink-2">{isNotImplemented(state.error) ? t('not_in_build') : <span className="text-neg">{errText(state.error)}</span>}</div>;
  const s = state.data!;
  const exp = toMs(s.expiresAt);
  const daysLeft = exp ? Math.floor((exp - Date.now()) / 86_400_000) : null;

  return (
    <div className="space-y-4">
      {s.hasToken ? (
        <div className="panel p-4 flex flex-wrap items-center gap-4">
          <PlatformIcon platform="threads" size={28} />
          <div className="min-w-0">
            <div className="font-medium text-pos">{s.username ? t('threads_connected_as', { u: s.username }) : t('token_valid')}</div>
            <div className="text-xs text-ink-2 num">{daysLeft != null ? `${daysLeft} ${t('days_left')} · ${fmtDateTime(exp)}` : '—'} · {t('threads_auto_refresh')}</div>
          </div>
          <div className="flex-1" />
          <Toggle checked={s.tracked} onChange={(v) => run('track', () => call(api.setup.threads.saveTracked(v)))} label={t('threads_track')} />
          <button className="btn btn-sm" disabled={!!busy} onClick={() => run('refresh', () => call(api.setup.threads.refresh()))}>{busy === 'refresh' ? <Spinner size={12} /> : <Icon.refresh />} {t('threads_refresh')}</button>
          <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => { if (confirm(t('threads_disconnect_confirm'))) run('disconnect', () => call(api.setup.threads.disconnect())); }}>{t('threads_disconnect')}</button>
        </div>
      ) : (
        <div className="text-sm text-ink-2 flex items-center gap-2"><PlatformIcon platform="threads" size={18} />{t('threads_not_connected_label')}</div>
      )}
      <ThreadsAppForm state={s} busy={busy} run={run} />
      <ThreadsTokenForm hasApp={s.hasApp} busy={busy} run={run} />
      {err && <div className="text-sm text-neg">{err}</div>}
    </div>
  );
}

type Run = (key: string, fn: () => Promise<unknown>) => Promise<void>;

function ThreadsAppForm({ state, busy, run }: { state: ThreadsSetupState; busy: string | null; run: Run }) {
  const t = useT();
  const [appId, setAppId] = useState(state.appId ?? '');
  const [secret, setSecret] = useState('');
  return (
    <details className="panel p-3" open={!state.hasApp}>
      <summary className="cursor-pointer font-medium text-sm">{t('threads_app_title')}{state.hasApp && state.appId && <span className="text-ink-2 font-normal text-xs ml-2">{t('threads_app_saved', { id: state.appId })}</span>}</summary>
      <p className="text-xs text-ink-2 mt-2 mb-3">{t('threads_app_hint')}</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><div className="text-xs text-ink-2 mb-1">{t('threads_app_id')}</div><input className="input num" value={appId} onChange={(e) => setAppId(e.target.value.trim())} placeholder="1234567890123456" /></label>
        <label className="block"><div className="text-xs text-ink-2 mb-1">{t('threads_app_secret')}</div><input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••••••••••" /></label>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-sm btn-primary" disabled={!!busy || !appId || !secret} onClick={() => run('app', async () => { await call(api.setup.threads.saveApp({ appId, appSecret: secret })); setSecret(''); })}>{busy === 'app' ? <Spinner size={12} /> : null}{t('save')}</button>
        <span className="text-xs text-ink-2">{t('app_secret_note')}</span>
      </div>
    </details>
  );
}

function ThreadsTokenForm({ hasApp, busy, run }: { hasApp: boolean; busy: string | null; run: Run }) {
  const t = useT();
  const [mode, setMode] = useState<'token' | 'code'>('token');
  const [value, setValue] = useState('');
  const openAuth = () => run('auth', async () => { const url = await call<string>(api.setup.threads.authUrl({})); await call(api.system.openExternal(url)); });
  const connect = () => run('exchange', async () => {
    const v = value.trim();
    // Pasting the whole redirect URL works too: pull the code parameter out of it.
    const code = mode === 'code' ? (v.match(/[?&]code=([^&#]+)/)?.[1] ?? v).replace(/#_$/, '') : undefined;
    await call(api.setup.threads.exchangeToken(mode === 'token' ? { shortToken: v } : { code: code ? decodeURIComponent(code) : v }));
    setValue('');
  });
  return (
    <div className="panel p-3 space-y-3">
      <div className="flex items-center justify-between gap-2"><div className="font-medium text-sm">{t('threads_access_title')}</div><ThreadsGuideButton /></div>
      <p className="text-xs text-ink-2 m-0">{t('threads_access_hint')}</p>
      <div className="flex items-center gap-2">
        <button className={`chip ${mode === 'token' ? 'active' : ''}`} onClick={() => setMode('token')}>{t('threads_mode_token')}</button>
        <button className={`chip ${mode === 'code' ? 'active' : ''}`} onClick={() => setMode('code')}>{t('threads_mode_code')}</button>
        {mode === 'code' && <button className="btn btn-sm ml-auto" disabled={!hasApp || !!busy} onClick={openAuth}>{t('threads_open_auth')} <Icon.external /></button>}
      </div>
      <textarea className="input font-mono text-xs" rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === 'token' ? 'THAA…' : 'https://…?code=…'} />
      <button className="btn btn-primary" disabled={!hasApp || !!busy || value.trim().length < 10} onClick={connect}>{busy === 'exchange' ? <><Spinner size={12} /> {t('loading')}</> : t('threads_connect')}</button>
    </div>
  );
}
