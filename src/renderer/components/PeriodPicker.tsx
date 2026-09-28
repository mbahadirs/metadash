import { useState } from 'react';
import { useAppStore, type Preset } from '@/store/app';
import { useT } from '@/lib/i18n';
import { fmtDate } from '@/lib/format';

export function PeriodPicker() {
  const t = useT();
  const { period, setPreset, setCustomPeriod } = useAppStore();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const presets: { id: Preset; label: string }[] = [{ id: 'today', label: t('today') }, { id: 'yesterday', label: t('yesterday') }, { id: 7, label: t('last7') }, { id: 30, label: t('last30') }, { id: 'this_month', label: t('this_month') }, { id: 'last_month', label: t('last_month') }];
  return (
    <div className="flex items-center gap-1 relative no-drag">
      {presets.map((p) => (
        <button key={p.id} className={`chip ${period.preset === p.id ? 'active' : ''}`} onClick={() => setPreset(p.id)}>{p.label}</button>
      ))}
      <button className={`chip ${period.preset === 'custom' ? 'active' : ''}`} onClick={() => setOpen((o) => !o)}>
        {period.preset === 'custom' ? `${fmtDate(period.from)} – ${fmtDate(period.to)}` : t('custom')}
      </button>
      {open && (
        <div className="absolute top-8 left-0 panel p-3 z-40 flex items-end gap-2 shadow-lg">
          <label className="text-xs text-ink-2">
            <div className="mb-1">{t('from')}</div>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-xs text-ink-2">
            <div className="mb-1">{t('to')}</div>
            <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn btn-primary" onClick={() => { if (from && to && from <= to) { setCustomPeriod(from, to); setOpen(false); } }}>{t('save')}</button>
        </div>
      )}
    </div>
  );
}
