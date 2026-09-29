import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { Modal } from '@/components/ui';
import type { PlannerPostSummary } from '@/lib/types';
import { fromLocalInput, toLocalInput, keepTimeOnDay } from './lib';
import type { CalendarDnd } from './useCalendarDnd';

/** Keyboard alternative to drag and drop: pick a new date/time, optionally as a duplicate, or clear the time. */
export function RescheduleDialog({ post, dnd, onClose }: { post: PlannerPostSummary | null; dnd: CalendarDnd; onClose: () => void }) {
  const t = useT();
  const [value, setValue] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  useEffect(() => {
    if (post) { setValue(toLocalInput(post.scheduledAt ?? keepTimeOnDay(new Date(Date.now() + 86_400_000), null))); setDuplicate(false); }
  }, [post]);
  if (!post) return null;
  const at = fromLocalInput(value);
  const submit = async () => {
    if (at == null) return;
    if (await dnd.move(post, at, duplicate)) onClose();
  };
  return (
    <Modal open={!!post} onClose={onClose} title={`${t('pl_reschedule')} · ${post.ref}`} width={420}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="block text-sm">
          <span className="text-ink-2">{t('pl_date_time')}</span>
          <input type="datetime-local" className="input mt-1" value={value} onChange={(e) => setValue(e.target.value)} autoFocus required />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={duplicate} onChange={(e) => setDuplicate(e.target.checked)} />
          {t('pl_duplicate_instead')}
        </label>
        <div className="flex justify-between gap-2">
          {post.scheduledAt != null && !duplicate && post.status !== 'scheduled'
            ? <button type="button" className="btn" onClick={async () => { if (await dnd.move(post, null)) onClose(); }}>{t('pl_clear_time')}</button>
            : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={at == null}>{duplicate ? t('pl_duplicate') : t('pl_move')}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
