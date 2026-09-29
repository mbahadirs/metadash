import { useMemo, useState } from 'react';
import { useT, type Key } from '@/lib/i18n';
import { fmtNum } from '@/lib/format';
import { ErrorState, Loading, Section, Tabs } from '@/components/ui';
import { fmtUsd, useStudioUsage } from '@/hooks/useStudio';
import type { UsageGroup, UsageSummary } from '@/lib/types';

type Range = 'this' | 'last';

function monthRange(which: Range): { from: number; to: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (which === 'last' ? 1 : 0), 1).getTime();
  const end = which === 'last' ? new Date(now.getFullYear(), now.getMonth(), 1).getTime() : Date.now() + 1;
  return { from: start, to: end };
}

/** Studio → Usage: token usage and estimated cost by feature and model (ai_generations; counts only). */
export function UsageView() {
  const t = useT();
  const [range, setRange] = useState<Range>('this');
  const r = useMemo(() => monthRange(range), [range]);
  const usage = useStudioUsage(r);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-ink-2 max-w-3xl">{t('usage_intro')}</div>
        <div className="w-56"><Tabs tabs={[{ id: 'this' as Range, label: t('usage_this_month') }, { id: 'last' as Range, label: t('usage_last_month') }]} value={range} onChange={setRange} /></div>
      </div>
      {usage.isLoading ? <Loading /> : usage.error ? <ErrorState error={usage.error} /> : usage.data ? <UsageBody u={usage.data} /> : null}
    </div>
  );
}

function UsageBody({ u }: { u: UsageSummary }) {
  const t = useT();
  if (!u.calls) return <div className="panel p-8 text-center text-ink-2">{t('usage_empty')}</div>;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label={t('usage_total_cost')} value={fmtUsd(u.totalUsd)} warn={u.overBudget} sub={u.budgetUsd != null ? t('usage_budget', { b: fmtUsd(u.budgetUsd) }) : undefined} />
        <Stat label={t('usage_calls')} value={fmtNum(u.calls)} sub={u.errors ? `${t('usage_errors')}: ${fmtNum(u.errors)}` : undefined} />
        <Stat label={t('usage_input_tokens')} value={fmtNum(u.inputTokens)} />
        <Stat label={t('usage_output_tokens')} value={fmtNum(u.outputTokens)} />
        <Stat label={t('usage_images')} value={fmtNum(u.images)} />
      </div>
      {u.overBudget && u.budgetUsd != null && <div className="text-sm text-warn">{t('studio_budget_over', { s: fmtUsd(u.totalUsd), b: fmtUsd(u.budgetUsd) })}</div>}
      {u.unknownCostCalls > 0 && <div className="text-xs text-ink-2">{t('usage_unknown_note', { n: u.unknownCostCalls })}</div>}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title={t('usage_by_feature')}>
          <GroupTable head={t('usage_feature')} rows={u.byFeature.map((g) => ({ key: g.feature, label: featureLabel(t, g.feature), g }))} />
        </Section>
        <Section title={t('usage_by_model')}>
          <GroupTable head={t('usage_model')} rows={u.byModel.map((g) => ({ key: `${g.provider}:${g.model}`, label: `${g.model ?? '—'}${g.provider ? ` · ${g.provider}` : ''}`, g }))} />
        </Section>
      </div>
    </>
  );
}

function featureLabel(t: ReturnType<typeof useT>, feature: string) {
  const key = `feature_${feature}` as Key;
  const label = t(key);
  return label === key ? feature : label;
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="panel p-4">
      <div className="text-xs text-ink-2">{label}</div>
      <div className={`text-lg font-semibold num ${warn ? 'text-warn' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-ink-2 mt-0.5">{sub}</div>}
    </div>
  );
}

function GroupTable({ head, rows }: { head: string; rows: { key: string; label: string; g: UsageGroup }[] }) {
  const t = useT();
  return (
    <table className="table">
      <thead><tr><th>{head}</th><th className="num">{t('usage_calls')}</th><th className="num">{t('usage_input_tokens')}</th><th className="num">{t('usage_output_tokens')}</th><th className="num">{t('usage_cost')}</th></tr></thead>
      <tbody>
        {rows.map(({ key, label, g }) => (
          <tr key={key}><td>{label}</td><td className="num">{fmtNum(g.calls)}</td><td className="num">{fmtNum(g.inputTokens)}</td><td className="num">{fmtNum(g.outputTokens)}</td><td className="num">{fmtUsd(g.usd)}{g.unknownCost ? '*' : ''}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
