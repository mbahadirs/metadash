import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { fmtMoney, fmtPct } from '@/lib/format';
import type { BudgetNode, BudgetPacing } from '@/lib/types';
import { Section, Loading, EmptyState } from '@/components/ui';
import { ExcelButton } from '@/components/ExcelButton';
import { useBudgetTree } from '@/hooks/queries';

const STATUS_BADGE: Record<string, string> = { under: 'badge-warn', on: 'badge-pos', over: 'badge-neg', no_budget: 'badge-muted' };

/** Account → campaign → ad set → ad budget allocation with inline overrides and pacing per node. */
export function BudgetTreePanel({ accounts }: { accounts: BudgetPacing[] }) {
  const t = useT();
  const qc = useQueryClient();
  const withBudget = accounts.filter((a) => a.budget);
  const [actId, setActId] = useState<string>(withBudget[0]?.actId ?? accounts[0]?.actId ?? '');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const q = useBudgetTree(actId || null);
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async (level: string, objectId: string, value: string) => {
    await call(api.ads.setObjectBudget({ actId, level, objectId, amount: value === '' ? null : Number(value.replace(',', '.')) }));
    qc.invalidateQueries({ queryKey: ['budgetTree', actId] });
  };
  const flat = useMemo(() => {
    const out: BudgetNode[] = [];
    const walk = (nodes: BudgetNode[]) => { for (const n of nodes) { out.push(n); if (!collapsed.has(`${n.level}:${n.objectId}`)) walk(n.children); } };
    walk(q.data?.campaigns ?? []);
    return out;
  }, [q.data, collapsed]);
  const cur = q.data?.account.currency ?? 'USD';
  const label = (s: string) => (s === 'under' ? t('pace_under') : s === 'on' ? t('pace_on') : s === 'over' ? t('pace_over') : t('no_budget'));
  const levelLabel = (l: string) => (l === 'campaign' ? t('campaign') : l === 'adset' ? t('adset') : t('ad'));
  const exportRows = () => {
    const all: BudgetNode[] = [];
    const walk = (nodes: BudgetNode[]) => { for (const n of nodes) { all.push(n); walk(n.children); } };
    walk(q.data?.campaigns ?? []);
    return { name: t('budget_tree'), columns: [{ key: 'levelLabel', label: t('level'), type: 'text' as const }, { key: 'name', label: t('type'), type: 'text' as const }, { key: 'parentId', label: t('parent'), type: 'text' as const }, { key: 'budget', label: t('budget'), type: 'money' as const }, { key: 'modeLabel', label: t('auto'), type: 'text' as const }, { key: 'spentMtd', label: t('spent_mtd'), type: 'money' as const }, { key: 'expectedMtd', label: t('expected_mtd'), type: 'money' as const }, { key: 'pacePct', label: `${t('pace')} %`, type: 'percent' as const }, { key: 'statusLabel', label: t('status'), type: 'text' as const }, { key: 'remaining', label: t('remaining'), type: 'money' as const }, { key: 'dailyTarget', label: t('daily_target'), type: 'money' as const }, { key: 'dailyNeeded', label: t('daily_needed'), type: 'money' as const }, { key: 'spentToday', label: t('today'), type: 'money' as const }, { key: 'spentYesterday', label: t('yesterday'), type: 'money' as const }, { key: 'last7', label: t('last7_spend'), type: 'money' as const }, { key: 'projected', label: t('projected'), type: 'money' as const }], rows: all.map((n) => ({ ...n, levelLabel: levelLabel(n.level), modeLabel: n.mode === 'manual' ? t('manual') : t('auto'), statusLabel: label(n.paceStatus) })) };
  };

  return (
    <Section title={t('budget_tree')} right={<><select className="input h-7 text-xs w-64" value={actId} onChange={(e) => setActId(e.target.value)}>{accounts.map((a) => <option key={a.actId} value={a.actId}>{a.name}{a.budget ? ` · ${fmtMoney(a.budget, a.currency)}` : ` · ${t('no_budget')}`}</option>)}</select><ExcelButton name="budget-tree" title={t('budget_tree')} getData={exportRows} /></>}>
      <div className="text-xs text-ink-2 mb-3">{t('budget_tree_hint')}</div>
      {!actId ? <EmptyState title={t('no_ad_account')} /> : q.isLoading ? <Loading /> : q.data && (
        <>
          {q.data.warnings.length > 0 && <div className="text-warn text-xs mb-2">{t('over_allocated')}: {q.data.warnings.map((w) => `${levelLabel(w.level)} (${fmtMoney(w.manualSum, cur)} / ${w.parentBudget != null ? fmtMoney(w.parentBudget, cur) : '—'})`).join(', ')}</div>}
          {!q.data.account.budget && <div className="text-warn text-xs mb-2">{t('no_budget')} — {t('set_budget')}</div>}
          <div className="-mx-4 -mb-4 overflow-auto max-h-[560px]"><table className="table">
            <thead><tr><th>{t('level')}</th><th className="num">{t('budget')}</th><th className="num">{t('spent_mtd')}</th><th className="num">{t('expected_mtd')}</th><th className="num">{t('pace')}</th><th className="num">{t('remaining')}</th><th className="num">{t('daily_target')}</th><th className="num">{t('daily_needed')}</th><th className="num">{t('today')}</th><th className="num">{t('yesterday')}</th><th className="num">{t('last7_spend')}</th><th className="num">{t('projected')}</th></tr></thead>
            <tbody>
              <tr className="font-medium"><td>{q.data.account.name} <span className="badge badge-muted ml-1">{t('ad_account')}</span></td><td className="num">{q.data.account.budget != null ? fmtMoney(q.data.account.budget, cur) : '—'}</td><td className="num">{fmtMoney(q.data.account.spentMtd, cur)}</td><td colSpan={2} className="num"><span className={`badge ${STATUS_BADGE[q.data.account.paceStatus]}`}>{label(q.data.account.paceStatus)} {q.data.account.pacePct != null ? fmtPct(q.data.account.pacePct, 0) : ''}</span></td><td colSpan={7} className="text-xs text-ink-2">{q.data.month.from} – {q.data.month.to} · {q.data.month.elapsed}/{q.data.month.daysInMonth} {t('days_unit')}</td></tr>
              {flat.map((n) => {
                const key = `${n.level}:${n.objectId}`;
                const hasKids = n.children.length > 0;
                return (
                  <tr key={key} className={n.mode === 'manual' ? '' : ''}>
                    <td><div className="flex items-center gap-1" style={{ paddingLeft: (n.depth - 1) * 18 }}>
                      {hasKids ? <button className="btn btn-ghost btn-sm w-5 h-5 p-0 text-ink-2" onClick={() => toggle(key)}>{collapsed.has(key) ? '▸' : '▾'}</button> : <span className="w-5 inline-block" />}
                      <span className="badge badge-muted">{levelLabel(n.level)}</span><span className="truncate max-w-[260px]" title={n.name}>{n.name}</span></div></td>
                    <td className="num"><div className="flex items-center justify-end gap-1">
                      <input className={`input h-7 w-28 text-right num text-sm ${n.mode === 'auto' ? 'text-ink-2 italic' : 'font-semibold'}`} key={`${key}-${n.budget}-${n.mode}`} defaultValue={n.budget != null ? Math.round(n.budget * 100) / 100 : ''} title={n.mode === 'auto' ? t('auto') : t('manual')} onBlur={(e) => { const v = e.target.value.trim(); const cur0 = n.budget != null ? String(Math.round(n.budget * 100) / 100) : ''; if (v !== cur0) save(n.level, n.objectId, v); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                      {n.mode === 'manual' ? <button className="btn btn-ghost btn-sm text-ink-2" title={t('reset_auto')} onClick={() => save(n.level, n.objectId, '')}>↺</button> : <span className="w-6 inline-block text-[10px] text-ink-2">{t('auto')}</span>}
                    </div></td>
                    <td className="num">{fmtMoney(n.spentMtd, cur)}</td>
                    <td className="num">{n.expectedMtd != null ? fmtMoney(n.expectedMtd, cur) : '—'}</td>
                    <td className="num"><div className="leading-tight">{n.pacePct != null ? fmtPct(n.pacePct, 0) : '—'}<div><span className={`badge ${STATUS_BADGE[n.paceStatus]}`}>{label(n.paceStatus)}</span></div></div></td>
                    <td className="num">{n.remaining != null ? <span className={n.remaining < 0 ? 'text-neg' : ''}>{fmtMoney(n.remaining, cur)}</span> : '—'}</td>
                    <td className="num">{n.dailyTarget != null ? fmtMoney(n.dailyTarget, cur, 2) : '—'}</td>
                    <td className="num">{n.dailyNeeded != null ? <span className={n.dailyTarget != null && n.dailyNeeded > n.dailyTarget * 1.15 ? 'text-warn' : ''}>{fmtMoney(n.dailyNeeded, cur, 2)}</span> : '—'}</td>
                    <td className="num"><div className="leading-tight">{fmtMoney(n.spentToday, cur, 2)}{n.todayVsTarget != null && <div className="text-xs text-ink-2">{fmtPct(n.todayVsTarget, 0)}</div>}</div></td>
                    <td className="num">{fmtMoney(n.spentYesterday, cur, 2)}</td>
                    <td className="num"><div className="leading-tight">{fmtMoney(n.last7, cur)}{n.weekVsTarget != null && <div className="text-xs text-ink-2">{fmtPct(n.weekVsTarget, 0)}</div>}</div></td>
                    <td className="num"><div className="leading-tight">{n.projected != null ? fmtMoney(n.projected, cur) : '—'}{n.projectedPct != null && <div className="text-xs"><span className={n.projectedPct > 115 ? 'text-neg' : n.projectedPct < 85 ? 'text-warn' : 'text-pos'}>{fmtPct(n.projectedPct, 0)}</span></div>}</div></td>
                  </tr>
                );
              })}
              {!flat.length && <tr><td colSpan={12} className="text-center text-ink-2" style={{ height: 64 }}>{t('no_data')}</td></tr>}
            </tbody>
          </table></div>
        </>
      )}
    </Section>
  );
}
