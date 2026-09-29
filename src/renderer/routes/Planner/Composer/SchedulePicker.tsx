import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { fmtDateTime } from '@/lib/format';
import { useSuggestSlots } from '@/hooks/usePlanner';
import { Spinner } from '@/components/ui';
import { fmtDayTitle, fmtTime, fromLocalInput, isNotImplemented, toLocalInput } from '../lib';

/** Date/time for the post plus best-time chips (planner:suggestSlots, chunk C; hidden gracefully when unavailable). */
export function SchedulePicker({ scheduledAt, accountIds, disabled, onChange }: {
  scheduledAt: number | null; accountIds: string[]; disabled: boolean; onChange: (at: number | null) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-2">{t('pl_date_time')}</span>
          <input type="datetime-local" className="input w-auto" value={toLocalInput(scheduledAt)} disabled={disabled}
            onChange={(e) => onChange(fromLocalInput(e.target.value))} />
        </label>
        {scheduledAt != null && !disabled && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>{t('pl_clear_time')}</button>}
        {scheduledAt != null && <span className="text-xs text-ink-2">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>}
      </div>
      <BestTimeChips accountIds={accountIds} disabled={disabled} current={scheduledAt} onPick={onChange} />
    </div>
  );
}

function BestTimeChips({ accountIds, disabled, current, onPick }: { accountIds: string[]; disabled: boolean; current: number | null; onPick: (at: number) => void }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const q = useSuggestSlots(accountIds, !disabled);
  if (!accountIds.length || disabled) return null;
  if (q.isLoading) return <div className="text-xs text-ink-2 flex items-center gap-1"><Spinner size={12} /> {t('pl_best_times')}</div>;
  if (q.error) return <div className="text-xs text-ink-2">{isNotImplemented(q.error) ? t('pl_best_times_unavailable') : t('pl_best_times_failed')}</div>;
  const slots = q.data ?? [];
  if (!slots.length) return <div className="text-xs text-ink-2">{t('pl_best_times_none')}</div>;
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('pl_best_times')}>
      <span className="text-xs text-ink-2 mr-1">{t('pl_best_times')}:</span>
      {slots.map((s) => (
        <button type="button" key={s.at} className={`chip ${current === s.at ? 'active' : ''}`} onClick={() => onPick(s.at)}
          title={`${fmtDateTime(s.at)} · ${t(`pl_slot_src_${s.source}`)}${s.avgEr != null ? ` · ER ${s.avgEr.toFixed(2)}%` : ''}${s.conflicts.length ? ` · ${t('pl_slot_conflict')}` : ''}`}>
          {fmtDayTitle(new Date(s.at), lang)} {fmtTime(s.at, lang)}
          {s.source !== 'account' && <span className="text-[10px] text-ink-2">({t(`pl_slot_src_${s.source}`)})</span>}
          {s.conflicts.length > 0 && <span className="text-warn" aria-label={t('pl_slot_conflict')}>!</span>}
        </button>
      ))}
    </div>
  );
}
