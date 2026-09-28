import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { fmtNum, fmtPct, fmtMoney } from '@/lib/format';
import type { AdAccountRow, BudgetPacing, Media } from '@/lib/types';
import { Delta, Section, EmptyState, Loading } from '@/components/ui';
import { ExcelButton } from '@/components/ExcelButton';
import { PostThumb } from '@/components/PostThumb';
import { TypeBadge } from '@/components/TypeFilter';
import { useBudget, useBoostCandidates } from '@/hooks/queries';
import { BudgetTreePanel } from './BudgetTree';

/** One row per ad account with the metric set requested by the agency. */
export function AdAccountsTable({ rows }: { rows: AdAccountRow[] }) {
  const t = useT();
  const money = (v: number | null | undefined, cur: string, d = 0) => fmtMoney(v, cur, d);
  const columns = [
    { key: 'name', label: t('ad_account'), type: 'text' as const }, { key: 'currency', label: t('currency'), type: 'text' as const }, { key: 'linkedUsername', label: t('linked_account'), type: 'text' as const },
    { key: 'results', label: t('results'), type: 'int' as const }, { key: 'resultType', label: t('result_type'), type: 'text' as const }, { key: 'costPerResult', label: t('cost_per_result'), type: 'money' as const }, { key: 'monthlyBudget', label: t('monthly_budget'), type: 'money' as const }, { key: 'spend', label: t('spend'), type: 'money' as const },
    { key: 'impressions', label: t('impressions'), type: 'int' as const }, { key: 'reach', label: t('reach'), type: 'int' as const }, { key: 'frequency', label: t('frequency'), type: 'float' as const }, { key: 'cpc', label: 'CPC', type: 'money' as const }, { key: 'ctr', label: 'CTR %', type: 'percent' as const }, { key: 'cpm', label: 'CPM', type: 'money' as const },
    { key: 'postEngagement', label: t('post_engagement'), type: 'int' as const }, { key: 'costPerPostEngagement', label: t('cost_per_post_engagement'), type: 'money' as const }, { key: 'pageEngagement', label: t('page_engagement'), type: 'int' as const }, { key: 'costPerPageEngagement', label: t('cost_per_page_engagement'), type: 'money' as const },
  ];
  return (
    <Section title={`${t('ad_accounts_table')} · ${rows.length}`} right={<ExcelButton name="ad-accounts" title={t('ad_accounts_table')} getData={() => ({ name: t('ad_accounts_table'), columns, rows })} />}>
      <div className="-m-4 overflow-auto max-h-[480px]"><table className="table">
        <thead><tr><th>{t('ad_account')}</th><th className="num">{t('results')}</th><th className="num">{t('cost_per_result')}</th><th className="num">{t('budget')}</th><th className="num">{t('spend')}</th><th className="num">{t('impressions')}</th><th className="num">{t('reach')}</th><th className="num">{t('frequency')}</th><th className="num">CPC</th><th className="num">CTR</th><th className="num">CPM</th><th className="num">{t('post_engagement')}</th><th className="num">{t('cost_per_post_engagement')}</th><th className="num">{t('page_engagement')}</th><th className="num">{t('cost_per_page_engagement')}</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.actId}>
            <td><div className="leading-tight"><div className="font-medium">{r.name}</div><div className="text-xs text-ink-2">{r.currency}{r.linkedUsername ? ` · @${r.linkedUsername}` : ''}{r.status !== 'ACTIVE' ? ` · ${r.status}` : ''}</div></div></td>
            <td className="num"><div className="leading-tight">{fmtNum(r.results)}<div className="text-xs"><Delta value={r.resultsChangePct} /> <span className="text-ink-2">{r.resultType ?? ''}</span></div></div></td>
            <td className="num">{money(r.costPerResult, r.currency, 2)}</td>
            <td className="num">{r.monthlyBudget != null ? money(r.monthlyBudget, r.currency) : <span className="text-ink-2">—</span>}</td>
            <td className="num"><div className="leading-tight">{money(r.spend, r.currency)}<div className="text-xs"><Delta value={r.spendChangePct} /></div></div></td>
            <td className="num">{fmtNum(r.impressions)}</td><td className="num"><div className="leading-tight">{fmtNum(r.reach)}<div className="text-xs"><Delta value={r.reachChangePct} /></div></div></td>
            <td className="num">{fmtNum(r.frequency, 2)}</td><td className="num">{money(r.cpc, r.currency, 2)}</td><td className="num">{fmtPct(r.ctr, 2)}</td><td className="num">{money(r.cpm, r.currency, 2)}</td>
            <td className="num">{fmtNum(r.postEngagement)}</td><td className="num">{money(r.costPerPostEngagement, r.currency, 2)}</td><td className="num">{fmtNum(r.pageEngagement)}</td><td className="num">{money(r.costPerPageEngagement, r.currency, 2)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Section>
  );
}

const STATUS_BADGE: Record<BudgetPacing['paceStatus'], string> = { under: 'badge-warn', on: 'badge-pos', over: 'badge-neg', no_budget: 'badge-muted' };

/** Budget pacing per ad account with inline budget editing and boost candidates for under-pace accounts. */
export function BudgetTracking() {
  const t = useT();
  const qc = useQueryClient();
  const q = useBudget();
  const [openAct, setOpenAct] = useState<string | null>(null);
  const save = async (actId: string, value: string) => {
    await call(api.ads.setBudget({ actId, monthlyBudget: value === '' ? null : Number(value.replace(',', '.')) }));
    qc.invalidateQueries({ queryKey: ['budget'] }); qc.invalidateQueries({ queryKey: ['adAccounts'] }); qc.invalidateQueries({ queryKey: ['adInsights'] });
  };
  if (q.isLoading) return <Loading />;
  const rows = q.data ?? [];
  if (!rows.length) return <EmptyState title={t('no_ad_account')} />;
  const label = (s: BudgetPacing['paceStatus']) => (s === 'under' ? t('pace_under') : s === 'on' ? t('pace_on') : s === 'over' ? t('pace_over') : t('no_budget'));
  const columns = [
    { key: 'name', label: t('ad_account'), type: 'text' as const }, { key: 'currency', label: t('currency'), type: 'text' as const }, { key: 'budget', label: t('monthly_budget'), type: 'money' as const }, { key: 'spentMtd', label: t('spent_mtd'), type: 'money' as const }, { key: 'expectedMtd', label: t('expected_mtd'), type: 'money' as const }, { key: 'pacePct', label: `${t('pace')} %`, type: 'percent' as const }, { key: 'statusLabel', label: t('status'), type: 'text' as const },
    { key: 'remaining', label: t('remaining'), type: 'money' as const }, { key: 'dailyTarget', label: t('daily_target'), type: 'money' as const }, { key: 'dailyNeeded', label: t('daily_needed'), type: 'money' as const }, { key: 'spentToday', label: t('today'), type: 'money' as const }, { key: 'spentYesterday', label: t('yesterday'), type: 'money' as const }, { key: 'weeklyTarget', label: t('weekly_target'), type: 'money' as const }, { key: 'last7', label: t('last7_spend'), type: 'money' as const }, { key: 'projected', label: t('projected'), type: 'money' as const }, { key: 'projectedPct', label: `${t('projected')} %`, type: 'percent' as const },
  ];
  const m = rows[0].month;
  return (
    <>
    <Section title={`${t('budget_tracking')} · ${m.from} – ${m.to} · ${m.elapsed}/${m.daysInMonth} ${t('days_unit')}`} right={<><span className="text-xs text-ink-2 max-w-md truncate" title={t('budget_hint')}>{t('budget_hint')}</span><ExcelButton name="budget-tracking" title={t('budget_tracking')} getData={() => ({ name: t('budget_tracking'), columns, rows: rows.map((r) => ({ ...r, statusLabel: label(r.paceStatus) })) })} /></>}>
      <div className="-m-4 overflow-auto max-h-[520px]"><table className="table">
        <thead><tr><th>{t('ad_account')}</th><th className="num">{t('monthly_budget')}</th><th className="num">{t('spent_mtd')}</th><th className="num">{t('expected_mtd')}</th><th className="num">{t('pace')}</th><th className="num">{t('remaining')}</th><th className="num">{t('daily_target')}</th><th className="num">{t('daily_needed')}</th><th className="num">{t('today')}</th><th className="num">{t('yesterday')}</th><th className="num">{t('last7_spend')} / {t('weekly_target').toLowerCase()}</th><th className="num">{t('projected')}</th><th></th></tr></thead>
        <tbody>{rows.map((r) => (
          <>
            <tr key={r.actId} className={openAct === r.actId ? 'selected' : ''}>
              <td><div className="leading-tight"><div className="font-medium">{r.name}</div><div className="text-xs text-ink-2">{r.currency}{r.linkedUsername ? ` · @${r.linkedUsername}` : ''}</div></div></td>
              <td className="num"><input className="input h-7 w-28 text-right num text-sm" defaultValue={r.budget ?? ''} placeholder={t('set_budget')} onBlur={(e) => { if (String(r.budget ?? '') !== e.target.value) save(r.actId, e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></td>
              <td className="num">{fmtMoney(r.spentMtd, r.currency)}</td>
              <td className="num">{r.expectedMtd != null ? fmtMoney(r.expectedMtd, r.currency) : '—'}</td>
              <td className="num"><div className="leading-tight">{r.pacePct != null ? fmtPct(r.pacePct, 0) : '—'}<div><span className={`badge ${STATUS_BADGE[r.paceStatus]}`}>{label(r.paceStatus)}</span></div></div></td>
              <td className="num">{r.remaining != null ? <span className={r.remaining < 0 ? 'text-neg' : ''}>{fmtMoney(r.remaining, r.currency)}</span> : '—'}</td>
              <td className="num">{r.dailyTarget != null ? fmtMoney(r.dailyTarget, r.currency) : '—'}</td>
              <td className="num">{r.dailyNeeded != null ? <span className={r.dailyTarget != null && r.dailyNeeded > r.dailyTarget * 1.15 ? 'text-warn' : ''}>{fmtMoney(r.dailyNeeded, r.currency)}</span> : '—'}</td>
              <td className="num"><div className="leading-tight">{fmtMoney(r.spentToday, r.currency)}{r.todayVsTarget != null && <div className="text-xs text-ink-2">{fmtPct(r.todayVsTarget, 0)}</div>}</div></td>
              <td className="num">{fmtMoney(r.spentYesterday, r.currency)}</td>
              <td className="num"><div className="leading-tight">{fmtMoney(r.last7, r.currency)}{r.weeklyTarget != null && <div className="text-xs text-ink-2">/ {fmtMoney(r.weeklyTarget, r.currency)} · {fmtPct(r.weekVsTarget, 0)}</div>}</div></td>
              <td className="num"><div className="leading-tight">{r.projected != null ? fmtMoney(r.projected, r.currency) : '—'}{r.projectedPct != null && <div className="text-xs"><span className={r.projectedPct > 115 ? 'text-neg' : r.projectedPct < 85 ? 'text-warn' : 'text-pos'}>{fmtPct(r.projectedPct, 0)}</span></div>}</div></td>
              <td>{r.linkedIgId && <button className={`btn btn-sm ${r.paceStatus === 'under' ? 'btn-primary' : ''}`} onClick={() => setOpenAct(openAct === r.actId ? null : r.actId)}>{t('boost_candidates')}</button>}</td>
            </tr>
            {openAct === r.actId && <tr key={`${r.actId}-boost`}><td colSpan={13} style={{ height: 'auto', whiteSpace: 'normal', padding: 0 }}><BoostPanel actId={r.actId} /></td></tr>}
          </>
        ))}</tbody>
      </table></div>
    </Section>
    <BudgetTreePanel accounts={rows} />
    </>
  );
}

function BoostPanel({ actId }: { actId: string }) {
  const t = useT();
  const q = useBoostCandidates(actId);
  if (q.isLoading) return <div className="p-4"><Loading /></div>;
  const list: Media[] = q.data?.candidates ?? [];
  return (
    <div className="p-4 bg-surface-2/40 border-b border-line">
      <div className="text-xs text-ink-2 mb-2">{t('boost_hint')} {q.data?.account?.linkedUsername && <Link to={`/account/${q.data.account.linkedIgId}`}>@{q.data.account.linkedUsername} →</Link>}</div>
      {list.length === 0 ? <div className="text-sm text-ink-2">{t('none')}</div> : (
        <div className="grid grid-cols-4 xl:grid-cols-8 gap-2">{list.map((m) => (
          <div key={m.mediaId} className="panel p-2 text-xs">
            <div className="aspect-[4/5]"><PostThumb mediaId={m.mediaId} thumbnailPath={m.thumbnailPath} mediaType={m.mediaType} mediaProductType={m.mediaProductType} size="100%" rounded={4} /></div>
            <div className="flex items-center justify-between mt-1.5"><TypeBadge typeKey={m.mediaProductType === 'REELS' ? 'reels' : m.mediaType === 'CAROUSEL_ALBUM' ? 'carousel' : m.mediaType === 'VIDEO' ? 'video' : 'image'} /><span className="text-ink-2">{new Date(m.postedAt).toLocaleDateString()}</span></div>
            <div className="truncate mt-1">{m.caption}</div>
            <div className="flex justify-between mt-1 num"><span>{fmtNum(m.reach)} {t('reach').toLowerCase()}</span><span>ER {fmtPct(m.engagementRate, 2)}</span></div>
            {m.permalink && <button className="btn btn-ghost btn-sm mt-1 w-full" onClick={() => api.system.openExternal(m.permalink!)}>{t('open_in_instagram')}</button>}
          </div>
        ))}</div>
      )}
    </div>
  );
}
