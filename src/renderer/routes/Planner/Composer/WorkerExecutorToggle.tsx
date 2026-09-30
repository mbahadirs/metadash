import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { PLANNER_KEY } from '@/hooks/usePlanner';
import { useWorkerState, workerApi, type WorkerTargetFields } from '@/hooks/useWorker';
import type { Account, PlannerPost, PlannerTarget, WorkerExecutor } from '@/lib/types';
import { PlatformIcon } from '@/components/PlatformBadge';

const WORKER_PLATFORMS = ['instagram', 'facebook', 'threads'];
/** Local states in which the executor can still change (nothing in flight, nothing handed to Facebook). */
const MOVABLE = new Set(['idle', 'queued', 'ready', 'failed', 'missed', 'paused', 'canceled']);
type Target = PlannerTarget & WorkerTargetFields;

/**
 * "Publish via: This computer / Worker" per target, with the worker status chip (v2.0 chunk E; the only v2.0 edit to the
 * v1.4 composer). Hidden until a self-hosted worker is connected. Moving back to this computer recalls the item from
 * the worker, which is refused once the worker started publishing.
 */
export function WorkerExecutorToggle({ post, accounts }: { post: PlannerPost; accounts: Map<string, Account> }) {
  const t = useT();
  const qc = useQueryClient();
  const worker = useWorkerState();
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!worker.data?.configured) return null;
  const targets = (post.targets as Target[]).filter((tg) => WORKER_PLATFORMS.includes(tg.platform));
  if (!targets.length) return null;

  const change = async (tg: Target, executor: WorkerExecutor) => {
    setBusy(tg.id); setErr(null);
    try {
      const r = await workerApi.setExecutor([tg.id], executor);
      const skip = r.skipped[0];
      if (skip) setErr(t(skip.reason === 'publishing' || skip.reason === 'published' ? 'worker_recall_refused' : 'worker_executor_refused', { reason: skip.reason }));
      await qc.invalidateQueries({ queryKey: [PLANNER_KEY] });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <section className="space-y-1.5">
      <h3 className="text-xs uppercase tracking-wide text-ink-2 font-medium">{t('worker_publish_via')}</h3>
      <div className="space-y-1">
        {targets.map((tg) => {
          const executor = tg.executor ?? 'local';
          const locked = !MOVABLE.has(tg.state) || busy === tg.id;
          return (
            <div key={tg.id} className="flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 min-w-0 flex-1 truncate"><PlatformIcon platform={tg.platform} size={12} />@{accounts.get(tg.accountId)?.username ?? tg.accountId}</span>
              <select className="input w-44" value={executor} disabled={locked} aria-label={t('worker_publish_via')} onChange={(e) => void change(tg, e.target.value as WorkerExecutor)}>
                <option value="local">{t('worker_exec_local')}</option>
                <option value="worker">{t('worker_exec_worker')}</option>
              </select>
              {executor === 'worker' && <WorkerChip tg={tg} />}
            </div>
          );
        })}
      </div>
      {err && <div className="text-xs text-neg" role="alert">{err}</div>}
    </section>
  );
}

function WorkerChip({ tg }: { tg: Target }) {
  const t = useT();
  const status = tg.workerStatus ?? (tg.workerRevision == null ? 'pending' : 'queued');
  const cls = status === 'published' ? 'badge-pos' : status === 'failed' || status === 'missed' ? 'badge-neg' : status === 'publishing' ? 'badge-warn' : 'badge-muted';
  const known = ['pending', 'queued', 'publishing', 'published', 'failed', 'missed'].includes(status) ? status : 'queued';
  return (
    <span className={`badge ${cls}`} title={tg.workerError?.code ?? undefined}>
      {t(`worker_status_${known}` as 'worker_status_queued')}{tg.workerError && status !== 'failed' ? ' !' : ''}
    </span>
  );
}
