import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { api, ApiCallError } from '@/lib/api';
import { fmtDateTime, fmtNum } from '@/lib/format';
import type { PlatformInfo, YouTubeChannel, YouTubeSetupState } from '@/lib/types';
import { Spinner, Toggle } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { useYouTubeState, useYouTubeRefresh, youtubeApi } from '@/hooks/useYouTube';

export const YOUTUBE_GUIDE_URL = 'https://github.com/mbahadirs/metadash/blob/main/docs/youtube-setup.md';
const GOOGLE_PERMISSIONS_URL = 'https://myaccount.google.com/permissions';

const errText = (e: unknown) => { const x = e as ApiCallError; return x.message + (x.hint ? ` — ${x.hint}` : ''); };
const isNotImplemented = (e: unknown) => (e as ApiCallError | null)?.code === 'NOT_IMPLEMENTED';
type Run = (key: string, fn: () => Promise<unknown>) => Promise<void>;

/**
 * Settings → Connections → YouTube: the user's Google OAuth client (Desktop app), connected channels (one Google
 * consent per channel) with track / enable replying / disconnect (+ delete data), and today's API quota.
 */
export function YouTubeCard({ info, onChange }: { info: PlatformInfo; onChange: () => void }) {
  void info;
  const t = useT();
  const state = useYouTubeState();
  const refresh = useYouTubeRefresh(onChange);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run: Run = async (key, fn) => {
    setBusy(key); setErr(null);
    try { await fn(); await refresh(); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };

  if (state.isLoading) return <div className="py-6 text-center"><Spinner /></div>;
  if (state.error) return <div className="text-sm text-ink-2">{isNotImplemented(state.error) ? t('not_in_build') : <span className="text-neg">{errText(state.error)}</span>}</div>;
  const s = state.data!;
  const connecting = busy === 'connect' || busy?.startsWith('reply:');

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{t('yt_channels_title')}</div>
        <button type="button" className="btn btn-sm" onClick={() => api.system.openExternal(YOUTUBE_GUIDE_URL)}>{t('yt_guide')} <Icon.external /></button>
      </div>
      {s.channels.length ? (
        <div className="space-y-2">{s.channels.map((c) => <ChannelRow key={c.profileId} channel={c} state={s} busy={busy} run={run} />)}</div>
      ) : <div className="text-ink-2">{t('yt_no_channels')}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm" disabled={!s.hasClient || !!busy} onClick={() => run('connect', () => youtubeApi.connect({}))}>
          {busy === 'connect' ? <><Spinner size={12} /> {t('yt_connecting')}</> : t('yt_connect_channel')}
        </button>
        {connecting && <button className="btn btn-sm" onClick={() => youtubeApi.cancelConnect().catch(() => {})}>{t('cancel')}</button>}
        <span className="text-xs text-ink-2">{t('yt_connect_hint')}</span>
      </div>
      {s.quota && (
        <div className="text-xs text-ink-2 num">{t('yt_quota', { used: fmtNum(s.quota.used), limit: fmtNum(s.quota.limit) })} · {t('yt_quota_resets', { time: fmtDateTime(s.quota.resetsAt) })}</div>
      )}
      <ClientForm state={s} busy={busy} run={run} />
      <p className="text-xs text-ink-2 m-0">
        {t('yt_privacy_note')}{' '}
        <button type="button" className="underline hover:text-ink-1" onClick={() => api.system.openExternal(GOOGLE_PERMISSIONS_URL)}>{t('yt_permissions_link')}</button>
      </p>
      {err && <div className="text-neg">{err}</div>}
    </div>
  );
}

function ChannelRow({ channel: c, state, busy, run }: { channel: YouTubeChannel; state: YouTubeSetupState; busy: string | null; run: Run }) {
  const t = useT();
  const [deleteData, setDeleteData] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const tracked = state.channels.filter((x) => x.tracked).map((x) => x.accountId);
  const setTracked = (on: boolean) => run(`track:${c.profileId}`, () => youtubeApi.saveTracked(on ? [...new Set([...tracked, c.accountId])] : tracked.filter((id) => id !== c.accountId)));
  return (
    <div className="panel p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {c.thumbnail ? <img src={c.thumbnail} alt="" className="w-8 h-8 rounded-full" /> : <div className="w-8 h-8 rounded-full bg-surface-2" />}
        <div className="min-w-0">
          <div className="font-medium truncate">{c.title}{c.handle && <span className="text-ink-2 font-normal ml-2">{c.handle}</span>}</div>
          <div className="text-xs text-ink-2 num">
            {c.subscribers != null ? t('yt_subscribers', { n: fmtNum(c.subscribers) }) : t('yt_subscribers_hidden')}
            {c.canReply && <> · <span className="text-pos">{t('yt_reply_enabled')}</span></>}
            {!c.tokenOk && <> · <span className="text-neg">{t('yt_token_problem')}</span></>}
          </div>
        </div>
        <div className="flex-1" />
        <Toggle checked={c.tracked} onChange={setTracked} label={t('yt_track')} />
        {(!c.canReply || !c.tokenOk) && (
          <button className="btn btn-sm" title={t('yt_enable_reply_hint')} disabled={!state.hasClient || !!busy} onClick={() => run(`reply:${c.profileId}`, () => youtubeApi.connect({ reply: true }))}>
            {busy === `reply:${c.profileId}` ? <Spinner size={12} /> : null}{c.tokenOk ? t('yt_enable_reply') : t('yt_reconnect')}
          </button>
        )}
        <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => setConfirming((v) => !v)}>{t('yt_disconnect')}</button>
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2">
          <span className="text-xs">{t('yt_disconnect_confirm', { name: c.title })}</span>
          <Toggle checked={deleteData} onChange={setDeleteData} label={t('yt_delete_data')} />
          <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => run(`disconnect:${c.profileId}`, () => youtubeApi.disconnect({ profileId: c.profileId, deleteData }))}>
            {busy === `disconnect:${c.profileId}` ? <Spinner size={12} /> : null}{t('yt_disconnect')}
          </button>
          <button className="btn btn-sm" onClick={() => setConfirming(false)}>{t('cancel')}</button>
        </div>
      )}
    </div>
  );
}

function ClientForm({ state, busy, run }: { state: YouTubeSetupState; busy: string | null; run: Run }) {
  const t = useT();
  const [clientId, setClientId] = useState(state.clientId ?? '');
  const [secret, setSecret] = useState('');
  return (
    <details className="panel p-3" open={!state.hasClient}>
      <summary className="cursor-pointer font-medium">{t('yt_client_title')}{state.hasClient && state.clientId && <span className="text-ink-2 font-normal text-xs ml-2">{t('yt_client_saved', { id: state.clientId })}</span>}</summary>
      <p className="text-xs text-ink-2 mt-2 mb-3">{t('yt_client_hint')}</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><div className="text-xs text-ink-2 mb-1">{t('yt_client_id')}</div><input className="input num" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} placeholder="1234567890-abc.apps.googleusercontent.com" /></label>
        <label className="block"><div className="text-xs text-ink-2 mb-1">{t('yt_client_secret')}</div><input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GOCSPX-…" /></label>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-sm btn-primary" disabled={!!busy || !clientId || !secret} onClick={() => run('client', async () => { await youtubeApi.saveClient({ clientId, clientSecret: secret }); setSecret(''); })}>{busy === 'client' ? <Spinner size={12} /> : null}{t('save')}</button>
        <span className="text-xs text-ink-2">{t('app_secret_note')}</span>
      </div>
    </details>
  );
}
