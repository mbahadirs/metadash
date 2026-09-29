import { useT } from '@/lib/i18n';
import { Spinner } from '@/components/ui';
import type { PlannerPostSummary } from '@/lib/types';
import { CalendarItem } from './CalendarItem';
import { DND_MIME, type CalendarDnd } from './useCalendarDnd';

/** Drafts without a time: drag onto the calendar (or press R to pick a time). Dropping a calendar item here clears its time. */
export function UnscheduledPanel({ posts, loading, dnd, onOpen, onReschedule }: {
  posts: PlannerPostSummary[]; loading: boolean; dnd: CalendarDnd; onOpen: (id: number) => void; onReschedule: (p: PlannerPostSummary) => void;
}) {
  const t = useT();
  const clear = dnd.dropProps('unscheduled', () => Number.NaN);
  return (
    <aside className={`panel p-2 flex flex-col gap-1.5 min-h-[200px] ${dnd.overKey === 'unscheduled' ? 'bg-[var(--accent-soft)]' : ''}`} aria-label={t('pl_unscheduled_drafts')}
      onDragOver={clear.onDragOver} onDragLeave={clear.onDragLeave}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(DND_MIME);
        e.preventDefault();
        clear.onDragLeave();
        try { const p = JSON.parse(raw) as { id: number; ref: string; scheduledAt: number | null; status?: PlannerPostSummary['status'] }; if (p.scheduledAt != null) void dnd.move(p, null); } catch { /* not a post */ }
      }}>
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium">{t('pl_unscheduled_drafts')}</span>
        {loading ? <Spinner size={12} /> : <span className="text-xs text-ink-2 num">{posts.length}</span>}
      </div>
      <p className="text-[11px] text-ink-2 px-1">{t('pl_unscheduled_hint')}</p>
      {posts.map((p) => <CalendarItem key={p.id} post={p} dnd={dnd} onOpen={onOpen} onReschedule={onReschedule} />)}
    </aside>
  );
}
