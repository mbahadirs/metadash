import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSettings, useTokenHealth, useAccounts, useTags, useAdAccounts, useSyncHistory, useApiMutation, useSetupState } from '@/hooks/queries';
import { useAppStore } from '@/store/app';
import { useT } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { fmtDateTime, fmtNum, fmtRelative } from '@/lib/format';
import type { Account, TransferInfo } from '@/lib/types';
import { Section, Toggle, Loading, Avatar, TagChip } from '@/components/ui';
import { ExcelButton } from '@/components/ExcelButton';
import { useRef } from 'react';
import { UpdatesPanel } from './UpdatesPanel';
import { NotificationsSection } from './NotificationsSection';
import { AiSection } from './AiSection';
import { BrandingSection } from './BrandingSection';
import { ClientLogoCell, useClientLogoFlags } from './ClientLogoCell';

const SERIES_COLORS = ['#4F7CFF', '#3FBF8F', '#E8B44A', '#C06CE8', '#E5605F', '#48C3D6'];

export function SettingsPage() {
  const t = useT();
  const qc = useQueryClient();
  const settings = useSettings();
  const token = useTokenHealth();
  const setup = useSetupState();
  const { theme, setTheme, lang, setLang, setDemo } = useAppStore();
  const set = async (key: string, value: unknown) => { await call(api.settings.set(key, value)); qc.invalidateQueries({ queryKey: ['settings'] }); };
  const s = (settings.data ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [msg, setMsg] = useState<string | null>(null);

  if (settings.isLoading) return <Loading />;
  return (
    <div className="max-w-5xl space-y-6">
      <Section title={t('connection')} right={<Link to="/setup?step=3" className="btn btn-sm">{t('renew_token')}</Link>}>
        {token.isLoading ? <Loading /> : token.data && (
          <div className="grid grid-cols-3 gap-6 text-sm">
            <div><div className="text-ink-2 text-xs">{t('token_health')}</div><div className={`text-lg font-semibold ${token.data.valid ? 'text-pos' : 'text-neg'}`}>{token.data.valid ? t('token_valid') : t('token_invalid')}{token.data.demo && <span className="badge badge-muted ml-2">{t('demo_mode')}</span>}</div>{token.data.error && <div className="text-neg text-xs">{token.data.error}</div>}</div>
            <div><div className="text-ink-2 text-xs">{t('expires')}</div><div className="text-lg num">{token.data.daysLeft != null ? `${token.data.daysLeft} ${t('days_left')}` : '—'}</div><div className="text-xs text-ink-2">{token.data.expiresAt ? fmtDateTime(token.data.expiresAt) : ''}</div></div>
            <div><div className="text-ink-2 text-xs">{t('permissions')}</div><div className="flex flex-wrap gap-1 mt-1">{(token.data.scopes ?? []).map((sc) => <span key={sc} className="badge badge-pos">{sc}</span>)}{(token.data.missingScopes ?? []).map((sc) => <span key={sc} className="badge badge-neg">{sc}</span>)}</div></div>
          </div>
        )}
      </Section>

      <Section title={t('sync_settings')}>
        <div className="space-y-4">
          <Toggle checked={!!s.autoSyncDaily} onChange={(v) => set('autoSyncDaily', v)} label={t('auto_sync')} />
          <div className="flex items-center gap-3"><span className="w-72">{t('story_interval')}</span><input type="number" min={0} max={24} className="input w-24 num" value={s.storyIntervalHours ?? 4} onChange={(e) => set('storyIntervalHours', Number(e.target.value))} /></div>
          <div><div className="mb-2">{t('refresh_tiers')}</div><div className="grid grid-cols-4 gap-3 text-xs">
            {([['fresh', t('tier_fresh'), t('tier_every_sync')], ['recent', t('tier_recent'), ''], ['month', t('tier_month'), ''], ['old', t('tier_old'), '']] as const).map(([k, label, note]) => (
              <label key={k} className="block"><div className="text-ink-2 mb-1">{label}{note && ` (${note})`}</div><input type="number" className="input num" disabled={k === 'fresh'} value={s.refreshTiers?.[k] ?? ''} onChange={(e) => set('refreshTiers', { ...s.refreshTiers, [k]: Number(e.target.value) })} /></label>
            ))}
          </div></div>
          <div className="flex items-center gap-3"><span className="w-72">{t('media_lookback')}</span><input type="number" className="input w-24 num" value={s.mediaLookbackDays ?? 365} onChange={(e) => set('mediaLookbackDays', Number(e.target.value))} /></div>
          <Toggle checked={!!s.syncComments} onChange={(v) => set('syncComments', v)} label={t('sync_comments')} />
        </div>
      </Section>

      <NotificationsSection />

      <AiSection />

      <BrandingSection />

      <MetricsSection />
      <AccountsSection />
      <AdAccountsSection />
      <TagsSection />

      <Section title={t('database')}>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={async () => { const r = await call<{ filePath?: string; canceled?: boolean }>(api.db.backup()); if (!r.canceled) setMsg(`${t('saved_to')} ${r.filePath}`); }}>{t('backup')}</button>
          <button className="btn" onClick={async () => { if (!confirm(t('restore_confirm'))) return; const r = await call<{ restoredFrom?: string; canceled?: boolean }>(api.db.restore()); if (!r.canceled) { setMsg(`${t('restore')}: ${r.restoredFrom}`); qc.invalidateQueries(); } }}>{t('restore')}</button>
          <CsvExport />
          {msg && <span className="text-xs text-ink-2">{msg}</span>}
        </div>
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-line">
          <button className="btn" onClick={async () => { try { await call(api.setup.loadDemo({ reset: false })); setDemo(true); qc.invalidateQueries(); } catch (e) { setMsg((e as Error).message); } }}>{t('load_demo')}</button>
          <button className="btn" onClick={async () => { if (!confirm(t('reset_demo') + '?')) return; try { await call(api.setup.loadDemo({ reset: true })); setDemo(true); qc.invalidateQueries(); } catch (e) { setMsg((e as Error).message); } }}>{t('reset_demo')}</button>
          <button className="btn btn-danger" onClick={async () => { if (!confirm(t('clear_all') + '?')) return; await call(api.setup.resetAll()); setDemo(false); qc.invalidateQueries(); }}>{t('clear_all')}</button>
          {setup.data?.demo && <span className="text-xs text-ink-2">{t('demo_banner')}</span>}
          {msg && <span className="text-xs text-neg">{msg}</span>}
        </div>
      </Section>

      <TransferSection />

      <SqlConsole />

      <Section title={`${t('theme')} · ${t('language')}`}>
        <div className="flex items-center gap-6">
          <div className="flex gap-1"><button className={`chip ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>{t('dark')}</button><button className={`chip ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>{t('light')}</button></div>
          <div className="flex gap-1"><button className={`chip ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>English</button><button className={`chip ${lang === 'tr' ? 'active' : ''}`} onClick={() => setLang('tr')}>Türkçe</button></div>
        </div>
      </Section>

      <SyncHistorySection />
      <SystemInfo />
    </div>
  );
}

function MetricsSection() {
  const t = useT();
  const qc = useQueryClient();
  const [disabled, setDisabled] = useState<{ metric: string; scope: string; reason: string; disabledAt: number }[]>([]);
  const [sets, setSets] = useState<Record<string, Record<string, string[]>> | null>(null);
  const settings = useSettings();
  const overrides = ((settings.data ?? {}) as Record<string, any>).metricOverrides as Record<string, Record<string, string[]>> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  useEffect(() => {
    call<typeof disabled>(api.sync.disabledMetrics()).then(setDisabled).catch(() => {});
    call<{ metricSets: typeof sets }>(api.system.info()).then((i) => setSets(i.metricSets)).catch(() => {});
  }, []);
  const save = async (group: string, key: string, value: string) => {
    const next = { ...(overrides ?? {}), [group]: { ...((overrides ?? {})[group] ?? {}), [key]: value.split(',').map((x) => x.trim()).filter(Boolean) } };
    await call(api.settings.set('metricOverrides', next));
    qc.invalidateQueries({ queryKey: ['settings'] });
  };
  return (
    <Section title={t('metrics')}>
      <div className="space-y-4 text-sm">
        <div><div className="text-ink-2 text-xs mb-1">{t('unsupported_metrics')}</div>
          {disabled.length === 0 ? <div className="text-ink-2">{t('none')}</div> : disabled.map((d) => (
            <div key={d.metric} className="flex items-center justify-between h-8 border-b border-line"><span><code>{d.metric}</code> <span className="text-ink-2 text-xs">({d.scope}) {d.reason?.slice(0, 80)}</span></span><button className="btn btn-sm" onClick={async () => setDisabled(await call(api.sync.enableMetric(d.metric)))}>{t('re_enable')}</button></div>
          ))}
        </div>
        {sets && (
          <div className="grid grid-cols-2 gap-3">{Object.entries(sets).flatMap(([group, keys]) => Object.entries(keys).map(([key, list]) => (
            <label key={group + key} className="block"><div className="text-ink-2 text-xs mb-1">{group}.{key}</div><input className="input text-xs" defaultValue={(overrides?.[group]?.[key] ?? list).join(', ')} onBlur={(e) => save(group, key, e.target.value)} /></label>
          )))}</div>
        )}
      </div>
    </Section>
  );
}

function AccountsSection() {
  const t = useT();
  const accounts = useAccounts({ onlyTracked: false });
  const tags = useTags();
  const logoFlags = useClientLogoFlags();
  const update = useApiMutation<{ igId: string; patch: Partial<Pick<Account, 'clientName' | 'color' | 'isTracked'>> }>(({ igId, patch }) => api.accounts.update(igId, patch), ['accounts', 'portfolio']);
  const setTags = useApiMutation<{ igId: string; tagIds: number[] }>(({ igId, tagIds }) => api.accounts.setTags(igId, tagIds), ['accounts', 'tags', 'portfolio']);
  return (
    <Section title={`${t('account_management')} · ${accounts.data?.length ?? 0}`} right={<ExcelButton name="account-management" getData={() => ({ name: t('account_management'), columns: [{ key: 'username', label: t('account'), type: 'text' }, { key: 'name', label: t('client'), type: 'text' }, { key: 'clientName', label: t('client'), type: 'text' }, { key: 'followers', label: t('followers'), type: 'int' }, { key: 'mediaCount', label: t('posts'), type: 'int' }, { key: 'isTracked', label: t('tracked'), type: 'text' }, { key: 'lastSyncedAt', label: t('last_sync'), type: 'datetime' }], rows: (accounts.data ?? []).map((a) => ({ ...a, isTracked: a.isTracked ? t('yes') : t('no') })) })} />}>
      <div className="-m-4 max-h-96 overflow-auto"><table className="table">
        <thead><tr><th>{t('account')}</th><th>{t('client')}</th><th>{t('client_logo')}</th><th>{t('color')}</th><th>{t('tags')}</th><th>{t('last_sync')}</th><th>{t('tracked')}</th></tr></thead>
        <tbody>{(accounts.data ?? []).map((a) => (
          <tr key={a.igId} className={a.isTracked ? '' : 'opacity-50'}>
            <td><span className="flex items-center gap-2"><Avatar username={a.username} url={a.profilePicUrl} color={a.color} size={22} />@{a.username}</span></td>
            <td><input className="input h-7 text-xs w-44" defaultValue={a.clientName ?? ''} onBlur={(e) => e.target.value !== (a.clientName ?? '') && update.mutate({ igId: a.igId, patch: { clientName: e.target.value } })} /></td>
            <td><ClientLogoCell igId={a.igId} has={!!logoFlags.data?.[a.igId]} /></td>
            <td><div className="flex gap-1">{SERIES_COLORS.map((c) => <button key={c} className="w-4 h-4 rounded-full border" style={{ background: c, borderColor: a.color === c ? 'var(--ink-1)' : 'transparent' }} onClick={() => update.mutate({ igId: a.igId, patch: { color: c } })} aria-label={c} />)}</div></td>
            <td><div className="flex flex-wrap gap-1">{(tags.data ?? []).map((tg) => <TagChip key={tg.id} small name={tg.name} color={tg.color} active={a.tagIds.includes(tg.id)} onClick={() => setTags.mutate({ igId: a.igId, tagIds: a.tagIds.includes(tg.id) ? a.tagIds.filter((x) => x !== tg.id) : [...a.tagIds, tg.id] })} />)}</div></td>
            <td className="text-ink-2">{fmtRelative(a.lastSyncedAt)}</td>
            <td><Toggle checked={a.isTracked} onChange={(v) => update.mutate({ igId: a.igId, patch: { isTracked: v } })} /></td>
          </tr>
        ))}</tbody>
      </table></div>
    </Section>
  );
}

function AdAccountsSection() {
  const t = useT();
  const ads = useAdAccounts();
  const accounts = useAccounts();
  const link = useApiMutation<{ actId: string; igId: string }>((p) => api.ads.link(p), ['adAccounts', 'blended', 'portfolio']);
  const track = useApiMutation<{ actId: string; tracked: boolean }>((p) => api.ads.setTracked(p), ['adAccounts', 'portfolio']);
  return (
    <Section title={`${t('ad_account')} · ${ads.data?.length ?? 0}`}>
      <div id="ads" className="-m-4 max-h-80 overflow-auto"><table className="table">
        <thead><tr><th>{t('ad_account')}</th><th>{t('currency')}</th><th>{t('status')}</th><th>{t('linked_account')}</th><th>{t('last_sync')}</th><th>{t('tracked')}</th></tr></thead>
        <tbody>{(ads.data ?? []).map((ad) => (
          <tr key={ad.actId}><td>{ad.name}<span className="text-ink-2 text-xs ml-2">{ad.actId}</span></td><td>{ad.currency}</td><td><span className={`badge ${ad.status === 'ACTIVE' ? 'badge-pos' : 'badge-muted'}`}>{ad.status}</span></td>
            <td><select className="input h-7 text-xs w-48" value={ad.linkedIgId ?? ''} onChange={(e) => link.mutate({ actId: ad.actId, igId: e.target.value })}><option value="">—</option>{(accounts.data ?? []).map((a) => <option key={a.igId} value={a.igId}>@{a.username}</option>)}</select></td>
            <td className="text-ink-2">{ad.lastDate ?? '—'}</td><td><Toggle checked={ad.isTracked} onChange={(v) => track.mutate({ actId: ad.actId, tracked: v })} /></td></tr>
        ))}</tbody>
      </table></div>
    </Section>
  );
}

function TagsSection() {
  const t = useT();
  const tags = useTags();
  const [name, setName] = useState('');
  const [color, setColor] = useState(SERIES_COLORS[0]);
  const create = useApiMutation<{ name: string; color: string }>((p) => api.tags.create(p), ['tags']);
  const del = useApiMutation<number>((id) => api.tags.delete(id), ['tags', 'accounts']);
  return (
    <Section title={t('tags')}>
      <div className="flex flex-wrap gap-2 mb-3">{(tags.data ?? []).map((tg) => <span key={tg.id} className="chip"><span className="w-2 h-2 rounded-full" style={{ background: tg.color }} />{tg.name} · {tg.count}<button className="ml-1 text-ink-2 hover:text-neg" onClick={() => del.mutate(tg.id)} aria-label={t('delete')}>✕</button></span>)}</div>
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { create.mutate({ name: name.trim(), color }); setName(''); } }}>
        <input className="input w-56" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('tags')} />
        <div className="flex gap-1">{SERIES_COLORS.map((c) => <button type="button" key={c} className="w-5 h-5 rounded-full border-2" style={{ background: c, borderColor: color === c ? 'var(--ink-1)' : 'transparent' }} onClick={() => setColor(c)} aria-label={c} />)}</div>
        <button className="btn" type="submit">{t('add')}</button>
      </form>
    </Section>
  );
}

function CsvExport() {
  const t = useT();
  const [queries, setQueries] = useState<string[]>([]);
  const [q, setQ] = useState('media');
  useEffect(() => { call<string[]>(api.export.csvQueries()).then(setQueries).catch(() => {}); }, []);
  return (
    <span className="inline-flex items-center gap-1">
      <select className="input w-44" value={q} onChange={(e) => setQ(e.target.value)}>{queries.map((k) => <option key={k} value={k}>{k}</option>)}</select>
      <button className="btn" onClick={() => api.export.csv({ query: q })}>{t('csv_export')}</button>
    </span>
  );
}

function SqlConsole() {
  const t = useT();
  const [sql, setSql] = useState('SELECT username, client_name FROM accounts WHERE is_tracked = 1 LIMIT 20');
  const [res, setRes] = useState<{ columns: string[]; rows: Record<string, unknown>[]; total: number; truncated: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null);
    try { setRes(await call(api.sql.run(sql, 200))); } catch (e) { setErr((e as Error).message); setRes(null); }
  };
  return (
    <Section title={t('sql_console')} right={<><button className="btn btn-sm" onClick={() => api.export.csv({ query: null, sql })} disabled={!res}>{t('csv_export')}</button>{res && <ExcelButton name="sql" getData={() => ({ name: 'SQL', columns: res.columns.map((c) => ({ key: c, label: c, type: (res.rows.every((r) => r[c] == null || typeof r[c] === 'number') ? 'float' : 'text') as 'float' | 'text' })), rows: res.rows })} />}</>}>
      <textarea className="input font-mono text-xs" rows={3} value={sql} onChange={(e) => setSql(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); }} />
      <div className="flex items-center gap-2 mt-2"><button className="btn btn-primary btn-sm" onClick={run}>{t('run_query')}</button><span className="text-xs text-ink-2">SELECT only · ⌘/Ctrl+Enter</span>{err && <span className="text-xs text-neg">{err}</span>}{res && <span className="text-xs text-ink-2 num">{t('rows_n', { n: res.total })}{res.truncated ? ` ${t('first_n', { n: 200 })}` : ''}</span>}</div>
      {res && <div className="mt-3 max-h-72 overflow-auto border border-line rounded"><table className="table"><thead><tr>{res.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{res.rows.map((r, i) => <tr key={i}>{res.columns.map((c) => <td key={c} className="max-w-[240px] truncate">{String(r[c] ?? '')}</td>)}</tr>)}</tbody></table></div>}
    </Section>
  );
}

function SyncHistorySection() {
  const t = useT();
  const h = useSyncHistory();
  const [errors, setErrors] = useState<{ id: number; username: string | null; endpoint: string; code: number; message: string; at: number }[]>([]);
  useEffect(() => { call<typeof errors>(api.sync.errors({ limit: 30 })).then(setErrors).catch(() => {}); }, [h.data]);
  return (
    <Section title={t('sync_history')} right={<ExcelButton name="sync-history" getData={() => ({ name: t('sync_history'), columns: [{ key: 'startedAt', label: t('date'), type: 'datetime' }, { key: 'finishedAt', label: t('finished_at'), type: 'datetime' }, { key: 'scope', label: t('sync_settings'), type: 'text' }, { key: 'status', label: t('status'), type: 'text' }, { key: 'accountsDone', label: t('accounts'), type: 'int' }, { key: 'accountsTotal', label: t('total'), type: 'int' }, { key: 'apiCalls', label: t('api_calls'), type: 'int' }, { key: 'errorCount', label: t('sync_errors'), type: 'int' }, { key: 'errorSummary', label: t('summary'), type: 'text' }], rows: h.data ?? [] })} />}>
      <div className="grid grid-cols-2 gap-4">
        <div className="max-h-64 overflow-auto"><table className="table"><thead><tr><th>{t('date')}</th><th>{t('sync_settings')}</th><th>{t('status')}</th><th className="num">{t('accounts')}</th><th className="num">{t('api_calls')}</th></tr></thead>
          <tbody>{(h.data ?? []).map((r) => <tr key={r.id}><td>{fmtDateTime(r.startedAt)}</td><td>{r.scope}</td><td><span className={`badge ${r.status === 'ok' ? 'badge-pos' : r.status === 'partial' ? 'badge-warn' : 'badge-neg'}`}>{r.status}</span></td><td className="num">{r.accountsDone}/{r.accountsTotal}</td><td className="num">{fmtNum(r.apiCalls)}</td></tr>)}</tbody></table></div>
        <div className="max-h-64 overflow-auto text-xs"><div className="text-ink-2 mb-1">{t('sync_errors')}</div>{errors.length === 0 ? <div className="text-ink-2">{t('none')}</div> : errors.map((e) => <div key={e.id} className="border-b border-line py-1"><span className="text-neg">#{e.code}</span> {e.username ? `@${e.username}` : ''} <span className="text-ink-2">{e.endpoint}</span><div className="text-ink-2 truncate">{e.message}</div></div>)}</div>
      </div>
    </Section>
  );
}

function TransferSection() {
  const t = useT();
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<TransferInfo | null>(null);
  const [importPass, setImportPass] = useState('');
  const doExport = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await call<{ canceled?: boolean; filePath?: string; secretsKept: number; secretsDropped: number; accounts: number; media: number }>(api.transfer.export({ passphrase: pass || null })); if (!r.canceled) setMsg(`${t('transfer_done_export')}: ${r.filePath} · ${r.accounts} ${t('accounts').toLowerCase()}, ${r.media} ${t('posts').toLowerCase()}, ${r.secretsKept} ${t('transfer_secrets_kept')}${r.secretsDropped ? `, ${r.secretsDropped} ${t('transfer_secrets_dropped')}` : ''}`); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const doPick = async () => { setErr(null); setMsg(null); try { setPicked(await call<TransferInfo | null>(api.transfer.pick())); } catch (e) { setErr((e as Error).message); } };
  const doImport = async () => {
    if (!picked || !confirm(t('transfer_confirm'))) return;
    setBusy(true); setErr(null);
    try { await call(api.transfer.import({ filePath: picked.filePath, passphrase: importPass || null })); setMsg(t('transfer_done_import')); setTimeout(() => window.location.reload(), 1200); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Section title={t('transfer')}>
      <div className="text-xs text-ink-2 mb-3">{t('transfer_hint')}</div>
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <div className="font-medium text-sm">{t('transfer_export')}</div>
          <input className="input" type="password" placeholder={t('transfer_passphrase')} value={pass} onChange={(e) => setPass(e.target.value)} />
          <button className="btn btn-primary" disabled={busy} onClick={doExport}>{t('transfer_export')}</button>
        </div>
        <div className="space-y-2">
          <div className="font-medium text-sm">{t('transfer_import')}</div>
          <button className="btn" disabled={busy} onClick={doPick}>{t('transfer_pick')}</button>
          {picked && (
            <div className="panel p-3 text-xs space-y-1">
              <div className="font-medium text-sm truncate" title={picked.filePath}>{picked.filePath.split('/').pop()}</div>
              <div className="text-ink-2">{t('file_contents')}: {picked.accounts} {t('accounts').toLowerCase()} · {picked.media} {t('posts').toLowerCase()} · {picked.adAccounts} {t('ad_account').toLowerCase()} · {picked.adRows} {t('ad_rows')} · {picked.stories} {t('type_story').toLowerCase()} · {picked.notes} {t('notes').toLowerCase()} · {(picked.size / 1048576).toFixed(1)} MB{picked.meta ? ` · ${fmtDateTime(picked.meta.exportedAt)} (${picked.meta.host}, v${picked.meta.appVersion})` : ''}</div>
              {picked.needsPassphrase && <input className="input" type="password" placeholder={t('transfer_passphrase_req')} value={importPass} onChange={(e) => setImportPass(e.target.value)} />}
              <button className="btn btn-danger" disabled={busy || (picked.needsPassphrase && !importPass)} onClick={doImport}>{t('transfer_import')}</button>
            </div>
          )}
        </div>
      </div>
      {msg && <div className="text-xs text-pos mt-3">{msg}</div>}
      {err && <div className="text-xs text-neg mt-3">{err}</div>}
    </Section>
  );
}

function SystemInfo() {
  const t = useT();
  const [info, setInfo] = useState<{ version: string; electron: string; dbPath: string; userData: string; platform: string } | null>(null);
  useEffect(() => { call<typeof info>(api.system.info()).then(setInfo).catch(() => {}); }, []);
  if (!info) return null;
  return (
    <Section title={t('about')}>
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="text-lg font-semibold">MetaDash <span className="text-ink-2 font-normal text-sm num">v{info.version}</span></div>
          <div className="text-sm text-ink-2 mt-1 max-w-xl">{t('about_text')}</div>
          <div className="text-sm mt-3">{t('developed_by')}: <strong>Bahadır Şahin</strong> · © 2026 · <button className="text-accent hover:underline bg-transparent border-0 p-0 cursor-pointer" onClick={() => api.system.openExternal('https://bahadirsahin.com')}>bahadirsahin.com</button></div>
        </div>
        <div className="text-xs text-ink-2 num text-right space-y-0.5">
          <div>Electron {info.electron} · {info.platform}</div>
          <div className="flex items-center justify-end gap-1">DB: <span className="max-w-[320px] truncate inline-block align-bottom">{info.dbPath}</span><button className="btn btn-ghost btn-sm" onClick={() => api.system.revealFile(info.dbPath)}>↗</button></div>
        </div>
      </div>
      <UpdatesPanel version={info.version} />
    </Section>
  );
}
