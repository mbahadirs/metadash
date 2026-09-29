import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { fmtDate, fmtDateTime, fmtNum } from '@/lib/format';
import { studio, STUDIO_KEY } from '@/hooks/useStudio';
import { Loading, ErrorState } from '@/components/ui';
import { PostThumb } from '@/components/PostThumb';
import type { AbCandidates, ArmPick } from './types';

/** Checkbox list of recent synced posts and planner targets; `taken` keys are already used by another arm. */
export function PostPicker({ value, onChange, taken }: { value: ArmPick; onChange: (v: ArmPick) => void; taken: Set<string> }) {
  const t = useT();
  const [search, setSearch] = useState('');
  const q = useQuery<AbCandidates>({ queryKey: [STUDIO_KEY, 'ab', 'candidates'], queryFn: () => studio.call<AbCandidates>('ab:candidates', {}) });
  const s = search.trim().toLowerCase();
  const match = (caption: string | null, username: string | null) => !s || (caption ?? '').toLowerCase().includes(s) || (username ?? '').toLowerCase().includes(s);
  const media = (q.data?.media ?? []).filter((m) => match(m.caption, m.username));
  // Targets already published and synced appear as media; only still-planned ones are listed here.
  const targets = (q.data?.targets ?? []).filter((x) => !x.mediaKey && match(x.caption, x.username));
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;

  const toggleMedia = (k: string) => onChange({ ...value, mediaKeys: value.mediaKeys.includes(k) ? value.mediaKeys.filter((x) => x !== k) : [...value.mediaKeys, k] });
  const toggleTarget = (id: number) => onChange({ ...value, targetIds: value.targetIds.includes(id) ? value.targetIds.filter((x) => x !== id) : [...value.targetIds, id] });

  return (
    <div className="space-y-2">
      <input className="input" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="max-h-64 overflow-auto space-y-3 pr-1">
        {targets.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-ink-2 font-medium">{t('exp_planned')}</div>
            <div className="text-xs text-ink-2">{t('exp_planned_hint')}</div>
            {targets.map((x) => {
              const key = `t:${x.targetId}`;
              const disabled = taken.has(key);
              return (
                <label key={key} className={`flex items-center gap-2 text-sm rounded p-1 ${disabled ? 'opacity-40' : 'hover:bg-surface-2 cursor-pointer'}`}>
                  <input type="checkbox" disabled={disabled} checked={value.targetIds.includes(x.targetId)} onChange={() => toggleTarget(x.targetId)} />
                  <span className="badge badge-muted">{x.ref ?? `#${x.postId}`}</span>
                  <span className="text-xs text-ink-2">@{x.username ?? x.accountId}</span>
                  <span className="truncate flex-1">{x.caption || '—'}</span>
                  {x.scheduledAt && <span className="text-xs text-ink-2 num">{t('exp_scheduled', { d: fmtDateTime(x.scheduledAt) })}</span>}
                </label>
              );
            })}
          </div>
        )}
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-ink-2 font-medium">{t('exp_published')}</div>
          {media.map((m) => {
            const key = `m:${m.mediaKey}`;
            const disabled = taken.has(key);
            return (
              <label key={key} className={`flex items-center gap-2 text-sm rounded p-1 ${disabled ? 'opacity-40' : 'hover:bg-surface-2 cursor-pointer'}`}>
                <input type="checkbox" disabled={disabled} checked={value.mediaKeys.includes(m.mediaKey)} onChange={() => toggleMedia(m.mediaKey)} />
                <PostThumb mediaId={m.mediaKey} thumbnailPath={m.thumbnailPath} mediaType={m.mediaType} mediaProductType={m.mediaProductType} size={28} />
                <span className="text-xs text-ink-2">@{m.username}</span>
                <span className="truncate flex-1">{m.caption || '—'}</span>
                <span className="text-xs text-ink-2 num">{fmtDate(m.postedAt)}</span>
                <span className="text-xs text-ink-2 num w-16 text-right">{fmtNum(m.platform === 'threads' ? m.views : m.reach)}</span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="text-xs text-ink-2">{t('exp_selected', { n: value.mediaKeys.length + value.targetIds.length })}</div>
    </div>
  );
}
