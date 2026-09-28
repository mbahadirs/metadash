import { useState } from 'react';
import { useAccounts, useCompetitors, useCompetitorCompare, useApiMutation } from '@/hooks/queries';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { fmtNum, fmtDate } from '@/lib/format';
import { Avatar, Delta, EmptyState, Loading, Section } from '@/components/ui';
import { ChartWrapper } from '@/charts/ChartWrapper';
import { CompareChart } from '@/charts/CompareChart';
import { Icon } from '@/components/Icons';
import { useRunSync } from '@/hooks/useSyncEvents';
import { ExcelButton } from '@/components/ExcelButton';

export function CompetitorsPage() {
  const t = useT();
  const accounts = useAccounts();
  const all = useCompetitors();
  const [igId, setIgId] = useState('');
  const [username, setUsername] = useState('');
  const runSync = useRunSync();
  const add = useApiMutation<{ username: string; igId: string }>((p) => api.competitors.add(p), ['competitors', 'competitorCompare']);
  const remove = useApiMutation<number>((id) => api.competitors.remove(id), ['competitors', 'competitorCompare']);
  const cmp = useCompetitorCompare(igId || undefined);
  const withCompetitors = new Set((all.data ?? []).map((c) => c.linkedIgId));

  return (
    <div className="flex gap-6 h-full">
      <aside className="w-64 flex-none panel flex flex-col">
        <div className="p-3 border-b border-line text-xs text-ink-2">{t('accounts')}</div>
        <div className="overflow-auto flex-1">{(accounts.data ?? []).map((a) => (
          <button key={a.igId} className={`w-full flex items-center gap-2 px-3 h-9 text-left hover:bg-surface-2 ${igId === a.igId ? 'bg-surface-2' : ''}`} onClick={() => setIgId(a.igId)}>
            <Avatar username={a.username} url={a.profilePicUrl} color={a.color} size={20} /><span className="truncate flex-1">@{a.username}</span>
            {withCompetitors.has(a.igId) && <span className="text-xs text-ink-2 num">{(all.data ?? []).filter((c) => c.linkedIgId === a.igId).length}</span>}
          </button>
        ))}</div>
      </aside>
      <div className="flex-1 min-w-0 space-y-5">
        <div className="text-xs text-ink-2 flex items-center gap-1"><Icon.warn /> {t('competitor_note')}</div>
        {!igId ? <EmptyState title={t('select_accounts').replace(' (2–6)', '')} /> : (
          <>
            <form className="flex gap-2 items-center" onSubmit={(e) => { e.preventDefault(); if (username.trim()) { add.mutate({ username: username.trim(), igId }); setUsername(''); } }}>
              <input className="input w-64" placeholder={`@${t('username').toLowerCase()}`} value={username} onChange={(e) => setUsername(e.target.value)} />
              <button className="btn btn-primary" type="submit" disabled={!username.trim() || add.isPending}>{t('add_competitor')}</button>
              <button className="btn" type="button" onClick={() => runSync({ scope: 'competitors', igIds: [igId] })}><Icon.refresh />{t('update')}</button>
              {add.error && <span className="text-neg text-xs">{add.error.message}</span>}
            </form>
            {cmp.isLoading ? <Loading /> : cmp.data && cmp.data.rows.length > 1 ? (
              <>
                <ChartWrapper id={`competitors-${igId}`} title={t('followers')} height={300}>
                  <CompareChart merged={(cmp.data.rows[0]?.series ?? []).map((s, i) => Object.fromEntries([['date', s.date], ...cmp.data!.rows.map((r) => [r.username, r.series[i]?.followers ?? null])]))} series={cmp.data.rows.map((r) => ({ igId: r.username, username: r.username, color: r.color }))} />
                </ChartWrapper>
                <Section title={t('competitors')} right={<ExcelButton name="competitors" getData={() => ({ name: t('competitors'), columns: [{ key: 'username', label: t('username'), type: 'text' }, { key: 'followers', label: t('followers'), type: 'int' }, { key: 'growth', label: t('growth'), type: 'int' }, { key: 'growthPct', label: `${t('growth')} %`, type: 'percent' }, { key: 'postsPerWeek', label: t('posts_per_week'), type: 'float' }, { key: 'avgLikes', label: t('avg_likes'), type: 'int' }, { key: 'avgComments', label: t('avg_comments'), type: 'int' }], rows: cmp.data!.rows })} />}>
                  <div className="-m-4 overflow-auto"><table className="table">
                    <thead><tr><th>{t('username')}</th><th className="num">{t('followers')}</th><th className="num">{t('growth')}</th><th className="num">{t('posts_per_week')}</th><th className="num">{t('avg_likes')}</th><th className="num">{t('avg_comments')}</th><th>{t('last_sync')}</th><th></th></tr></thead>
                    <tbody>{cmp.data.rows.map((r) => (
                      <tr key={r.username} className={r.isOwn ? 'selected' : ''}><td><span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: r.color }} />@{r.username}{r.isOwn && <span className="badge badge-muted ml-2">{t('you')}</span>}</td><td className="num">{fmtNum(r.followers)}</td><td className="num"><Delta value={r.growthPct} /> <span className="text-ink-2">{r.growth != null ? (r.growth >= 0 ? '+' : '') + fmtNum(r.growth) : ''}</span></td><td className="num">{r.postsPerWeek ?? '—'}</td><td className="num">{fmtNum(r.avgLikes)}</td><td className="num">{fmtNum(r.avgComments)}</td><td className="text-ink-2">{r.isOwn ? '' : r.lastDate ? fmtDate(r.lastDate) : '—'}</td><td>{!r.isOwn && r.id != null && <button className="btn btn-ghost btn-sm btn-danger" onClick={() => remove.mutate(r.id!)}>{t('delete')}</button>}</td></tr>
                    ))}</tbody>
                  </table></div>
                </Section>
              </>
            ) : <EmptyState title={t('none')} hint={t('competitor_note')} />}
          </>
        )}
      </div>
    </div>
  );
}
