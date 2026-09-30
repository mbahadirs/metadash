import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { useAccounts } from '@/hooks/queries';
import { WORKER_KEY, useWorkerState, workerApi, type WorkerStateX } from '@/hooks/useWorker';
import type { Account, WorkerExecutor, WorkerPairing, WorkerToken } from '@/lib/types';
import { Section, Toggle, Loading, CopyButton } from '@/components/ui';

const WORKER_PLATFORMS = ['instagram', 'facebook', 'threads'];
const fmt = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : '—');
const errText = (e: unknown) => (e as Error)?.message ?? String(e);

/**
 * Settings → Publishing → Self-hosted worker (v2.0 chunk E): pairing wizard, connection test, sync, token list with
 * scope badges and expiry, default executor and notifications. Renders a short intro + wizard until connected.
 */
export function WorkerSection() {
  const t = useT();
  const q = useWorkerState();
  const s = q.data;
  return (
    <Section title={t('worker_section')}>
      <div className="text-xs text-ink-2 mb-3">{t('worker_intro')}</div>
      {q.isLoading || !s ? <Loading /> : s.configured ? <Connected s={s} /> : <PairingWizard />}
    </Section>
  );
}

function PairingWizard() {
  const t = useT();
  const qc = useQueryClient();
  const [pairing, setPairing] = useState<WorkerPairing | null>(null);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => { setErr(null); try { setPairing(await workerApi.generatePairing()); } catch (e) { setErr(errText(e)); } };
  const connect = async () => {
    setBusy(true); setErr(null);
    try {
      const pasted = secret.trim();
      const input = pasted.startsWith('mdw1:') ? { url: url.trim() || undefined, pairing: pasted } : { url: url.trim(), secret: pasted || pairing?.secret || '' };
      qc.setQueryData(WORKER_KEY, await workerApi.configure(input));
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <ol className="list-decimal pl-5 space-y-3 text-sm">
        <li>
          <div>{t('worker_step_generate')}</div>
          <button type="button" className="btn btn-sm mt-1" onClick={() => void generate()}>{t('worker_generate')}</button>
          {pairing && (
            <div className="mt-2 space-y-2">
              <div className="text-xs text-ink-2">{t('worker_env_hint')}</div>
              <div className="flex items-start gap-2"><pre className="input text-xs whitespace-pre-wrap break-all flex-1">{pairing.envSnippet}</pre><CopyButton text={pairing.envSnippet} /></div>
              <div className="text-xs text-warn">{t('worker_env_private')}</div>
            </div>
          )}
        </li>
        <li>
          <div>{t('worker_step_run')}</div>
          <pre className="input text-xs whitespace-pre-wrap break-all mt-1">docker compose --env-file .env up -d</pre>
          <div className="text-xs text-ink-2">{t('worker_tls_hint')}</div>
        </li>
        <li>
          <div>{t('worker_step_connect')}</div>
          <div className="grid sm:grid-cols-2 gap-2 mt-1">
            <input className="input" value={url} placeholder="https://worker.example.com" aria-label={t('worker_url')} onChange={(e) => setUrl(e.target.value)} />
            <input className="input" type="password" autoComplete="off" value={secret} placeholder={pairing ? t('worker_secret_generated') : t('worker_secret_placeholder')} aria-label={t('worker_secret')} onChange={(e) => setSecret(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary btn-sm mt-2" disabled={busy || (!url.trim() && !secret.trim().startsWith('mdw1:'))} onClick={() => void connect()}>{busy ? t('worker_connecting') : t('worker_connect')}</button>
        </li>
      </ol>
      {err && <div className="text-xs text-neg" role="alert">{err}</div>}
    </div>
  );
}

function Connected({ s }: { s: WorkerStateX }) {
  const t = useT();
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: WORKER_KEY });
  const run = async (name: string, fn: () => Promise<string | null>) => {
    setBusy(name); setErr(null); setNote(null);
    try { setNote(await fn()); } catch (e) { setErr(errText(e)); } finally { setBusy(null); refresh(); }
  };
  const prefs = (p: { defaultExecutor?: WorkerExecutor; enabled?: boolean; notify?: boolean }) => run('prefs', async () => { qc.setQueryData(WORKER_KEY, await workerApi.preferences(p)); return null; });
  const q = s.info?.queue;

  return (
    <div className="space-y-4 text-sm">
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
        <div><span className="text-ink-2">{t('worker_url')}: </span><span className="break-all">{s.url}</span></div>
        <div><span className="text-ink-2">{t('worker_version')}: </span>{s.info?.version ?? '—'}</div>
        <div><span className="text-ink-2">{t('worker_last_sync')}: </span>{fmt(s.lastSyncAt)}</div>
        <div><span className="text-ink-2">{t('worker_queue')}: </span>{q ? t('worker_queue_counts', { queued: q.queued, publishing: q.publishing, failed: q.failed }) : '—'}</div>
        <div><span className="text-ink-2">{t('worker_public_media')}: </span>{s.info ? (s.info.publicMediaUrl ? t('worker_yes') : t('worker_no_public_media')) : '—'}</div>
        {s.state && <div><span className="text-ink-2">{t('worker_state')}: </span>{t(`worker_state_${s.state}` as 'worker_state_idle')}</div>}
      </div>
      {s.lastError && <div className="text-xs text-neg" role="alert">{s.lastError}</div>}
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void run('test', async () => { const r = await workerApi.test(); return t('worker_test_ok', { version: r.version, ms: r.latencyMs }); })}>{t('worker_test')}</button>
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void run('sync', async () => { const r = await workerApi.syncNow(); return t('worker_sync_done', { pushed: r.pushed, pulled: r.pulled }); })}>{busy === 'sync' ? t('worker_syncing') : t('worker_sync_now')}</button>
        {!confirmDisconnect
          ? <button type="button" className="btn btn-sm btn-ghost text-neg" onClick={() => setConfirmDisconnect(true)}>{t('worker_disconnect')}</button>
          : (
            <span className="inline-flex items-center gap-2 text-xs">
              {t('worker_disconnect_confirm')}
              <button type="button" className="btn btn-sm text-neg" onClick={() => void run('disconnect', async () => { await workerApi.disconnect(); setConfirmDisconnect(false); return null; })}>{t('worker_disconnect')}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDisconnect(false)}>{t('worker_cancel')}</button>
            </span>
          )}
      </div>
      {note && <div className="text-xs text-pos">{note}</div>}
      {err && <div className="text-xs text-neg" role="alert">{err}</div>}

      <div className="border-t border-line pt-3 space-y-2">
        <Toggle checked={s.enabled} onChange={(v) => void prefs({ enabled: v })} label={t('worker_enabled')} />
        <Toggle checked={s.notify !== false} onChange={(v) => void prefs({ notify: v })} label={t('worker_notify')} />
        <label className="flex items-center gap-3">
          <span className="w-72">{t('worker_default_executor')}</span>
          <select className="input w-56" value={s.defaultExecutor} onChange={(e) => void prefs({ defaultExecutor: e.target.value as WorkerExecutor })}>
            <option value="local">{t('worker_exec_local')}</option>
            <option value="worker">{t('worker_exec_worker')}</option>
          </select>
        </label>
        <div className="text-xs text-ink-2">{t('worker_default_executor_hint')}</div>
      </div>

      <Tokens tokens={s.tokens} onChanged={refresh} />
    </div>
  );
}

function TokenBadge({ tok }: { tok: WorkerToken }) {
  const t = useT();
  const cls = tok.status === 'ok' ? 'badge-pos' : tok.status === 'expiring' ? 'badge-warn' : 'badge-neg';
  const known = ['ok', 'expiring', 'invalid', 'missing'].includes(tok.status) ? tok.status : 'invalid';
  return <span className={`badge ${cls}`}>{t(`worker_token_${known}` as 'worker_token_ok')}</span>;
}

function Tokens({ tokens, onChanged }: { tokens: WorkerToken[]; onChanged: () => void }) {
  const t = useT();
  const accountsQ = useAccounts({ onlyTracked: true });
  const accounts = (accountsQ.data ?? []).filter((a: Account) => WORKER_PLATFORMS.includes(a.platform ?? 'instagram'));
  const [accountId, setAccountId] = useState('');
  const [token, setToken] = useState('');
  const [broad, setBroad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = (id: string) => { const a = accounts.find((x) => x.igId === id); return a ? `@${a.username}` : id; };

  const send = async () => {
    setBusy(true); setErr(null);
    try { await workerApi.pushToken({ accountId, token: token.trim() || undefined, allowBroader: broad }); setToken(''); onChanged(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const revoke = async (key: string) => { setErr(null); try { await workerApi.revokeToken(key); onChanged(); } catch (e) { setErr(errText(e)); } };

  return (
    <div className="border-t border-line pt-3 space-y-2">
      <div className="font-medium">{t('worker_tokens')}</div>
      <div className="text-xs text-ink-2">{t('worker_tokens_hint')}</div>
      {tokens.length === 0 ? <div className="text-xs text-ink-2">{t('worker_tokens_none')}</div> : (
        <table className="w-full text-xs">
          <thead><tr className="text-left text-ink-2"><th>{t('worker_token_account')}</th><th>{t('worker_token_scopes')}</th><th>{t('worker_token_expires')}</th><th>{t('worker_token_status')}</th><th /></tr></thead>
          <tbody>
            {tokens.map((tok) => (
              <tr key={tok.tokenKey} className="border-t border-line">
                <td className="py-1">{tok.platform} {name(tok.accountId)}</td>
                <td className="py-1"><span className="flex flex-wrap gap-1">{tok.scopes.map((sc) => <span key={sc} className="badge badge-muted">{sc}</span>)}</span></td>
                <td className="py-1">{fmt(tok.expiresAt)}</td>
                <td className="py-1"><TokenBadge tok={tok} /></td>
                <td className="py-1 text-right"><button type="button" className="btn btn-ghost btn-sm" onClick={() => void revoke(tok.tokenKey)}>{t('worker_revoke')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-center">
        <select className="input" value={accountId} aria-label={t('worker_token_account')} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">{t('worker_pick_account')}</option>
          {accounts.map((a) => <option key={a.igId} value={a.igId}>{a.platform} @{a.username}</option>)}
        </select>
        <input className="input" type="password" autoComplete="off" value={token} placeholder={t('worker_token_paste')} aria-label={t('worker_token_paste')} onChange={(e) => setToken(e.target.value)} />
        <button type="button" className="btn btn-sm" disabled={!accountId || busy} onClick={() => void send()}>{t('worker_send_token')}</button>
      </div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={broad} onChange={(e) => setBroad(e.target.checked)} />{t('worker_allow_broader')}</label>
      {broad && <div className="text-xs text-warn">{t('worker_allow_broader_warn')}</div>}
      {err && <div className="text-xs text-neg" role="alert">{err}</div>}
    </div>
  );
}
