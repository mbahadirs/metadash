import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { fmtDateTime } from '@/lib/format';
import { plannerApi, usePlannerPosts } from '@/hooks/usePlanner';
import { EmptyState, ErrorState, Loading } from '@/components/ui';
import type { Platform, PostStatus } from '@/lib/types';
import { useToast } from './Toast';
import { AssetThumb, StatusBadge, TargetDots } from './parts';
import { POST_STATUSES, errorText, tx } from './lib';

type BulkAction = 'in_review' | 'approved' | 'draft' | 'archived';
const BULK: BulkAction[] = ['in_review', 'approved', 'draft', 'archived'];
const BULK_LABEL: Record<BulkAction, 'pl_submit_review' | 'pl_approve' | 'pl_back_to_draft' | 'pl_archive'> = {
  in_review: 'pl_submit_review', approved: 'pl_approve', draft: 'pl_back_to_draft', archived: 'pl_archive',
};

/** All posts as a table with status filters, search and bulk status changes. */
export function ListView({ accountIds, platforms, onOpen }: { accountIds: string[]; platforms: Platform[]; onOpen: (id: number) => void }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const toast = useToast();
  const [statuses, setStatuses] = useState<PostStatus[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const params = useMemo(() => ({
    ...(statuses.length ? { statuses } : {}), ...(search.trim() ? { search: search.trim() } : {}),
    ...(accountIds.length ? { accountIds } : {}), ...(platforms.length ? { platforms } : {}),
  }), [statuses, search, accountIds, platforms]);
  const q = usePlannerPosts(params);
  const rows = q.data ?? [];
  const toggleStatus = (s: PostStatus) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const toggleRow = (id: number) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  const bulk = async (status: BulkAction) => {
    try {
      const res = await plannerApi.setStatus({ ids: selected, status });
      const reasons = [...new Set(res.rejected.map((r) => tx(`pl_reason_${r.reason}`, lang, undefined, r.reason)))];
      toast(t('pl_bulk_result', { ok: res.updated.length, failed: res.rejected.length }) + (reasons.length ? ` (${reasons.join('; ')})` : ''), res.rejected.length ? 'info' : 'ok');
      setSelected([]);
    } catch (e) { toast(errorText(e), 'error'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-60" placeholder={t('pl_search_posts')} aria-label={t('pl_search_posts')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('status')}>
          {POST_STATUSES.map((s) => (
            <button type="button" key={s} className={`chip ${statuses.includes(s) ? 'active' : ''}`} aria-pressed={statuses.includes(s)} onClick={() => toggleStatus(s)}>{t(`st_${s}`)}</button>
          ))}
        </div>
      </div>
      {selected.length > 0 && (
        <div className="panel px-3 py-2 flex flex-wrap items-center gap-2 text-sm" role="toolbar" aria-label={t('pl_bulk_actions')}>
          <span>{t('pl_selected_n', { n: selected.length })}</span>
          {BULK.map((s) => <button type="button" key={s} className="btn btn-sm" onClick={() => bulk(s)}>{t(BULK_LABEL[s])}</button>)}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>{t('pl_clear_selection')}</button>
        </div>
      )}
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : !rows.length ? <EmptyState title={t('pl_list_empty')} hint={t('pl_list_empty_hint')} /> : (
        <div className="panel overflow-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-8"><input type="checkbox" aria-label={t('pl_select_all')} checked={allSelected} onChange={() => setSelected(allSelected ? [] : rows.map((r) => r.id))} /></th>
                <th>{t('pl_ref')}</th><th>{t('pl_post')}</th><th>{t('pl_accounts')}</th><th>{t('status')}</th><th>{t('pl_scheduled_for')}</th><th className="num">{t('pl_issues')}</th><th>{t('pl_updated')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`clickable ${selected.includes(r.id) ? 'selected' : ''}`} onClick={() => onOpen(r.id)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.id); if (e.key === ' ') { e.preventDefault(); toggleRow(r.id); } }}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`${t('pl_select')} ${r.ref}`} checked={selected.includes(r.id)} onChange={() => toggleRow(r.id)} /></td>
                  <td className="num text-ink-2">{r.ref}</td>
                  <td className="max-w-[360px]">
                    <span className="flex items-center gap-2 min-w-0">
                      {r.thumb ? <AssetThumb assetId={r.thumb.assetId} kind={r.thumb.kind} size={28} /> : <span className="w-7" />}
                      <span className="truncate">{r.title || r.captionPreview || '—'}</span>
                    </span>
                  </td>
                  <td><TargetDots targets={r.targets} /></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="num">{r.scheduledAt ? fmtDateTime(r.scheduledAt) : <span className="text-ink-2">{t('pl_unscheduled')}</span>}</td>
                  <td className="num">{r.issuesCount ? <span className="text-neg">{r.issuesCount}</span> : <span className="text-ink-2">0</span>}</td>
                  <td className="num text-ink-2">{fmtDateTime(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
