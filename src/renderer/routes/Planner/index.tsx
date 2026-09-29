import { useCallback, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { useAccounts } from '@/hooks/queries';
import { usePlatformScope } from '@/hooks/usePlatforms';
import { usePlannerEvents, usePlannerPosts, usePlannerSettings, useSuggestSlots } from '@/hooks/usePlanner';
import { PlatformFilter } from '@/components/PlatformFilter';
import { ErrorState, Tabs } from '@/components/ui';
import { PLATFORMS } from '@/lib/platforms';
import type { PlannerPostSummary, PostStatus } from '@/lib/types';
import { ToastProvider } from './Toast';
import { useCalendarDnd } from './useCalendarDnd';
import { CalendarMonth } from './CalendarMonth';
import { CalendarWeek } from './CalendarWeek';
import { UnscheduledPanel } from './UnscheduledPanel';
import { RescheduleDialog } from './RescheduleDialog';
import { ListView } from './ListView';
import { QueueView } from './QueueView';
import { ApprovalsView } from './ApprovalsView';
import { AuditLog } from './AuditLog';
import { ComposerDrawer } from './Composer/ComposerDrawer';
import type { ComposerSeed } from './Composer/state';
import { addDays, fmtDayTitle, fmtMonthTitle, monthGrid, startOfDay, weekDays } from './lib';

type Tab = 'calendar' | 'list' | 'queue' | 'approvals' | 'log';
type View = 'month' | 'week';
const TABS: Tab[] = ['calendar', 'list', 'queue', 'approvals', 'log'];
const UNSCHEDULED_STATUSES: PostStatus[] = ['draft', 'in_review', 'changes_requested', 'approved'];

/** Route state accepted from other screens (e.g. PostDrawer "Duplicate as draft"). */
interface PlannerLocationState { draft?: ComposerSeed }

export function PlannerPage() {
  return <ToastProvider><PlannerScreen /></ToastProvider>;
}

/** /planner — reads ?tab=&post=&missed=&view=&date= (deep links from notifications and the tray). */
function PlannerScreen() {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { missed, clearMissed } = usePlannerEvents();
  const settings = usePlannerSettings();
  const platforms = usePlatformScope();
  const accountsQ = useAccounts({ onlyTracked: true });
  const [accountId, setAccountId] = useState<string>('');
  const [rescheduling, setRescheduling] = useState<PlannerPostSummary | null>(null);
  const [seed, setSeed] = useState<ComposerSeed | undefined>(() => (location.state as PlannerLocationState | null)?.draft);
  const dnd = useCalendarDnd();

  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'calendar';
  const view: View = params.get('view') === 'week' ? 'week' : 'month';
  const dateParam = params.get('date');
  const anchor = useMemo(() => {
    const d = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
    return Number.isFinite(d.getTime()) ? startOfDay(d.getTime()) : startOfDay(Date.now());
  }, [dateParam]);
  const postParam = params.get('post');
  const composerId = postParam && /^\d+$/.test(postParam) ? Number(postParam) : null;
  const composerOpen = composerId != null || postParam === 'new' || !!seed;

  const update = useCallback((patch: Record<string, string | null>) => {
    setParams((cur) => {
      const next = new URLSearchParams(cur);
      for (const [k, v] of Object.entries(patch)) { if (v == null) next.delete(k); else next.set(k, v); }
      return next;
    }, { replace: true });
  }, [setParams]);

  const openPost = useCallback((id: number) => { setSeed(undefined); update({ post: String(id) }); }, [update]);
  const newPost = useCallback((at?: number) => { setSeed(at != null ? { scheduledAt: at, accountIds: accountId ? [accountId] : [] } : accountId ? { accountIds: [accountId] } : undefined); update({ post: 'new' }); }, [update, accountId]);
  const closeComposer = useCallback(() => { setSeed(undefined); update({ post: null }); }, [update]);

  const range = useMemo(() => {
    const days = view === 'month' ? monthGrid(anchor, settings.weekStartsOn) : weekDays(anchor, settings.weekStartsOn);
    return { from: days[0].getTime(), to: addDays(days[days.length - 1], 1).getTime(), days };
  }, [anchor, view, settings.weekStartsOn]);
  const accountIds = useMemo(() => (accountId ? [accountId] : []), [accountId]);
  const filters = useMemo(() => ({ ...(accountIds.length ? { accountIds } : {}), ...(platforms.length ? { platforms } : {}) }), [accountIds, platforms]);
  const calQ = usePlannerPosts({ from: range.from, to: range.to, ...filters }, tab === 'calendar');
  const unschedQ = usePlannerPosts({ statuses: UNSCHEDULED_STATUSES, ...filters }, tab === 'calendar');
  const unscheduled = useMemo(() => (unschedQ.data ?? []).filter((p) => p.scheduledAt == null), [unschedQ.data]);
  const slotsQ = useSuggestSlots(accountIds, tab === 'calendar' && view === 'week' && accountIds.length === 1);

  const step = (dir: -1 | 1) => {
    const d = view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1) : addDays(anchor, 7 * dir);
    update({ date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` });
  };
  const rangeTitle = view === 'month' ? fmtMonthTitle(anchor, lang) : `${fmtDayTitle(range.days[0], lang)} – ${fmtDayTitle(range.days[6], lang)}`;
  const accounts = useMemo(() => [...(accountsQ.data ?? [])].sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform) || a.username.localeCompare(b.username)), [accountsQ.data]);
  const showMissed = missed > 0 && tab !== 'queue';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold mr-2">{t('nav_planner')}</h1>
        <select className="input w-56" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label={t('pl_account_filter')}>
          <option value="">{t('pl_all_accounts')}</option>
          {accounts.map((a) => <option key={a.igId} value={a.igId}>{a.platform === 'instagram' ? '' : `${a.platform === 'facebook' ? 'FB' : 'Threads'} · `}@{a.username}</option>)}
        </select>
        <PlatformFilter />
        <span className="flex-1" />
        <button type="button" className="btn btn-primary" onClick={() => newPost()}>+ {t('pl_new_post')}</button>
      </div>

      {showMissed && (
        <div className="panel px-4 py-2 text-sm flex items-center gap-3" style={{ borderColor: 'var(--warn)' }} role="alert">
          <span className="flex-1 text-warn">{t('pl_missed_title', { n: missed })}</span>
          <button type="button" className="btn btn-sm" onClick={() => { clearMissed(); update({ tab: 'queue', missed: '1' }); }}>{t('pl_review_missed')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearMissed} aria-label={t('close')}>✕</button>
        </div>
      )}

      <Tabs<Tab>
        tabs={TABS.map((id) => ({ id, label: t(`pl_tab_${id}`) }))}
        value={tab}
        onChange={(id) => update({ tab: id === 'calendar' ? null : id, missed: null })}
      />

      {tab === 'calendar' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="group" aria-label={t('pl_view')}>
              <button type="button" className={`chip ${view === 'month' ? 'active' : ''}`} aria-pressed={view === 'month'} onClick={() => update({ view: null })}>{t('pl_view_month')}</button>
              <button type="button" className={`chip ${view === 'week' ? 'active' : ''}`} aria-pressed={view === 'week'} onClick={() => update({ view: 'week' })}>{t('pl_view_week')}</button>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => step(-1)} aria-label={t('pl_prev')}>‹</button>
            <button type="button" className="btn btn-sm" onClick={() => update({ date: null })}>{t('pl_today')}</button>
            <button type="button" className="btn btn-sm" onClick={() => step(1)} aria-label={t('pl_next')}>›</button>
            <span className="font-medium ml-1 capitalize" aria-live="polite">{rangeTitle}</span>
            <span className="flex-1" />
            <span className="text-xs text-ink-2">{t('pl_dnd_hint')}</span>
          </div>
          {calQ.error ? <ErrorState error={calQ.error} /> : (
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
              {view === 'month'
                ? <CalendarMonth anchor={anchor} weekStartsOn={settings.weekStartsOn} posts={calQ.data ?? []} dnd={dnd} onOpen={openPost} onReschedule={setRescheduling}
                    onShowWeek={(d) => update({ view: 'week', date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })} onNewAt={newPost} />
                : <CalendarWeek anchor={anchor} weekStartsOn={settings.weekStartsOn} posts={calQ.data ?? []} dnd={dnd} slots={slotsQ.data ?? []} onOpen={openPost} onReschedule={setRescheduling} onNewAt={newPost} />}
              <UnscheduledPanel posts={unscheduled} loading={unschedQ.isLoading} dnd={dnd} onOpen={openPost} onReschedule={setRescheduling} />
            </div>
          )}
        </div>
      )}
      {tab === 'list' && <ListView accountIds={accountIds} platforms={platforms} onOpen={openPost} />}
      {tab === 'queue' && <QueueView onOpen={openPost} highlightMissed={params.get('missed') === '1'} />}
      {tab === 'approvals' && <ApprovalsView accountIds={accountIds} platforms={platforms} onOpen={openPost} />}
      {tab === 'log' && <div className="panel overflow-hidden"><AuditLog /></div>}

      <RescheduleDialog post={rescheduling} dnd={dnd} onClose={() => setRescheduling(null)} />
      {composerOpen && <ComposerDrawer key={composerId ?? 'new'} postId={composerId} seed={seed} onClose={closeComposer} onOpenPost={openPost} />}
    </div>
  );
}
