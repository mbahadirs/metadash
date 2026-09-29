import { useMemo } from 'react';
import { useT, intlLocale } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { WEEKDAYS } from '@/lib/format';
import type { PlannerPostSummary } from '@/lib/types';
import { CalendarItem } from './CalendarItem';
import { dayKey, keepTimeOnDay, monthGrid, sameDay, startOfDay } from './lib';
import type { CalendarDnd } from './useCalendarDnd';

const MAX_PER_DAY = 3;

/** 6×7 month grid; each day shows up to 3 posts plus "+n" (opens the week). Dropping keeps the time of day. */
export function CalendarMonth({ anchor, weekStartsOn, posts, dnd, onOpen, onReschedule, onShowWeek, onNewAt }: {
  anchor: Date; weekStartsOn: number; posts: PlannerPostSummary[]; dnd: CalendarDnd;
  onOpen: (id: number) => void; onReschedule: (p: PlannerPostSummary) => void; onShowWeek: (d: Date) => void; onNewAt: (at: number) => void;
}) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const days = useMemo(() => monthGrid(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const byDay = useMemo(() => {
    const m = new Map<string, PlannerPostSummary[]>();
    for (const p of posts) {
      if (p.scheduledAt == null) continue;
      const k = dayKey(new Date(p.scheduledAt));
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [posts]);
  const today = new Date();
  const todayStart = startOfDay(Date.now()).getTime();
  const headers = Array.from({ length: 7 }, (_, i) => WEEKDAYS[lang][(weekStartsOn + i) % 7]);

  return (
    <div className="panel overflow-hidden" role="grid" aria-label={t('pl_view_month')}>
      <div className="grid grid-cols-7 border-b border-line bg-surface-2" role="row">
        {headers.map((h) => <div key={h} role="columnheader" className="px-2 h-8 flex items-center text-xs text-ink-2">{h}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const k = dayKey(d);
          const list = byDay.get(k) ?? [];
          const inMonth = d.getMonth() === anchor.getMonth();
          const past = d.getTime() < todayStart;
          const drop = dnd.dropProps(`m:${k}`, (_e, prev) => keepTimeOnDay(d, prev));
          return (
            <div
              key={k}
              role="gridcell"
              aria-label={`${d.toLocaleDateString(intlLocale(lang), { weekday: 'long', day: 'numeric', month: 'long' })}: ${t('pl_n_posts', { n: list.length })}`}
              className={`min-h-[112px] border-b border-r border-line p-1 flex flex-col gap-1 ${dnd.overKey === `m:${k}` ? 'bg-[var(--accent-soft)]' : inMonth ? '' : 'bg-surface-0'}`}
              {...(past ? {} : drop)}
            >
              <div className="flex items-center justify-between">
                <span className={`num text-xs w-6 h-6 inline-flex items-center justify-center rounded-full ${sameDay(d, today) ? 'bg-accent text-white' : inMonth ? '' : 'text-ink-2'}`}>{d.getDate()}</span>
                {!past && <button type="button" className="btn btn-ghost btn-sm h-5 px-1 text-ink-2 opacity-60 hover:opacity-100 focus:opacity-100" onClick={() => onNewAt(keepTimeOnDay(d, null))} aria-label={t('pl_new_on_day')} title={t('pl_new_on_day')}>+</button>}
              </div>
              {list.slice(0, MAX_PER_DAY).map((p) => <CalendarItem key={p.id} post={p} dnd={dnd} onOpen={onOpen} onReschedule={onReschedule} compact />)}
              {list.length > MAX_PER_DAY && (
                <button type="button" className="text-xs text-accent text-left px-1" onClick={() => onShowWeek(d)}>{t('pl_more_n', { n: list.length - MAX_PER_DAY })}</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
