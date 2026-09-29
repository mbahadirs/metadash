import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { publishingApi } from '@/hooks/usePlanner';
import { PlatformIcon } from '@/components/PlatformBadge';
import { Icon } from '@/components/Icons';
import type { Account, PlannerPost, PlannerTarget } from '@/lib/types';
import { useToast } from '../Toast';
import { TargetStateBadge } from '../parts';
import { AuditLog } from '../AuditLog';
import { errorText, isNotImplemented, tx } from '../lib';

const RETRYABLE = new Set(['failed', 'missed', 'paused']);
const CANCELABLE = new Set(['queued', 'ready', 'handed_off', 'missed', 'paused', 'failed']);

/** Per-target publish results (state, permalink, error + fbtrace id) with retry/cancel, then the post's audit log. */
export function PostHistory({ post, accounts }: { post: PlannerPost; accounts: Map<string, Account> }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const toast = useToast();
  const act = async (fn: () => Promise<unknown>, okKey: 'pl_retry_queued' | 'pl_target_canceled') => {
    try { await fn(); toast(t(okKey), 'ok'); } catch (e) { toast(isNotImplemented(e) ? t('pl_publishing_unavailable') : errorText(e), 'error'); }
  };
  return (
    <div className="space-y-4">
      <div className="overflow-auto">
        <table className="table">
          <thead><tr><th>{t('account')}</th><th>{t('pl_format')}</th><th>{t('status')}</th><th>{t('pl_result')}</th><th /></tr></thead>
          <tbody>
            {post.targets.map((tg: PlannerTarget) => (
              <tr key={tg.id}>
                <td><span className="inline-flex items-center gap-1"><PlatformIcon platform={tg.platform} size={12} />@{accounts.get(tg.accountId)?.username ?? tg.accountId}</span>{tg.mode === 'native' && <span className="badge badge-muted ml-1">{t('pl_native')}</span>}</td>
                <td>{tx(`fmt_${tg.format}`, lang, undefined, tg.format)}</td>
                <td><TargetStateBadge state={tg.state} />{tg.attempts > 0 && <span className="text-[11px] text-ink-2 ml-1 num">×{tg.attempts}</span>}</td>
                <td className="whitespace-normal text-xs max-w-[320px]">
                  {tg.permalink && <button type="button" className="btn btn-ghost btn-sm px-1" onClick={() => api.system.openExternal(tg.permalink!)}>{t('pl_open_post')} <Icon.external /></button>}
                  {tg.publishedAt && <span className="text-ink-2 num"> {fmtDateTime(tg.publishedAt)}</span>}
                  {tg.state === 'handed_off' && <span className="text-ink-2">{t('pl_handed_off_hint')}</span>}
                  {tg.nextAttemptAt && !['published', 'canceled'].includes(tg.state) && <span className="text-ink-2 num"> {t('pl_next_attempt')}: {fmtDateTime(tg.nextAttemptAt)}</span>}
                  {tg.lastError && (
                    <div className="text-neg mt-0.5 select-text">
                      {tg.lastErrorCode ? `[${tg.lastErrorCode}] ` : ''}{tg.lastError}
                      {tg.fbtraceId && <span className="text-ink-2"> · fbtrace_id {tg.fbtraceId}</span>}
                    </div>
                  )}
                </td>
                <td className="text-right">
                  {RETRYABLE.has(tg.state) && <button type="button" className="btn btn-sm" onClick={() => act(() => publishingApi.retry(tg.id), 'pl_retry_queued')}>{t('pl_retry')}</button>}
                  {CANCELABLE.has(tg.state) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(() => publishingApi.cancel(tg.id), 'pl_target_canceled')}>{t('cancel')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div className="text-sm font-medium mb-2">{t('pl_history')}</div>
        <AuditLog postId={post.id} initial={post.audit} />
      </div>
    </div>
  );
}
