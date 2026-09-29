import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store/app';
import { useT } from '@/lib/i18n';
import { fmtRelative, fmtNum } from '@/lib/format';
import { api, call } from '@/lib/api';
import { PeriodPicker } from './PeriodPicker';
import { Icon } from './Icons';
import { Spinner } from './ui';
import { UpdateBadge } from './UpdateBadge';
import { useRunSync } from '@/hooks/useSyncEvents';
import { useSyncHistory } from '@/hooks/queries';

const NAV = [
  { to: '/', key: 'nav_overview', icon: Icon.overview, end: true },
  { to: '/content', key: 'nav_content', icon: Icon.content },
  { to: '/planner', key: 'nav_planner', icon: Icon.calendar },
  { to: '/compare', key: 'nav_compare', icon: Icon.compare },
  { to: '/ads', key: 'nav_ads', icon: Icon.ads },
  { to: '/competitors', key: 'nav_competitors', icon: Icon.competitors },
  { to: '/reports', key: 'nav_reports', icon: Icon.reports },
  { to: '/presentation', key: 'nav_presentation', icon: Icon.presentation },
  { to: '/ask', key: 'nav_ask', icon: Icon.ask },
  { to: '/studio', key: 'nav_studio', icon: Icon.studio },
] as const;

export function Layout() {
  const t = useT();
  const { sidebarCollapsed, toggleSidebar, progress, sync, online, demo, tokenWarning, setTokenWarning } = useAppStore();
  const [panelOpen, setPanelOpen] = useState(false);
  const [stale, setStale] = useState<{ suggest: boolean; lastSuccessAt: number | null } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const runSync = useRunSync();
  const loc = useLocation();
  useEffect(() => { call<{ suggest: boolean; lastSuccessAt: number | null }>(api.sync.suggest()).then(setStale).catch(() => {}); }, [sync?.lastSuccessAt]);
  const running = !!sync?.running || !!progress;
  const pct = progress && progress.total ? Math.min(100, (progress.done / progress.total) * 100) : running ? 5 : 0;
  const isPresentation = loc.pathname.startsWith('/presentation/run');
  if (isPresentation) return <Outlet />;

  return (
    <div className="flex h-full">
      <aside className={`flex flex-col border-r border-line bg-surface-1 transition-[width] ${sidebarCollapsed ? 'w-14' : 'w-56'}`}>
        <div className="drag h-12 flex items-center px-3 gap-2 pl-[80px] md:pl-3" style={{ paddingLeft: navigator.platform.startsWith('Mac') ? 80 : 12 }}>
          {!sidebarCollapsed && <span className="font-semibold text-base tracking-tight">MetaDash</span>}
        </div>
        <nav className="flex-1 px-2 space-y-0.5 pt-2">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={'end' in n && n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={t(n.key)}>
              <n.icon />{!sidebarCollapsed && <span>{t(n.key)}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="px-2 pb-3 space-y-0.5 border-t border-line pt-2">
          <NavLink to="/setup" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={t('nav_setup')}><Icon.setup />{!sidebarCollapsed && <span>{t('nav_setup')}</span>}</NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={t('nav_settings')}><Icon.settings />{!sidebarCollapsed && <span>{t('nav_settings')}</span>}</NavLink>
          <button className="nav-item w-full" onClick={toggleSidebar} aria-label="toggle sidebar"><Icon.menu />{!sidebarCollapsed && <span className="text-ink-2">{t('collapse')}</span>}</button>
          {!sidebarCollapsed && <div className="px-2 pt-2 text-[11px] text-ink-2">© 2026 Bahadır Şahin</div>}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="drag relative h-12 flex items-center justify-between px-4 border-b border-line bg-surface-1 gap-4">
          <PeriodPicker />
          <div className="no-drag flex items-center gap-2">
            <UpdateBadge />
            {!online && <span className="badge badge-warn" title={t('offline')}><Icon.warn /> offline</span>}
            {demo && <span className="badge badge-muted">{t('demo_mode')}</span>}
            <button className="btn btn-ghost btn-sm text-ink-2 num" onClick={() => setPanelOpen((o) => !o)} title={t('last_sync')}>
              {running ? <><Spinner size={12} /> {t('updating')} {progress ? `${progress.done}/${progress.total}` : ''}</> : `${t('last_sync')}: ${fmtRelative(sync?.lastSuccessAt)}`}
            </button>
            {running ? (
              <button className="btn btn-sm" onClick={() => api.sync.cancel()}>{t('cancel')}</button>
            ) : (
              <button className="btn btn-primary btn-sm" disabled={!online && !demo} onClick={() => runSync({ scope: 'full' })}><Icon.refresh />{t('update')}</button>
            )}
          </div>
          <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-transparent" aria-hidden>
            {running && <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />}
          </div>
          {panelOpen && <SyncPanel onClose={() => setPanelOpen(false)} />}
        </header>

        {tokenWarning && (
          <div className="bg-neg/15 text-neg px-4 py-2 text-sm flex items-center justify-between">
            <span>{tokenWarning.platform === 'threads' ? t('token_invalid_threads') : t('token_invalid')}{tokenWarning.message ? `: ${tokenWarning.message}` : ''}</span>
            <div className="flex gap-2">
              {tokenWarning.platform === 'threads'
                ? <NavLink to="/settings" state={{ focus: 'connections' }} className="btn btn-sm" onClick={() => setTokenWarning(null)}>{t('reconnect_threads')}</NavLink>
                : <NavLink to="/setup?step=3" className="btn btn-sm">{t('renew_token')}</NavLink>}
              <button className="btn btn-ghost btn-sm" onClick={() => setTokenWarning(null)}>✕</button>
            </div>
          </div>
        )}
        {stale?.suggest && !dismissed && !running && sync && (
          <div className="bg-accent-soft px-4 py-2 text-sm flex items-center justify-between" style={{ background: 'var(--accent-soft)' }}>
            <span>{t('sync_stale')} {stale.lastSuccessAt ? `(${fmtRelative(stale.lastSuccessAt)})` : ''}</span>
            <div className="flex gap-2"><button className="btn btn-primary btn-sm" onClick={() => { setDismissed(true); runSync({ scope: 'full' }); }}>{t('update_now')}</button><button className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)}>✕</button></div>
          </div>
        )}
        <main className="flex-1 overflow-auto p-6 min-w-0"><Outlet /></main>
      </div>
    </div>
  );
}

function SyncPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { progress, sync } = useAppStore();
  const history = useSyncHistory();
  return (
    <div className="no-drag absolute right-4 top-12 w-[420px] panel shadow-xl z-40 text-sm">
      <div className="px-4 h-10 flex items-center justify-between border-b border-line"><span className="font-medium">{t('sync_settings')}</span><button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button></div>
      <div className="p-4 space-y-2">
        {progress ? (
          <>
            <div className="flex justify-between"><span className="text-ink-2">{t('phase')}</span><span>{progress.phase}</span></div>
            <div className="flex justify-between"><span className="text-ink-2">{t('account')}</span><span>{progress.currentAccount ?? '—'}</span></div>
            <div className="flex justify-between num"><span className="text-ink-2">{t('accounts')}</span><span>{progress.done} / {progress.total}</span></div>
            <div className="flex justify-between num"><span className="text-ink-2">{t('api_calls')}</span><span>{fmtNum(progress.apiCalls)}</span></div>
            {sync?.rateLimit && sync.rateLimit.multiplier > 1 && <div className="text-warn">{t('rate_limited', { p: Math.round(sync.rateLimit.usagePct), m: sync.rateLimit.multiplier })}</div>}
          </>
        ) : (
          <div className="text-ink-2">{t('last_sync')}: {fmtRelative(sync?.lastSuccessAt)}</div>
        )}
      </div>
      <div className="border-t border-line max-h-56 overflow-auto">
        <table className="table">
          <thead><tr><th>{t('date')}</th><th>{t('sync_settings')}</th><th>{t('status')}</th><th className="num">{t('api_calls')}</th></tr></thead>
          <tbody>
            {(history.data ?? []).slice(0, 10).map((r) => (
              <tr key={r.id}><td>{fmtRelative(r.startedAt)}</td><td>{r.scope}</td><td><span className={`badge ${r.status === 'ok' ? 'badge-pos' : r.status === 'partial' ? 'badge-warn' : r.status === 'running' ? 'badge-muted' : 'badge-neg'}`}>{r.status}{r.errorCount ? ` · ${r.errorCount}` : ''}</span></td><td className="num">{fmtNum(r.apiCalls)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
