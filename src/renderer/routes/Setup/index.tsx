import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSetupState, useTags, useAccounts } from '@/hooks/queries';
import { useAppStore } from '@/store/app';
import { useT } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import type { TokenHealth, AdAccount } from '@/lib/types';
import { CopyButton, Avatar, Spinner } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { useRunSync } from '@/hooks/useSyncEvents';
import { FacebookPagesList, saveFacebookPages, useFacebookPages } from './FacebookPages';
import { ThreadsConnect } from './ThreadsConnect';

/** Welcome, Meta app, token, accounts (+ optional Facebook Pages), ad accounts, Threads (optional), first sync. */
const STEPS = 7;
const GRAPH_EXPLORER = 'https://developers.facebook.com/tools/explorer/';
const DEV_PORTAL = 'https://developers.facebook.com/apps/';

interface Discovered { pageId: string | null; pageName: string; ig: { igId: string; username: string; name: string | null; profilePicUrl: string | null; followers: number | null; color?: string | null; clientName?: string | null; tagIds?: number[] } | null; tracked: boolean; known: boolean; sources?: string[]; noPage?: boolean }
interface Discovery { items: Discovered[]; warnings: { endpoint: string; code: number | null; message: string; business?: string }[]; businesses: { id: string; name: string }[] }

export function SetupPage() {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const state = useSetupState();
  const [step, setStep] = useState(clampStep(Number(params.get('step') ?? 1)));
  useEffect(() => {
    const p = params.get('step');
    if (p) setStep(clampStep(Number(p)));
    else if (state.data && !state.data.complete) setStep(clampStep(state.data.step + 1));
  }, [state.data, params]);
  // Persisted `setupStep` is 0-based from Welcome (0 = Welcome … 5 = Threads, 6 = First sync), so wizard step n ↔ n - 1.
  // Main bumps it to 5 after the accounts step is saved, which now resumes at the optional Threads step (wizard 6).
  const go = (n: number) => { setStep(n); api.setup.setStep(Math.max(0, n - 1)); };
  const titles = [t('step_welcome'), t('step_app'), t('step_token'), t('step_accounts'), t('step_ad_accounts'), t('step_threads'), t('step_first_sync')];

  return (
    <div className="h-full flex bg-surface-0">
      <aside className="w-64 border-r border-line bg-surface-1 p-6 flex flex-col">
        <div className="drag h-8 -mt-6 mb-4" />
        <div className="font-semibold text-lg mb-6">MetaDash</div>
        <ol className="space-y-1">{titles.map((title, i) => (
          <li key={title}><button className={`nav-item w-full ${step === i + 1 ? 'active' : ''}`} onClick={() => go(i + 1)}><span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center flex-none ${step > i + 1 ? 'bg-pos text-white' : step === i + 1 ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2'}`}>{step > i + 1 ? '✓' : i + 1}</span>{title}</button></li>
        ))}</ol>
        <div className="flex-1" />
        {state.data?.complete && <button className="btn" onClick={() => nav('/')}>{t('nav_overview')} →</button>}
        {state.data && !state.data.complete && <DemoShortcut onDone={() => { qc.invalidateQueries(); nav('/'); }} />}
      </aside>
      <main className="flex-1 overflow-auto p-10">
        <div className="max-w-3xl">
          <div className="text-xs text-ink-2 mb-1">{t('setup_step')} {step} / {STEPS}</div>
          <h1 className="text-xl font-semibold m-0 mb-6">{titles[step - 1]}</h1>
          {step === 1 && <Welcome onNext={() => go(2)} complete={!!state.data?.complete} onDemo={() => { qc.invalidateQueries(); nav('/'); }} />}
          {step === 2 && <AppStep initialAppId={state.data?.appId ?? ''} onNext={() => go(3)} onBack={() => go(1)} />}
          {step === 3 && <TokenStep required={state.data?.requiredScopes ?? []} optional={state.data?.optionalScopes ?? []} onNext={() => go(4)} onBack={() => go(2)} />}
          {step === 4 && <AccountsStep onNext={() => go(5)} onBack={() => go(3)} />}
          {step === 5 && <AdAccountsStep onNext={() => go(6)} onBack={() => go(4)} />}
          {step === 6 && <ThreadsStep onNext={() => go(7)} onBack={() => go(5)} />}
          {step === 7 && <FirstSyncStep onDone={() => { qc.invalidateQueries(); nav('/'); }} onBack={() => go(6)} />}
        </div>
      </main>
    </div>
  );
}

function clampStep(n: number): number {
  return Math.min(STEPS, Math.max(1, Math.trunc(n) || 1));
}

function GuideBox() {
  const t = useT();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="panel p-3 flex items-center justify-between gap-3" style={{ background: 'var(--accent-soft)' }}>
      <div className="text-xs text-ink-2">{t('guide_hint')}</div>
      <div className="flex flex-col items-end gap-1"><button className="btn btn-sm" onClick={async () => { setErr(null); try { await call(api.system.openGuide()); } catch (e) { setErr((e as Error).message); } }}>{t('open_guide')}</button>{err && <span className="text-xs text-neg">{err}</span>}</div>
    </div>
  );
}

function Nav({ onBack, onNext, nextLabel, disabled }: { onBack?: () => void; onNext?: () => void; nextLabel?: string; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between pt-6 mt-6 border-t border-line">
      <div>{onBack && <button className="btn" onClick={onBack}>{t('back')}</button>}</div>
      <div>{onNext && <button className="btn btn-primary" onClick={onNext} disabled={disabled}>{nextLabel ?? t('next')}</button>}</div>
    </div>
  );
}

function Welcome({ onNext, complete, onDemo }: { onNext: () => void; complete: boolean; onDemo: () => void }) {
  const t = useT();
  const setDemo = useAppStore((s) => s.setDemo);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const loadDemo = async () => {
    setBusy(true); setErr(null);
    try { await call(api.setup.loadDemo({ reset: false })); setDemo(true); onDemo(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4 text-base leading-relaxed">
      <p>{t('welcome_intro')}</p>
      <ul className="list-disc pl-5 space-y-1 text-sm">
        <li><strong>{t('welcome_time_title')}</strong> {t('welcome_time')}</li>
        <li><strong>{t('welcome_local_title')}</strong> {t('welcome_local')}</li>
        <li><strong>{t('welcome_nosub_title')}</strong> {t('welcome_nosub')}</li>
      </ul>
      <p className="text-sm text-ink-2">{t('welcome_prereq')}</p>
      {!complete && (
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button className="panel p-4 text-left hover:border-accent" onClick={onNext}><div className="font-semibold mb-1">{t('welcome_connect_title')}</div><div className="text-sm text-ink-2">{t('welcome_connect_desc')}</div></button>
          <button className="panel p-4 text-left hover:border-accent" disabled={busy} onClick={loadDemo}><div className="font-semibold mb-1 flex items-center gap-2">{t('welcome_demo_title')}{busy && <Spinner size={12} />}</div><div className="text-sm text-ink-2">{t('welcome_demo_desc')}</div></button>
        </div>
      )}
      {err && <div className="text-sm text-neg">{err}</div>}
      <Nav onNext={onNext} />
    </div>
  );
}

function AppStep({ initialAppId, onNext, onBack }: { initialAppId: string; onNext: () => void; onBack: () => void }) {
  const t = useT();
  const [appId, setAppId] = useState(initialAppId);
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await call(api.setup.saveApp({ appId, appSecret: secret })); onNext(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const steps = [t('app_step_1'), t('app_step_2'), t('app_step_3'), t('app_step_4'), t('app_step_5')];
  return (
    <div className="space-y-4">
      <GuideBox />
      <ol className="list-decimal pl-5 space-y-1.5 text-sm">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
      <button className="btn" onClick={() => api.system.openExternal(DEV_PORTAL)}>developers.facebook.com <Icon.external /></button>
      <div className="grid grid-cols-2 gap-4">
        <label className="block"><div className="text-xs text-ink-2 mb-1">App ID</div><input className="input num" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="1234567890123456" /></label>
        <label className="block"><div className="text-xs text-ink-2 mb-1">App Secret</div><input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••••••••••" /></label>
      </div>
      <p className="text-xs text-ink-2">{t('app_secret_note')}</p>
      {err && <div className="text-neg text-sm">{err}</div>}
      <Nav onBack={onBack} onNext={save} disabled={busy || !appId || !secret} nextLabel={busy ? t('loading') : t('next')} />
    </div>
  );
}

function TokenStep({ required, optional, onNext, onBack }: { required: string[]; optional: string[]; onNext: () => void; onBack: () => void }) {
  const t = useT();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [health, setHealth] = useState<TokenHealth | null>(null);
  const scopes = [...required, ...optional].join(',');
  const exchange = async () => {
    setBusy(true); setErr(null);
    try { setHealth(await call<TokenHealth>(api.setup.exchangeToken({ shortToken: token }))); } catch (e) { setErr((e as Error).message + ((e as { hint?: string }).hint ? ` — ${(e as { hint?: string }).hint}` : '')); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <ol className="list-decimal pl-5 space-y-1.5 text-sm">
        <li>{t('token_step_1')}</li>
        <li>{t('token_step_2')}</li>
        <li>{t('token_step_3')}</li>
        <li>{t('token_step_4')}</li>
      </ol>
      <GuideBox />
      <p className="text-xs text-ink-2 m-0">{t('read_insights_note')}</p>
      <div className="flex items-center gap-2"><button className="btn" onClick={() => api.system.openExternal(GRAPH_EXPLORER)}>Graph API Explorer <Icon.external /></button><code className="text-xs bg-surface-2 px-2 py-1 rounded flex-1 truncate">{scopes}</code><CopyButton text={scopes} /></div>
      <label className="block"><div className="text-xs text-ink-2 mb-1">{t('short_token')}</div><textarea className="input font-mono text-xs" rows={3} value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAB..." /></label>
      <button className="btn btn-primary" onClick={exchange} disabled={busy || token.length < 20}>{busy ? <><Spinner size={12} /> {t('loading')}</> : t('exchange_verify')}</button>
      {err && <div className="text-neg text-sm">{err}</div>}
      {health && (
        <div className="panel p-4 space-y-2">
          <div className={health.valid ? 'text-pos' : 'text-neg'}>{health.valid ? t('token_valid') : t('token_invalid')} {health.daysLeft != null && <span className="text-ink-2">· {health.daysLeft} {t('days_left')}</span>}</div>
          <div className="grid grid-cols-2 gap-1 text-sm">{required.map((s) => <div key={s} className={health.scopes.includes(s) ? 'text-pos' : 'text-neg'}>{health.scopes.includes(s) ? '✓' : '✕'} {s}</div>)}{optional.map((s) => <div key={s} className={health.scopes.includes(s) ? 'text-pos' : 'text-ink-2'}>{health.scopes.includes(s) ? '✓' : '○'} {s} <span className="text-xs">({s === 'read_insights' ? `${t('optional')} · ${t('needed_for_fb')}` : t('optional')})</span></div>)}</div>
          {health.missingScopes.length > 0 && <div className="text-warn text-sm">{t('missing_scopes', { s: health.missingScopes.join(', ') })}</div>}
        </div>
      )}
      <Nav onBack={onBack} onNext={onNext} disabled={!health?.valid} />
    </div>
  );
}

function AccountsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const t = useT();
  const tags = useTags();
  const [list, setList] = useState<Discovered[] | null>(null);
  const [scan, setScan] = useState<{ warnings: Discovery['warnings']; businesses: Discovery['businesses'] }>({ warnings: [], businesses: [] });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<Record<string, { clientName: string; tags: string[] }>>({});
  const [search, setSearch] = useState('');
  const fb = useFacebookPages(false);
  const discover = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await call<Discovery | Discovered[]>(api.setup.discoverAccounts());
      fb.discover(); // Facebook Pages come from the same token; errors stay inside the optional section.
      const found = Array.isArray(res) ? res : res.items;
      setScan(Array.isArray(res) ? { warnings: [], businesses: [] } : { warnings: res.warnings ?? [], businesses: res.businesses ?? [] });
      setList(found);
      setSelected(new Set(found.filter((p) => p.ig && p.tracked).map((p) => p.ig!.igId)));
      const tagName = (id: number) => tags.data?.find((tg) => tg.id === id)?.name;
      setMeta(Object.fromEntries(found.filter((p) => p.ig).map((p) => [p.ig!.igId, { clientName: p.ig!.clientName ?? '', tags: (p.ig!.tagIds ?? []).map(tagName).filter((n): n is string => !!n) }])));
    } catch (e) { setErr((e as Error).message + ((e as { hint?: string }).hint ? ` — ${(e as { hint?: string }).hint}` : '')); } finally { setBusy(false); }
  };
  useEffect(() => { discover(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const withIg = useMemo(() => (list ?? []).filter((p) => p.ig && (!search || p.ig.username.includes(search.toLowerCase()) || p.pageName.toLowerCase().includes(search.toLowerCase()))), [list, search]);
  const withoutIg = (list ?? []).filter((p) => !p.ig);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    setBusy(true);
    try {
      await call(api.setup.saveTrackedAccounts([...selected], Object.fromEntries([...selected].map((id) => [id, meta[id] ?? { clientName: '', tags: [] }]))));
      // After IG, so client names/tags of linked Instagram accounts can be copied onto ticked Pages.
      if (fb.data) await saveFacebookPages(fb);
      onNext();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{t('accounts_intro')}</p>
      <div className="flex items-center gap-2">
        <button className="btn" onClick={discover} disabled={busy}>{busy ? <Spinner size={12} /> : <Icon.refresh />} {t('discover_again')}</button>
        <input className="input w-56" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-sm" onClick={() => setSelected(new Set(withIg.map((p) => p.ig!.igId)))}>{t('select_all')}</button>
        <button className="btn btn-sm" onClick={() => setSelected(new Set())}>{t('clear')}</button>
        <span className="text-xs text-ink-2 num ml-auto">{selected.size} / {withIg.length}</span>
      </div>
      {err && <div className="text-neg text-sm">{err}</div>}
      {busy && !list && <div className="py-10 text-center text-ink-2"><Spinner /></div>}
      {list && (
        <div className="panel p-3 space-y-2 text-xs">
          <div className="text-ink-2 num">{t('discovery_summary', { p: list.filter((p) => p.pageId).length, i: withIg.length, b: scan.businesses.length })}{scan.businesses.length ? ` · ${scan.businesses.map((b) => b.name).join(', ')}` : ''}</div>
          {scan.warnings.length > 0 && <details><summary className="text-warn cursor-pointer">{t('discovery_warnings')} ({scan.warnings.length})</summary><ul className="m-0 pl-4 mt-1 space-y-0.5 text-ink-2">{scan.warnings.map((w, i) => <li key={i}><code>{w.endpoint}</code>{w.code ? ` #${w.code}` : ''} — {w.message}</li>)}</ul></details>}
          <details><summary className="cursor-pointer font-medium text-ink-1">{t('missing_accounts_title')}</summary><p className="m-0 mt-1 text-ink-2 leading-relaxed">{t('missing_accounts_text')}</p><div className="mt-2"><GuideBox /></div></details>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {withIg.map((p) => { const ig = p.ig!; const on = selected.has(ig.igId); return (
          <div key={ig.igId} className={`panel p-3 ${on ? 'border-accent' : ''}`}>
            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={on} onChange={() => toggle(ig.igId)} /><Avatar username={ig.username} url={ig.profilePicUrl} color={ig.color} size={32} /><div className="min-w-0"><div className="font-medium truncate">@{ig.username}{p.noPage && <span className="badge badge-warn ml-2" title={t('no_page_hint')}>{t('no_page_badge')}</span>}</div><div className="text-xs text-ink-2 truncate" title={(p.sources ?? []).join(' · ')}>{p.pageName} · {fmtNum(ig.followers)} {t('followers').toLowerCase()}</div></div></label>
            {on && (
              <div className="mt-2 space-y-1.5">
                <input className="input h-7 text-xs" placeholder={t('client')} value={meta[ig.igId]?.clientName ?? ''} onChange={(e) => setMeta({ ...meta, [ig.igId]: { ...(meta[ig.igId] ?? { tags: [] }), clientName: e.target.value } })} />
                <div className="flex flex-wrap gap-1">{(tags.data ?? []).map((tg) => { const has = meta[ig.igId]?.tags.includes(tg.name); return <button key={tg.id} className={`chip h-5 text-[11px] px-1.5 ${has ? 'active' : ''}`} onClick={() => setMeta({ ...meta, [ig.igId]: { clientName: meta[ig.igId]?.clientName ?? '', tags: has ? meta[ig.igId].tags.filter((x) => x !== tg.name) : [...(meta[ig.igId]?.tags ?? []), tg.name] } })}>{tg.name}</button>; })}
                  <input className="input h-5 text-[11px] w-24 px-1.5" placeholder={`+ ${t('tags').toLowerCase()}`} onKeyDown={(e) => { if (e.key === 'Enter' && e.currentTarget.value.trim()) { setMeta({ ...meta, [ig.igId]: { clientName: meta[ig.igId]?.clientName ?? '', tags: [...(meta[ig.igId]?.tags ?? []), e.currentTarget.value.trim()] } }); e.currentTarget.value = ''; } }} /></div>
              </div>
            )}
          </div>
        ); })}
        {withoutIg.map((p) => (
          <div key={p.pageId} className="panel p-3 opacity-50"><div className="font-medium">{p.pageName}</div><div className="text-xs text-warn">{t('page_without_ig')}</div></div>
        ))}
      </div>
      {list && (
        <section className="pt-4 mt-2 border-t border-line space-y-2">
          <h2 className="text-base font-semibold m-0">{t('fb_pages_title')}</h2>
          <p className="text-xs text-ink-2 m-0">{t('fb_pages_intro')}</p>
          <FacebookPagesList state={fb} />
        </section>
      )}
      <Nav onBack={onBack} onNext={save} disabled={busy || selected.size === 0} nextLabel={`${t('save')} (${selected.size})`} />
    </div>
  );
}

function AdAccountsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const t = useT();
  const accounts = useAccounts();
  const [list, setList] = useState<AdAccount[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const discover = async () => {
    setBusy(true); setErr(null);
    try { setList(await call<AdAccount[]>(api.setup.discoverAdAccounts())); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { discover(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{t('ad_accounts_intro')}</p>
      {err && <div className="text-neg text-sm">{err}</div>}
      {busy && !list && <div className="py-10 text-center"><Spinner /></div>}
      {list && (
        <div className="panel overflow-auto max-h-[420px]"><table className="table"><thead><tr><th>{t('ad_account')}</th><th>{t('currency')}</th><th>{t('status')}</th><th>{t('linked_account')}</th></tr></thead>
          <tbody>{list.map((ad) => <tr key={ad.actId}><td>{ad.name}<span className="text-ink-2 text-xs ml-2">{ad.actId}</span></td><td>{ad.currency}</td><td>{ad.status}</td><td><select className="input h-7 text-xs w-52" value={ad.linkedIgId ?? ''} onChange={async (e) => setList(await call<AdAccount[]>(api.setup.linkAdAccount({ actId: ad.actId, igId: e.target.value })))}><option value="">—</option>{(accounts.data ?? []).map((a) => <option key={a.igId} value={a.igId}>@{a.username}</option>)}</select></td></tr>)}
          {list.length === 0 && <tr><td colSpan={4} className="text-center text-ink-2">{t('none')}</td></tr>}</tbody></table></div>
      )}
      <Nav onBack={onBack} onNext={onNext} nextLabel={t('continue')} />
    </div>
  );
}

function ThreadsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const t = useT();
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{t('threads_intro')}</p>
      <ThreadsConnect />
      <div className="flex items-center justify-between pt-6 mt-6 border-t border-line">
        <button className="btn" onClick={onBack}>{t('back')}</button>
        <div className="flex gap-2"><button className="btn btn-ghost" onClick={onNext}>{t('skip')}</button><button className="btn btn-primary" onClick={onNext}>{t('next')}</button></div>
      </div>
    </div>
  );
}

function FirstSyncStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const t = useT();
  const { progress, sync } = useAppStore();
  const runSync = useRunSync();
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (started && !progress && sync && !sync.running) setFinished(true); }, [progress, sync, started]);
  const start = async () => {
    setErr(null);
    try { setStarted(true); await runSync({ scope: 'full' }); } catch (e) { setErr((e as Error).message); setStarted(false); }
  };
  const complete = async () => { await call(api.setup.complete()); onDone(); };
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{t('first_sync_intro')}</p>
      {!started && <button className="btn btn-primary" onClick={start}>{t('start_first_sync')}</button>}
      {err && <div className="text-neg text-sm">{err}</div>}
      {started && (
        <div className="panel p-4 space-y-3">
          <div className="h-2 bg-surface-2 rounded overflow-hidden"><div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${finished ? 100 : pct}%` }} /></div>
          <div className="flex justify-between text-sm num"><span>{progress ? `${progress.phase} · ${progress.currentAccount ?? ''}` : finished ? t('done') : t('loading')}</span><span>{progress ? `${progress.done} / ${progress.total} · ${fmtNum(progress.apiCalls)} ${t('api_calls')}` : ''}</span></div>
        </div>
      )}
      <Nav onBack={onBack} onNext={finished || sync?.lastSuccessAt ? complete : undefined} nextLabel={`${t('nav_overview')} →`} />
    </div>
  );
}

function DemoShortcut({ onDone }: { onDone: () => void }) {
  const t = useT();
  const setDemo = useAppStore((s) => s.setDemo);
  const [busy, setBusy] = useState(false);
  return (
    <div className="text-xs text-ink-2 space-y-2 pt-4 border-t border-line">
      <div>{t('demo_prompt')}</div>
      <button className="btn btn-sm w-full" disabled={busy} onClick={async () => { setBusy(true); await call(api.setup.loadDemo({ reset: false })); setDemo(true); setBusy(false); onDone(); }}>{busy ? <Spinner size={12} /> : t('load_demo')}</button>
    </div>
  );
}
