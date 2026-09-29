import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { api, call, ApiCallError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSettings } from '@/hooks/queries';
import type { MediaHostSettings, MediaHostInput, MediaHostTest, MediaHostType, PublishingReadiness, PublishingStatus, PlatformReadiness, Platform, S3Settings } from '@/lib/types';
import { Section, Toggle, Loading } from '@/components/ui';
import { PlatformBadge } from '@/components/PlatformBadge';
import { NumberSetting } from './BackgroundSection';

const READINESS_KEY = ['publishingReadiness'];
const STATUS_KEY = ['publishingStatus'];
const HOST_KEY = ['mediaHost'];
const HOST_TYPES = [['none', 'pub_host_none'], ['s3', 'pub_host_s3'], ['fbpage', 'pub_host_fbpage'], ['url', 'pub_host_url']] as const;
const PLATFORMS: Platform[] = ['instagram', 'facebook', 'threads'];
const notImplemented = (e: unknown) => e instanceof ApiCallError && e.code === 'NOT_IMPLEMENTED';

/**
 * Publishing preferences (v1.4 plan §9): per-platform readiness, pause, approval requirement, notifications and the
 * media host used by Instagram/Threads. Talks to chunk B's publishing:* channels; while those are stubs
 * (NOT_IMPLEMENTED) it shows a friendly notice and only the settings-backed toggles.
 */
export function PublishingSection() {
  const t = useT();
  const readiness = useQuery<PublishingReadiness>({ queryKey: READINESS_KEY, queryFn: () => call(api.publishing.readiness()), retry: false });
  const status = useQuery<PublishingStatus>({ queryKey: STATUS_KEY, queryFn: () => call(api.publishing.status()), retry: false });
  const host = useQuery<MediaHostSettings>({ queryKey: HOST_KEY, queryFn: () => call(api.publishing.mediaHost.get()), retry: false });
  const unavailable = [readiness.error, status.error, host.error].some(notImplemented);

  return (
    <Section title={t('pub_section')}>
      {unavailable && <div className="text-xs text-ink-2 mb-3 panel p-3">{t('pub_unavailable')}</div>}
      <div className="space-y-4">
        {!unavailable && <Readiness query={readiness} />}
        <Preferences status={unavailable ? null : status.data ?? null} />
        {!unavailable && (host.isLoading ? <Loading /> : host.data ? <MediaHostForm settings={host.data} lastTestOk={readiness.data?.mediaHost.lastTestOk ?? null} /> : host.error ? <div className="text-xs text-neg">{(host.error as Error).message}</div> : null)}
      </div>
    </Section>
  );
}

function Readiness({ query }: { query: { data?: PublishingReadiness; isLoading: boolean; error: unknown } }) {
  const t = useT();
  if (query.isLoading) return <Loading />;
  if (query.error) return <div className="text-xs text-neg">{(query.error as Error).message}</div>;
  const r = query.data;
  if (!r) return null;
  const row = (p: Platform, x: PlatformReadiness, extra?: string) => (
    <div key={p} className="flex flex-wrap items-center gap-2 min-h-8 py-1 border-b border-line text-sm">
      <span className="w-32"><PlatformBadge platform={p} /></span>
      <span className={`badge ${x.canPublish ? 'badge-pos' : 'badge-neg'}`}>{t(x.canPublish ? 'pub_ready' : 'pub_not_ready')}</span>
      <span className={`badge ${x.firstComment ? 'badge-muted' : 'badge-warn'}`}>{t(x.firstComment ? 'pub_first_comment' : 'pub_first_comment_off')}</span>
      {x.missingScopes.length > 0 && <span className="text-xs text-ink-2">{t('pub_missing', { s: x.missingScopes.join(', ') })}</span>}
      {extra && <span className="text-xs text-ink-2">{extra}</span>}
    </div>
  );
  const pages = r.facebook.pages ?? [];
  const anyMissing = PLATFORMS.some((p) => !r[p].canPublish);
  return (
    <div>
      <div className="text-ink-2 text-xs mb-1">{t('pub_readiness')}</div>
      {row('instagram', r.instagram)}
      {row('facebook', r.facebook, pages.length ? t('pub_pages', { ok: pages.filter((p) => p.canPublish).length, n: pages.length }) : undefined)}
      {row('threads', r.threads)}
      {anyMissing && <div className="text-xs text-ink-2 mt-1">{t('pub_renew_hint')}</div>}
    </div>
  );
}

function Preferences({ status }: { status: PublishingStatus | null }) {
  const t = useT();
  const qc = useQueryClient();
  const settings = useSettings();
  const v = (settings.data ?? {}) as Record<string, unknown>;
  const set = async (key: string, value: unknown) => { await call(api.settings.set(key, value)); qc.invalidateQueries({ queryKey: ['settings'] }); };
  const paused = status ? status.paused : v['planner.paused'] === true;
  const setPaused = async (value: boolean) => {
    if (status) { await call(api.publishing.setPaused(value)); qc.invalidateQueries({ queryKey: STATUS_KEY }); } else await set('planner.paused', value);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Toggle checked={paused} onChange={setPaused} label={t('pub_paused')} />
        {status?.nextAt != null && <span className="text-xs text-ink-2">{t('pub_status_next', { d: fmtDateTime(status.nextAt) })}</span>}
        {!!status?.inFlight && <span className="text-xs text-ink-2">{t('pub_status_inflight', { n: status.inFlight })}</span>}
      </div>
      <div><Toggle checked={v['planner.requireApproval'] === true} onChange={(x) => set('planner.requireApproval', x)} label={t('pub_require_approval')} /></div>
      <div><Toggle checked={v['notify.publishSuccess'] !== false} onChange={(x) => set('notify.publishSuccess', x)} label={t('pub_notify_success')} /></div>
      <div><Toggle checked={v['notify.publishFailure'] !== false} onChange={(x) => set('notify.publishFailure', x)} label={t('pub_notify_failure')} /></div>
      <NumberSetting label={t('pub_min_gap')} value={Number(v['planner.minGapHours'] ?? 3)} min={0} max={72} onSave={(n) => set('planner.minGapHours', n)} />
    </div>
  );
}

type Msg = { kind: 'ok' | 'err'; text: string } | null;

function MediaHostForm({ settings, lastTestOk }: { settings: MediaHostSettings; lastTestOk: boolean | null }) {
  const t = useT();
  const qc = useQueryClient();
  const [type, setType] = useState<MediaHostType>(settings.type);
  const [s3, setS3] = useState<S3Settings>(settings.s3);
  const [keyId, setKeyId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => { setType(settings.type); setS3(settings.s3); }, [settings]);
  const field = <K extends keyof S3Settings>(k: K, value: S3Settings[K]) => setS3((cur) => ({ ...cur, [k]: value }));

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const input: MediaHostInput = { type, ...(type === 's3' ? { s3 } : {}), ...(keyId ? { accessKeyId: keyId } : {}), ...(secret ? { secretAccessKey: secret } : {}) };
      await call(api.publishing.mediaHost.set(input));
      setKeyId(''); setSecret('');
      await qc.invalidateQueries({ queryKey: HOST_KEY });
      await qc.invalidateQueries({ queryKey: READINESS_KEY });
      setMsg({ kind: 'ok', text: t('pub_saved') });
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await call<MediaHostTest>(api.publishing.mediaHost.test());
      setMsg(r.ok ? { kind: 'ok', text: t('pub_test_ok', { s: r.status ?? '—', ms: r.ms }) } : { kind: 'err', text: t('pub_test_fail', { e: r.error ?? `HTTP ${r.status ?? '—'}` }) });
      qc.invalidateQueries({ queryKey: READINESS_KEY });
    } catch (e) { setMsg({ kind: 'err', text: t('pub_test_fail', { e: (e as Error).message }) }); } finally { setBusy(false); }
  };

  const text = (k: 'endpoint' | 'region' | 'bucket' | 'prefix' | 'publicBaseUrl', label: string, placeholder = '') => (
    <label className="block"><div className="text-ink-2 text-xs mb-1">{label}</div><input className="input text-xs" value={s3[k] ?? ''} placeholder={placeholder} onChange={(e) => field(k, e.target.value)} /></label>
  );
  return (
    <div className="border-t border-line pt-3 space-y-3">
      <div className="font-medium text-sm">{t('pub_host')}</div>
      <div className="text-xs text-ink-2">{t('pub_host_hint')}</div>
      <div className="flex items-center gap-3"><span className="w-40 text-sm">{t('pub_host_type')}</span>
        <select className="input w-96" value={type} onChange={(e) => setType(e.target.value as MediaHostType)}>
          {HOST_TYPES.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
        </select>
      </div>
      {type === 'fbpage' && <div className="text-xs text-warn">{t('pub_host_fbpage_warn')}</div>}
      {type === 'url' && <div className="text-xs text-ink-2">{t('pub_host_url_hint')}</div>}
      {type === 's3' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {text('endpoint', t('pub_s3_endpoint'), 'https://<account>.r2.cloudflarestorage.com')}
            {text('region', t('pub_s3_region'), 'auto')}
            {text('bucket', t('pub_s3_bucket'))}
            {text('prefix', t('pub_s3_prefix'), 'metadash/')}
            {text('publicBaseUrl', t('pub_s3_public_base'), 'https://cdn.example.com/')}
            <label className="block"><div className="text-ink-2 text-xs mb-1">{t('pub_s3_ttl')}</div><input type="number" className="input text-xs num" min={60} max={604800} value={s3.urlTtlSec ?? 86400} onChange={(e) => field('urlTtlSec', Number(e.target.value))} /></label>
            <label className="block"><div className="text-ink-2 text-xs mb-1">{t('pub_s3_key_id')}</div><input className="input text-xs" autoComplete="off" value={keyId} placeholder={settings.keySet ? t('pub_s3_key_set', { l: settings.keySet.last4 }) : ''} onChange={(e) => setKeyId(e.target.value)} /></label>
            <label className="block"><div className="text-ink-2 text-xs mb-1">{t('pub_s3_secret')}</div><input type="password" className="input text-xs" autoComplete="off" value={secret} placeholder={settings.keySet ? t('pub_s3_key_keep') : ''} onChange={(e) => setSecret(e.target.value)} /></label>
          </div>
          <div><Toggle checked={!!s3.pathStyle} onChange={(v) => field('pathStyle', v)} label={t('pub_s3_path_style')} /></div>
          <div><Toggle checked={s3.deleteAfterPublish !== false} onChange={(v) => field('deleteAfterPublish', v)} label={t('pub_s3_delete')} /></div>
          <div className="text-xs text-ink-2">{t('pub_s3_secret_note')}</div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{t('pub_save')}</button>
        <button className="btn btn-sm" disabled={busy || type === 'none'} onClick={test}>{t('pub_test')}</button>
        {lastTestOk != null && !msg && <span className="text-xs text-ink-2">{t('pub_last_test', { r: t(lastTestOk ? 'pub_test_passed' : 'pub_test_failed') })}</span>}
        {msg && <span className={`text-xs ${msg.kind === 'ok' ? 'text-pos' : 'text-neg'}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
