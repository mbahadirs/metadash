import { useT } from '@/lib/i18n';
import { PLATFORM_LABELS } from '@/lib/platforms';
import { Toggle } from '@/components/ui';
import type { Account, InboxCounts, InboxListParams, InboxSentiment, Platform } from '@/lib/types';
import { SENTIMENTS, sentimentKey } from './format';

export type InboxFilters = Omit<InboxListParams, 'cursor' | 'limit'>;
const STATUS_TABS = ['open', 'overdue', 'replied', 'done', 'all'] as const;
type StatusTab = (typeof STATUS_TABS)[number];
const UNASSIGNED = '__none__';

/** Unanswered / Overdue / Replied / Done / All + platform, account, sentiment, assignee, questions-only, search, sort. */
export function Filters({ value, onChange, counts, accounts, platforms, assignees, lockAccount }: {
  value: InboxFilters; onChange: (next: InboxFilters) => void; counts: InboxCounts | undefined; accounts: Account[]; platforms: Platform[];
  assignees: string[]; lockAccount?: boolean;
}) {
  const t = useT();
  const set = (patch: Partial<InboxFilters>) => onChange({ ...value, ...patch });
  const countOf = (s: StatusTab) => (s === 'open' ? counts?.open : s === 'overdue' ? counts?.overdue : s === 'replied' ? counts?.replied : s === 'done' ? counts?.done : undefined);
  const assigneeValue = value.assignee === null ? UNASSIGNED : value.assignee ?? '';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('ix_status')}>
        {STATUS_TABS.map((s) => (
          <button key={s} role="tab" aria-selected={value.status === s} className={`btn btn-sm ${value.status === s ? 'btn-primary' : 'btn-ghost'}`} onClick={() => set({ status: s })}>
            {t(`ix_status_${s}`)}{countOf(s) != null && <span className={`badge ml-1 num ${s === 'overdue' && countOf(s) ? 'badge-neg' : 'badge-muted'}`}>{countOf(s)}</span>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-48" type="search" value={value.q ?? ''} placeholder={t('ix_search')} aria-label={t('ix_search')} maxLength={100} onChange={(e) => set({ q: e.target.value || undefined })} />
        {platforms.length > 1 && (
          <select className="input w-36" aria-label={t('ix_platform')} value={value.platforms?.[0] ?? ''} onChange={(e) => set({ platforms: e.target.value ? [e.target.value as Platform] : undefined })}>
            <option value="">{t('ix_all_platforms')}</option>
            {platforms.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
          </select>
        )}
        {!lockAccount && (
          <select className="input w-48" aria-label={t('ix_account')} value={value.accountIds?.[0] ?? ''} onChange={(e) => set({ accountIds: e.target.value ? [e.target.value] : undefined })}>
            <option value="">{t('ix_all_accounts')}</option>
            {accounts.map((a) => <option key={a.igId} value={a.igId}>@{a.username} · {PLATFORM_LABELS[a.platform]}</option>)}
          </select>
        )}
        <select className="input w-36" aria-label={t('ix_sentiment')} value={value.sentiment?.[0] ?? ''} onChange={(e) => set({ sentiment: e.target.value ? [e.target.value as InboxSentiment] : undefined })}>
          <option value="">{t('ix_all_sentiments')}</option>
          {SENTIMENTS.map((s) => <option key={s} value={s}>{t(sentimentKey(s))}</option>)}
        </select>
        <select className="input w-36" aria-label={t('ix_assignee')} value={assigneeValue} onChange={(e) => set({ assignee: e.target.value === UNASSIGNED ? null : e.target.value || undefined })}>
          <option value="">{t('ix_anyone')}</option>
          <option value={UNASSIGNED}>{t('ix_unassigned')}</option>
          {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input w-32" aria-label={t('ix_sort')} value={value.sort ?? 'newest'} onChange={(e) => set({ sort: e.target.value as InboxFilters['sort'] })}>
          <option value="newest">{t('ix_sort_newest')}</option>
          <option value="oldest">{t('ix_sort_oldest')}</option>
        </select>
        <Toggle checked={value.question === true} onChange={(v) => set({ question: v || undefined })} label={t('ix_questions_only')} />
      </div>
    </div>
  );
}
