import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { api, ApiCallError } from '@/lib/api';
import { fmtDateTime, fmtNum } from '@/lib/format';
import type { PlatformInfo, TikTokAccountState, TikTokSetupState } from '@/lib/types';
import { Avatar, CopyButton, Spinner, Toggle } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { useTikTokState, useTikTokRefresh, tiktokApi } from '@/hooks/useTikTok';

export const TIKTOK_GUIDE_URL = 'https://github.com/mbahadirs/metadash/blob/main/docs/tiktok-setup.md';
/** Desktop redirect URI to register in TikTok for Developers (loopback, any port). */
export const TIKTOK_LOOPBACK_REDIRECT = 'http://127.0.0.1:*/callback/';

const errText = (e: unknown) => { const x = e as ApiCallError; return x.message + (x.hint ? ` — ${x.hint}` : ''); };
const isNotImplemented = (e: unknown) => (e as ApiCallError | null)?.code === 'NOT_IMPLEMENTED';
type Run = (key: string, fn: () => Promise<unknown>) => Promise<void>;

/**
 * Settings → Connections card for TikTok (experimental): client credentials, loopback or paste-code sign-in, one row
 * per connected TikTok account (track, token status, disconnect with optional data deletion).
 */
export function TikTokCard({ info, onChange }: { info: PlatformInfo; onChange: () => void }) {
  const t = useT();
  const state = useTikTokState();
  const refresh = useTikTokRefresh(onChange);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run: Run = async (key, fn) => {
    setBusy(key); setErr(null);
    try { await fn(); await refresh(); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };

  if (!info.enabled) return <div className="text-sm text-ink-2">{t('not_in_build')}</div>;
  if (state.isLoading) return <div className="py-6 text-center"><Spinner /></div>;
  if (state.error) return <div className="text-sm text-ink-2">{isNotImplemented(state.error) ? t('not_in_build') : <span className="text-neg">{errText(state.error)}</span>}</div>;
  const s = state.data!;

  return (
    <div className="space-y-4 text-sm">
      <div className="panel p-3 flex items-start gap-3">
        <div className="flex-1 space-y-1">
          <p className="m-0">{t('tt_experimental_note')}</p>
          <p className="m-0 text-xs text-ink-2">{t('tt_derived_note')}</p>
          {s.sandbox && <p className="m-0 text-xs text-warn">{t('tt_sandbox_note')}</p>}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => api.system.openExternal(TIKTOK_GUIDE_URL)}>{t('tt_guide')} <Icon.external /></button>
      </div>
      {s.accounts.length > 0 ? (
        <div className="space-y-2">
          {s.accounts.map((a) => <AccountRow key={a.profileId} a={a} all={s.accounts} busy={busy} run={run} />)}
        </div>
      ) : (
        <div className="text-ink-2">{t('tt_no_accounts')}</div>
      )}
      <ConnectPanel state={s} busy={busy} run={run} />
      <ClientForm state={s} busy={busy} run={run} />
      {err && <div className="text-neg">{err}</div>}
    </div>
  );
}

function AccountRow({ a, all, busy, run }: { a: TikTokAccountState; all: TikTokAccountState[]; busy: string | null; run: Run }) {
  const t = useT();
  const tracked = all.filter((x) => x.tracked).map((x) => x.accountId);
  const setTracked = (on: boolean) => run(`track:${a.profileId}`, () => tiktokApi.saveTracked(on ? [...tracked, a.accountId] : tracked.filter((id) => id !== a.accountId)));
  const disconnect = () => {
    if (!confirm(t('tt_disconnect_confirm', { u: a.username }))) return;
    const deleteData = confirm(t('tt_delete_data_confirm'));
    void run(`disconnect:${a.profileId}`, () => tiktokApi.disconnect({ profileId: a.profileId, deleteData }));
  };
  const refreshDays = a.refreshExpiresAt ? Math.floor((a.refreshExpiresAt - Date.now()) / 86_400_000) : null;
  return (
    <div className="panel p-3 flex flex-wrap items-center gap-3">
      <Avatar username={a.username} url={a.avatar} platform="tiktok" size={28} />
      <div className="min-w-0">
        <div className="font-medium">@{a.username}{a.displayName && a.displayName !== a.username ? <span className="text-ink-2 font-normal"> · {a.displayName}</span> : null}</div>
        <div className="text-xs num">
          {a.tokenOk ? <span className="text-pos">{t('tt_token_ok')}</span> : <span className="text-neg">{t('tt_token_expired')}</span>}
          {a.followers != null && <span className="text-ink-2"> · {t('tt_followers_n', { n: fmtNum(a.followers) })}</span>}
          {refreshDays != null && <span className="text-ink-2" title={fmtDateTime(a.refreshExpiresAt)}> · {t('tt_login_valid_days', { n: Math.max(0, refreshDays) })}</span>}
        </div>
      </div>
      <div className="flex-1" />
      <Toggle checked={a.tracked} onChange={setTracked} label={t('tt_track')} />
      <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={disconnect}>{busy === `disconnect:${a.profileId}` ? <Spinner size={12} /> : null}{t('tt_disconnect')}</button>
    </div>
  );
}

function ConnectPanel({ state, busy, run }: { state: TikTokSetupState; busy: string | null; run: Run }) {
  const t = useT();
  const [paste, setPaste] = useState<{ state: string } | null>(null);
  const [value, setValue] = useState('');
  const waiting = busy === 'connect';
  const connect = () => run('connect', () => tiktokApi.connect());
  // The pending connect() then rejects with “sign-in cancelled”, which run() shows.
  const cancel = () => { void tiktokApi.cancelConnect(); };
  const openPaste = () => run('auth', async () => {
    const r = await tiktokApi.authUrl();
    setPaste({ state: r.state });
    await api.system.openExternal(r.url);
  });
  const exchange = () => run('exchange', async () => {
    await tiktokApi.exchangeCode({ code: value.trim(), state: paste?.state ?? '' });
    setValue(''); setPaste(null);
  });
  return (
    <div className="panel p-3 space-y-3">
      <div className="font-medium">{t('tt_connect_title')}</div>
      <p className="text-xs text-ink-2 m-0">{t('tt_connect_hint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" disabled={!state.hasClient || (!!busy && !waiting)} onClick={waiting ? undefined : connect}>
          {waiting ? <><Spinner size={12} /> {t('tt_waiting_browser')}</> : t('tt_connect_browser')}
        </button>
        {waiting && <button className="btn btn-sm" onClick={cancel}>{t('cancel')}</button>}
        <button className="btn btn-sm ml-auto" disabled={!state.hasClient || !!busy} onClick={openPaste}>{t('tt_paste_open')} <Icon.external /></button>
      </div>
      {paste && (
        <div className="space-y-2">
          <p className="text-xs text-ink-2 m-0">{t('tt_paste_hint')}</p>
          <textarea className="input font-mono text-xs" rows={2} value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…/oauth/callback.html?code=…&state=…" />
          <button className="btn btn-sm btn-primary" disabled={!!busy || value.trim().length < 6} onClick={exchange}>{busy === 'exchange' ? <Spinner size={12} /> : null}{t('tt_paste_connect')}</button>
        </div>
      )}
    </div>
  );
}

function ClientForm({ state, busy, run }: { state: TikTokSetupState; busy: string | null; run: Run }) {
  const t = useT();
  const [clientKey, setClientKey] = useState(state.clientKey ?? '');
  const [secret, setSecret] = useState('');
  const [sandbox, setSandbox] = useState(state.sandbox);
  const [redirectUri, setRedirectUri] = useState(state.redirectUri ?? '');
  const save = () => run('client', async () => {
    await tiktokApi.saveClient({ clientKey, clientSecret: secret, sandbox, redirectUri: redirectUri.trim() });
    setSecret('');
  });
  return (
    <details className="panel p-3" open={!state.hasClient}>
      <summary className="cursor-pointer font-medium">{t('tt_client_title')}{state.hasClient && state.clientKey && <span className="text-ink-2 font-normal text-xs ml-2">{t('tt_client_saved', { key: state.clientKey })}</span>}</summary>
      <p className="text-xs text-ink-2 mt-2 mb-3">{t('tt_client_hint')}</p>
      <div className="flex items-center gap-2 text-xs mb-3">
        <span className="text-ink-2">{t('tt_redirect_register')}</span>
        <code className="font-mono">{TIKTOK_LOOPBACK_REDIRECT}</code>
        <CopyButton text={TIKTOK_LOOPBACK_REDIRECT} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><div className="text-xs text-ink-2 mb-1">{t('tt_client_key')}</div><input className="input font-mono" value={clientKey} onChange={(e) => setClientKey(e.target.value.trim())} placeholder="aw1b2c3d4e5f6g7h" /></label>
        <label className="block"><div className="text-xs text-ink-2 mb-1">{t('tt_client_secret')}</div><input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••••••••••" /></label>
      </div>
      <div className="mt-3"><Toggle checked={sandbox} onChange={setSandbox} label={t('tt_sandbox_toggle')} /></div>
      <label className="block mt-3"><div className="text-xs text-ink-2 mb-1">{t('tt_paste_redirect')}</div><input className="input font-mono text-xs" value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} placeholder="https://…/oauth/callback.html" /></label>
      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-sm btn-primary" disabled={!!busy || !clientKey || !secret} onClick={save}>{busy === 'client' ? <Spinner size={12} /> : null}{t('save')}</button>
        <span className="text-xs text-ink-2">{t('app_secret_note')}</span>
      </div>
    </details>
  );
}
