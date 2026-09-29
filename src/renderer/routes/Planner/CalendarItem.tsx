import type { KeyboardEvent } from 'react';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import type { PlannerPostSummary } from '@/lib/types';
import { AssetThumb, TargetDots } from './parts';
import { DAY_MS, QUARTER_MS, STATUS_COLOR, canReschedule, fmtTime } from './lib';
import type { CalendarDnd } from './useCalendarDnd';

/**
 * One post chip in the calendar / unscheduled list. Enter opens the composer; keyboard alternatives to drag and drop:
 * R opens the reschedule dialog, Alt+←/→ moves one day, Alt+↑/↓ moves 15 minutes (Alt+Shift duplicates).
 */
export function CalendarItem({ post, dnd, onOpen, onReschedule, compact }: {
  post: PlannerPostSummary; dnd: CalendarDnd; onOpen: (id: number) => void; onReschedule: (post: PlannerPostSummary) => void; compact?: boolean;
}) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const handedOff = post.targets.some((tg) => tg.state === 'handed_off');
  const movable = canReschedule(post.status);
  const label = post.title || post.captionPreview || post.ref;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!movable) return;
    if ((e.key === 'r' || e.key === 'R') && !e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onReschedule(post); return; }
    if (!e.altKey || post.scheduledAt == null) return;
    const delta = e.key === 'ArrowLeft' ? -DAY_MS : e.key === 'ArrowRight' ? DAY_MS : e.key === 'ArrowUp' ? -QUARTER_MS : e.key === 'ArrowDown' ? QUARTER_MS : 0;
    if (!delta) return;
    e.preventDefault();
    const base = new Date(post.scheduledAt);
    // Day moves keep the wall-clock time across DST changes.
    const at = Math.abs(delta) === DAY_MS
      ? new Date(base.getFullYear(), base.getMonth(), base.getDate() + Math.sign(delta), base.getHours(), base.getMinutes()).getTime()
      : post.scheduledAt + delta;
    void dnd.move(post, at, e.shiftKey);
  };

  return (
    <button
      type="button"
      {...dnd.dragProps(post)}
      onClick={() => onOpen(post.id)}
      onKeyDown={onKeyDown}
      aria-keyshortcuts={movable ? 'R Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown' : undefined}
      title={`${post.ref} · ${t(`st_${post.status}`)}${movable ? ` — ${t('pl_item_keys')}` : ''}`}
      className={`w-full text-left rounded border border-line bg-surface-1 hover:bg-surface-2 flex items-center gap-1.5 px-1 py-0.5 text-xs ${dnd.dragging === post.id ? 'opacity-50' : ''} ${movable ? 'cursor-grab' : 'cursor-pointer'}`}
      style={{ boxShadow: `inset 3px 0 0 ${STATUS_COLOR[post.status]}` }}
      data-post-id={post.id}
    >
      {!compact && post.thumb && <AssetThumb assetId={post.thumb.assetId} kind={post.thumb.kind} size={22} />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          {post.scheduledAt != null && <span className="num text-ink-2">{fmtTime(post.scheduledAt, lang)}</span>}
          <TargetDots targets={post.targets} max={3} />
          {handedOff && <span className="text-pos" title={t('pl_handed_off_hint')} aria-label={t('pl_handed_off_hint')}>✓</span>}
          {post.issuesCount > 0 && <span className="text-neg" title={t('pl_errors_n', { n: post.issuesCount })} aria-label={t('pl_errors_n', { n: post.issuesCount })}>●</span>}
        </span>
        <span className="block truncate">{label}</span>
      </span>
    </button>
  );
}
