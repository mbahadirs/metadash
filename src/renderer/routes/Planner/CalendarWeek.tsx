import { useEffect, useMemo, useRef, type DragEvent } from 'react';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import type { PlannerPostSummary, Slot } from '@/lib/types';
import { CalendarItem } from './CalendarItem';
import { dayKey, fmtDayTitle, sameDay, weekDays } from './lib';
import type { CalendarDnd } from './useCalendarDnd';

const ROW_PX = 44;
const FIRST_VISIBLE_HOUR = 8;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Minute within the hour from the drop position (15-minute snap). */
function snapMinute(e: DragEvent): number {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
  return Math.max(0, Math.min(45, Math.floor(ratio * 4) * 15));
}

/**
 * 7×24 hour grid. Dropping sets day + hour (+15-min snap from the pointer offset). Best-time suggestions (when a
 * single account is selected and chunk C's planner:suggestSlots is available) tint their hour cells.
 */
export function CalendarWeek({ anchor, weekStartsOn, posts, dnd, slots, onOpen, onReschedule, onNewAt }: {
  anchor: Date; weekStartsOn: number; posts: PlannerPostSummary[]; dnd: CalendarDnd; slots: Slot[];
  onOpen: (id: number) => void; onReschedule: (p: PlannerPostSummary) => void; onNewAt: (at: number) => void;
}) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const scroller = useRef<HTMLDivElement>(null);
  const days = useMemo(() => weekDays(anchor, weekStartsOn), [anchor, weekStartsOn]);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = FIRST_VISIBLE_HOUR * ROW_PX; }, []);

  const cells = useMemo(() => {
    const m = new Map<string, PlannerPostSummary[]>();
    for (const p of posts) {
      if (p.scheduledAt == null) continue;
      const d = new Date(p.scheduledAt);
      const k = `${dayKey(d)}:${d.getHours()}`;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [posts]);
  const slotCells = useMemo(() => {
    const m = new Map<string, Slot>();
    for (const s of slots) { const d = new Date(s.at); m.set(`${dayKey(d)}:${d.getHours()}`, s); }
    return m;
  }, [slots]);
  const now = Date.now();
  const today = new Date();

  return (
    <div className="panel overflow-hidden flex flex-col" role="grid" aria-label={t('pl_view_week')}>
      <div className="grid border-b border-line bg-surface-2" style={{ gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))' }} role="row">
        <div />
        {days.map((d) => (
          <div key={dayKey(d)} role="columnheader" className={`px-2 h-9 flex items-center text-xs ${sameDay(d, today) ? 'text-accent font-medium' : 'text-ink-2'}`}>{fmtDayTitle(d, lang)}</div>
        ))}
      </div>
      <div ref={scroller} className="overflow-auto" style={{ maxHeight: 'calc(100vh - 290px)', minHeight: 320 }}>
        <div className="grid" style={{ gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))' }}>
          {HOURS.map((h) => (
            <div key={h} className="contents" role="row">
              <div className="text-[11px] text-ink-2 num text-right pr-2 pt-0.5 border-r border-line" style={{ height: ROW_PX }} role="rowheader">{String(h).padStart(2, '0')}:00</div>
              {days.map((d) => {
                const k = `${dayKey(d)}:${h}`;
                const list = cells.get(k) ?? [];
                const cellStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime();
                const past = cellStart + 3_600_000 <= now;
                const slot = slotCells.get(k);
                const drop = dnd.dropProps(`w:${k}`, (e) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, snapMinute(e)).getTime());
                return (
                  <div
                    key={k}
                    role="gridcell"
                    aria-label={`${fmtDayTitle(d, lang)} ${String(h).padStart(2, '0')}:00${slot ? ` · ${t('pl_best_time')}` : ''}`}
                    className={`group border-b border-r border-line p-0.5 flex flex-col gap-0.5 min-w-0 ${past ? 'bg-surface-0' : ''} ${dnd.overKey === `w:${k}` ? 'bg-[var(--accent-soft)]' : ''}`}
                    style={{ minHeight: ROW_PX, ...(slot && !past && dnd.overKey !== `w:${k}` ? { background: 'color-mix(in srgb, var(--pos) 12%, transparent)' } : {}) }}
                    title={slot ? t('pl_best_time_tip', { er: slot.avgEr != null ? slot.avgEr.toFixed(2) : '—' }) : undefined}
                    {...(past ? {} : drop)}
                  >
                    {list.map((p) => <CalendarItem key={p.id} post={p} dnd={dnd} onOpen={onOpen} onReschedule={onReschedule} compact />)}
                    {!past && !list.length && (
                      <button type="button" className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[11px] text-ink-2 text-left px-1" onClick={() => onNewAt(cellStart)} aria-label={t('pl_new_at_time')}>+ {t('pl_new_short')}</button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
