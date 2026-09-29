import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT, type Key } from '@/lib/i18n';
import { Toggle } from '@/components/ui';
import { fmtUsd, useSaveStudioSettings, useStudioCapabilities, useStudioSettings } from '@/hooks/useStudio';
import type { AiProviderId, PriceRow, PricingOverrides, StudioSettingsPatch } from '@/lib/types';

/** Settings → AI (v1.5): vision toggle, cost display, monthly budget, history, commenter anonymization, price overrides. */
export function AiStudioSettings({ provider, enabled }: { provider: AiProviderId; enabled: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const settings = useStudioSettings();
  const caps = useStudioCapabilities(enabled);
  const save = useSaveStudioSettings();
  const [err, setErr] = useState<string | null>(null);
  const s = settings.data;
  if (!s) return null;
  const apply = async (patch: StudioSettingsPatch) => {
    setErr(null);
    try { await save(patch); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{t('ai_costs_title')}</div>
        <span className="flex items-center gap-2">
          {caps.data && caps.data.showCost && <span className="text-xs text-ink-2 num">{t('ai_mtd', { c: fmtUsd(caps.data.monthToDateUsd) })}</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/studio?tab=usage')}>{t('ai_view_usage')}</button>
        </span>
      </div>
      <Hinted hint={t('ai_vision_hint')}><Toggle checked={s.vision} onChange={(v) => apply({ vision: v })} label={t('ai_vision')} /></Hinted>
      <Toggle checked={s.showCost} onChange={(v) => apply({ showCost: v })} label={t('ai_show_cost')} />
      <Hinted hint={t('ai_keep_history_hint')}><Toggle checked={s.keepHistory} onChange={(v) => apply({ keepHistory: v })} label={t('ai_keep_history')} /></Hinted>
      <Toggle checked={s.anonymizeCommenters} onChange={(v) => apply({ anonymizeCommenters: v })} label={t('ai_anonymize')} />
      <div className="flex items-center gap-3">
        <span className="w-40 text-sm">{t('ai_budget')}</span>
        <BudgetField value={s.monthlyBudgetUsd} onSave={(v) => apply({ monthlyBudgetUsd: v })} />
        <span className="text-xs text-ink-2">{t('ai_budget_hint')}</span>
      </div>
      {provider !== 'ollama' && <PriceTable provider={provider} rows={s.prices} overrides={s.pricing} onSave={(pricing) => apply({ pricing })} />}
      {err && <div className="text-xs text-neg">{err}</div>}
    </div>
  );
}

function Hinted({ hint, children }: { hint: string; children: React.ReactNode }) {
  return <div>{children}<div className="text-xs text-ink-2 ml-12 -mt-0.5">{hint}</div></div>;
}

function BudgetField({ value, onSave }: { value: number | null; onSave: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);
  const commit = () => {
    const clean = draft.trim().replace(',', '.');
    const next = clean === '' ? null : Number(clean);
    if (next !== value && (next === null || Number.isFinite(next))) onSave(next);
  };
  return <input className="input w-28 num" inputMode="decimal" value={draft} placeholder="—" onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />;
}

const SOURCE_KEY: Record<PriceRow['source'], Key> = { list: 'ai_price_source_list', estimate: 'ai_price_source_estimate', override: 'ai_price_source_override' };

/** Prices for the selected provider; editing a row stores an override, Reset removes it. */
function PriceTable({ provider, rows, overrides, onSave }: { provider: AiProviderId; rows: PriceRow[]; overrides: PricingOverrides; onSave: (p: PricingOverrides) => void }) {
  const t = useT();
  const [newModel, setNewModel] = useState('');
  const mine = rows.filter((r) => r.provider === provider);
  const setRow = (model: string, price: { inPerM: number; outPerM: number } | null) => {
    const own = { ...(overrides[provider] ?? {}) };
    if (price) own[model] = price; else delete own[model];
    const next = { ...overrides, [provider]: own };
    if (!Object.keys(own).length) delete next[provider];
    onSave(next);
  };
  return (
    <div className="space-y-2">
      <div className="text-sm">{t('ai_prices')}</div>
      <div className="text-xs text-ink-2">{t('ai_prices_hint')}</div>
      <table className="table">
        <thead><tr><th>{t('usage_model')}</th><th className="num">{t('ai_price_input')}</th><th className="num">{t('ai_price_output')}</th><th /><th /></tr></thead>
        <tbody>
          {mine.map((r) => (
            <tr key={r.model}>
              <td className="font-mono text-xs">{r.model}</td>
              <td className="num"><PriceInput value={r.inPerM} onSave={(v) => setRow(r.model, { inPerM: v, outPerM: r.outPerM })} /></td>
              <td className="num"><PriceInput value={r.outPerM} onSave={(v) => setRow(r.model, { inPerM: r.inPerM, outPerM: v })} /></td>
              <td><span className={`badge ${r.source === 'list' ? 'badge-pos' : r.source === 'override' ? 'badge-muted' : 'badge-warn'}`}>{t(SOURCE_KEY[r.source])}</span></td>
              <td>{r.source === 'override' && <button className="btn btn-ghost btn-sm" onClick={() => setRow(r.model, null)}>{t('ai_price_reset')}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2">
        <input className="input w-56 font-mono text-xs" value={newModel} placeholder={t('ai_price_model_ph')} onChange={(e) => setNewModel(e.target.value)} />
        <button className="btn btn-sm" disabled={!newModel.trim()} onClick={() => { setRow(newModel.trim().toLowerCase(), { inPerM: 0, outPerM: 0 }); setNewModel(''); }}>{t('ai_price_add')}</button>
      </div>
    </div>
  );
}

function PriceInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft.trim().replace(',', '.'));
    if (Number.isFinite(n) && n >= 0 && n !== value) onSave(n); else setDraft(String(value));
  };
  return <input className="input w-20 num text-right" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />;
}
