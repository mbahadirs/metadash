import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { fmtDateTime, fmtNum } from '@/lib/format';
import { publishingApi, useMissed, usePublishingQueue, usePublishingStatus, useQuota } from '@/hooks/usePlanner';
import { EmptyState, ErrorState, Loading, Toggle } from '@/components/ui';
import { PlatformIcon } from '@/components/PlatformBadge';
import type { MissedAction, QueueItem } from '@/lib/types';
import { useToast } from './Toast';
import { AssetThumb, TargetStateBadge, useAccountMap } from './parts';
import { errorText, fromLocalInput, isNotImplemented, toLocalInput, tx } from './lib';

const RETRYABLE = new Set(['failed', 'missed', 'paused']);
const CANCELABLE = new Set(['queued', 'ready', 'handed_off', 'missed', 'paused', 'failed', 'idle']);

function useAct() {
  const t = useT();
  const toast = useToast();
  return async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok, 'ok'); } catch (e) { toast(isNotImplemented(e) ? t('pl_publishing_unavailable') : errorText(e), 'error'); }
  };
}

function Unavailable() {
  const t = useT();
  return <EmptyState title={t('pl_publishing_unavailable')} hint={t('pl_publishing_unavailable_hint')} />;
}

/** Publishing queue (chunk B channels): worker status + pause, missed posts, targets by state, quota meters. */
export function QueueView({ onOpen, highlightMissed }: { onOpen: (id: number) => void; highlightMissed: boolean }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const accounts = useAccountMap();
  const act = useAct();
  const status = usePublishingStatus();
  const queue = usePublishingQueue();
  const items = useMemo(() => queue.data ?? [], [queue.data]);
  const quotaAccounts = useMemo(() => [...new Set(items.filter((i) => i.platform !== 'facebook').map((i) => i.accountId))], [items]);

  if (queue.isLoading) return <Loading />;
  if (queue.error) return isNotImplemented(queue.error) ? <Unavailable /> : <ErrorState error={queue.error} />;

  return (
    <div className="space-y-4">
      {status.data && (
        <div className="panel px-4 py-3 flex flex-wrap items-center gap-4 text-sm">
          <Toggle checked={!status.data.paused} label={status.data.paused ? t('pl_publishing_paused') : t('pl_publishing_active')}
            onChange={(on) => act(() => publishingApi.setPaused(!on), on ? t('pl_publishing_resumed') : t('pl_publishing_paused'))} />
          <span className="text-ink-2">{t('pl_next_run')}: <span className="num text-ink-1">{status.data.nextAt ? fmtDateTime(status.data.nextAt) : '—'}</span></span>
          <span className="text-ink-2">{t('pl_in_flight')}: <span className="num text-ink-1">{status.data.inFlight}</span></span>
          <span className="text-xs text-ink-2 flex-1 text-right">{t('pl_app_must_run')}</span>
        </div>
      )}
      <MissedBanner highlight={highlightMissed} />
      {quotaAccounts.length > 0 && (
        <div className="flex flex-wrap gap-2">{quotaAccounts.map((a) => <QuotaMeter key={a} accountId={a} label={`@${accounts.get(a)?.username ?? a}`} />)}</div>
      )}
      {!items.length ? <EmptyState title={t('pl_queue_empty')} /> : (
        <div className="panel overflow-auto">
          <table className="table">
            <thead><tr><th>{t('pl_post')}</th><th>{t('account')}</th><th>{t('pl_format')}</th><th>{t('status')}</th><th>{t('pl_scheduled_for')}</th><th>{t('pl_next_attempt')}</th><th>{t('pl_last_error')}</th><th /></tr></thead>
            <tbody>
              {items.map((i: QueueItem) => (
                <tr key={i.id} className="clickable" tabIndex={0} onClick={() => onOpen(i.postId)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(i.postId); }}>
                  <td><span className="flex items-center gap-2">{i.thumb && <AssetThumb assetId={i.thumb.assetId} kind={i.thumb.kind} size={24} />}<span className="num text-ink-2">{i.postRef}</span><span className="truncate max-w-[200px]">{i.postTitle ?? ''}</span></span></td>
                  <td><span className="inline-flex items-center gap-1"><PlatformIcon platform={i.platform} size={12} />@{accounts.get(i.accountId)?.username ?? i.accountId}</span></td>
                  <td>{tx(`fmt_${i.format}`, lang, undefined, i.format)}</td>
                  <td><TargetStateBadge state={i.state} />{i.attempts > 0 && <span className="text-[11px] text-ink-2 ml-1 num">×{i.attempts}</span>}</td>
                  <td className="num">{i.scheduledAt ? fmtDateTime(i.scheduledAt) : '—'}</td>
                  <td className="num">{i.nextAttemptAt ? fmtDateTime(i.nextAttemptAt) : '—'}</td>
                  <td className="whitespace-normal text-xs text-neg max-w-[260px]">{i.lastError ? `${i.lastErrorCode ? `[${i.lastErrorCode}] ` : ''}${i.lastError}` : ''}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    {RETRYABLE.has(i.state) && <button type="button" className="btn btn-sm" onClick={() => act(() => publishingApi.retry(i.id), t('pl_retry_queued'))}>{t('pl_retry')}</button>}
                    {CANCELABLE.has(i.state) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(() => publishingApi.cancel(i.id), t('pl_target_canceled'))}>{t('cancel')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QuotaMeter({ accountId, label }: { accountId: string; label: string }) {
  const t = useT();
  const q = useQuota(accountId);
  if (!q.data || q.data.total == null) return null;
  const used = q.data.used ?? 0;
  const pct = q.data.total ? Math.min(100, (used / q.data.total) * 100) : 0;
  const color = pct >= 90 ? 'var(--neg)' : pct >= 70 ? 'var(--warn)' : 'var(--pos)';
  return (
    <div className="panel px-3 py-2 text-xs w-52" title={t('pl_quota_tip')}>
      <div className="flex justify-between"><span className="truncate">{label}</span><span className="num">{fmtNum(used)}/{fmtNum(q.data.total)}</span></div>
      <div className="h-1.5 rounded bg-surface-2 mt-1" role="meter" aria-valuemin={0} aria-valuemax={q.data.total} aria-valuenow={used} aria-label={`${t('pl_quota')} ${label}`}>
        <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/** Posts that were due while MetaDash was closed/asleep: publish now, move to a new time or skip. */
export function MissedBanner({ highlight }: { highlight: boolean }) {
  const t = useT();
  const act = useAct();
  const q = useMissed();
  const [at, setAt] = useState(() => toLocalInput(Date.now() + 3_600_000));
  const items = q.data ?? [];
  if (q.error || !items.length) return null;
  const ids = items.map((i) => i.id);
  const resolve = (action: MissedAction) => {
    const when = action === 'reschedule' ? fromLocalInput(at) ?? undefined : undefined;
    return act(() => publishingApi.resolveMissed(ids, action, when), t('pl_missed_resolved'));
  };
  return (
    <div className={`panel px-4 py-3 space-y-2 ${highlight ? 'ring-2 ring-[var(--warn)]' : ''}`} style={{ borderColor: 'var(--warn)' }} role="alert">
      <div className="text-sm font-medium text-warn">{t('pl_missed_title', { n: items.length })}</div>
      <ul className="text-xs text-ink-2 space-y-0.5">
        {items.slice(0, 6).map((i) => <li key={i.id} className="num">{i.postRef} · {i.scheduledAt ? fmtDateTime(i.scheduledAt) : '—'} · {i.postTitle ?? ''}</li>)}
        {items.length > 6 && <li>{t('pl_more_n', { n: items.length - 6 })}</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => resolve('publish')}>{t('pl_publish_now')}</button>
        <input type="datetime-local" className="input h-7 w-auto" value={at} onChange={(e) => setAt(e.target.value)} aria-label={t('pl_date_time')} />
        <button type="button" className="btn btn-sm" onClick={() => resolve('reschedule')}>{t('pl_reschedule')}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => resolve('skip')}>{t('pl_skip')}</button>
      </div>
    </div>
  );
}
