import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { Modal } from '@/components/ui';
import { STUDIO_KEY, studio } from '@/hooks/useStudio';
import { errorText } from '@/routes/Planner/lib';

export interface CustomDay { date: string; name: string }

const DATE_RE = /^(\d{4}-)?\d{2}-\d{2}$/;
const MAX_DAYS = 100;

/** Edits the user's own special days (config 'studio.specialDays', validated in main by studio:ideas:days:save). */
export function SpecialDaysEditor({ open, initial, onClose }: { open: boolean; initial: CustomDay[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [rows, setRows] = useState<CustomDay[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setRows(initial); setError(null); } }, [open, initial]);

  const update = (i: number, patch: Partial<CustomDay>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((cur) => cur.filter((_, j) => j !== i));
  const valid = rows.every((r) => DATE_RE.test(r.date.trim()) && r.name.trim());

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await studio.call('ideas:days:save', { custom: rows.map((r) => ({ date: r.date.trim(), name: r.name.trim() })) });
      await qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'ideas-days'] });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('sd_title')} width={620}>
      <div className="space-y-3 text-sm">
        <p className="text-ink-2">{t('sd_intro')}</p>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input w-36 num" value={r.date} placeholder="MM-DD" aria-label={t('sd_date')} maxLength={10} onChange={(e) => update(i, { date: e.target.value })} />
              <input className="input flex-1" value={r.name} placeholder={t('sd_name')} aria-label={t('sd_name')} maxLength={80} onChange={(e) => update(i, { name: e.target.value })} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(i)} aria-label={t('sd_remove')}>✕</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-sm" disabled={rows.length >= MAX_DAYS} onClick={() => setRows((cur) => [...cur, { date: '', name: '' }])}>+ {t('sd_add')}</button>
        <p className="text-xs text-ink-2">{t('sd_builtin_note')}</p>
        {error && <div className="text-neg text-sm" role="alert">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={!valid || saving} onClick={save}>{t('sd_save')}</button>
        </div>
      </div>
    </Modal>
  );
}
