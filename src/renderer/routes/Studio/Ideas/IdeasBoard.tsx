import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useT, contentLangFor, type ContentLang } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { useAccounts } from '@/hooks/queries';
import { STUDIO_KEY, studio, useStudioCapabilities, useStudioRequest } from '@/hooks/useStudio';
import { EmptyState, InfoTip, Spinner } from '@/components/ui';
import { errorText } from '@/routes/Planner/lib';
import { PLATFORMS } from '@/lib/platforms';
import type { ContentIdea, IdeasGenerateResult } from '@/lib/types';
import { CostLine } from '../parts';
import { IdeaCard } from './IdeaCard';
import { SendPanel } from './SendPanel';
import { SpecialDaysEditor, type CustomDay } from './SpecialDaysEditor';

interface SpecialDay { id: string; date: string; name: string; region: string; approx: boolean; solemn: boolean; custom: boolean }
type Schedule = 'suggested' | 'none';
type Lang = ContentLang;

const pad = (n: number) => String(n).padStart(2, '0');
/** This month until the 20th, then next month. */
function defaultMonth(now = new Date()): string {
  const d = now.getDate() >= 20 ? new Date(now.getFullYear(), now.getMonth() + 1, 1) : now;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function monthBounds(now = new Date()) {
  const max = new Date(now.getFullYear(), now.getMonth() + 12, 1);
  return { min: `${now.getFullYear()}-${pad(now.getMonth() + 1)}`, max: `${max.getFullYear()}-${pad(max.getMonth() + 1)}` };
}
const splitPillars = (s: string) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 8);

/** Studio → Ideas: monthly content ideas per account → Planner drafts (best-time slots optional). */
export function IdeasBoard() {
  const t = useT();
  const navigate = useNavigate();
  const uiLang = useAppStore((s) => s.lang);
  const accountsQ = useAccounts({ onlyTracked: true });
  const caps = useStudioCapabilities();
  const accounts = useMemo(() => [...(accountsQ.data ?? [])].sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform) || a.username.localeCompare(b.username)), [accountsQ.data]);
  const [accountId, setAccountId] = useState('');
  const [month, setMonth] = useState(defaultMonth);
  const [count, setCount] = useState(12);
  const [lang, setLang] = useState<Lang>(contentLangFor(uiLang));
  const [pillarText, setPillarText] = useState('');
  const [includeDays, setIncludeDays] = useState(true);
  const [editDays, setEditDays] = useState(false);
  const [result, setResult] = useState<IdeasGenerateResult | null>(null);
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [schedule, setSchedule] = useState<Schedule>('suggested');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ n: number; month: string } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const req = useStudioRequest<IdeasGenerateResult>();

  const account = accountId || accounts[0]?.igId || '';
  const bounds = monthBounds();
  const daysQ = useQuery<{ days: SpecialDay[]; custom: CustomDay[] }>({
    queryKey: [STUDIO_KEY, 'ideas-days', month, lang],
    queryFn: () => studio.call('ideas:days', { month, lang }),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
  const params = useMemo(() => ({ accountId: account, month, count, pillars: splitPillars(pillarText), langs: [lang], includeSpecialDays: includeDays }), [account, month, count, pillarText, lang, includeDays]);
  const canGenerate = !!account && /^\d{4}-\d{2}$/.test(month) && count >= 1 && count <= 31;

  const generate = async () => {
    setError(null);
    setCreated(null);
    try {
      const res = await req.run((requestId) => studio.ideas.generate({ ...params, requestId }));
      setResult(res);
      setIdeas(res.ideas);
      setSelected(new Set(res.ideas.map((i) => i.id)));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const toDrafts = async () => {
    const chosen = ideas.filter((i) => selected.has(i.id));
    if (!chosen.length) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await studio.call<{ postIds: number[] }>('ideas:toDrafts', { accountId: account, ideas: chosen, schedule, month });
      setCreated({ n: res.postIds.length, month });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setDrafting(false);
    }
  };

  const toggle = (id: string) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const days = daysQ.data?.days ?? [];

  if (!accountsQ.isLoading && !accounts.length) return <EmptyState title={t('ideas_pick_account')} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2 max-w-3xl">{t('ideas_intro')}</p>
      <div className="panel p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-5">
          <Labeled label={t('ideas_account')}>
            <select className="input w-full" value={account} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.igId} value={a.igId}>{a.platform === 'instagram' ? '' : `${a.platform === 'facebook' ? 'FB' : 'Threads'} · `}@{a.username}</option>)}
            </select>
          </Labeled>
          <Labeled label={t('ideas_month')}>
            <input type="month" className="input w-full" value={month} min={bounds.min} max={bounds.max} onChange={(e) => setMonth(e.target.value)} />
          </Labeled>
          <Labeled label={t('ideas_count')}>
            <input type="number" className="input w-full num" min={1} max={31} value={count} onChange={(e) => setCount(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} />
          </Labeled>
          <Labeled label={t('ideas_lang')}>
            <select className="input w-full" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="tr">{t('ideas_lang_tr')}</option>
              <option value="en">{t('ideas_lang_en')}</option>
            </select>
          </Labeled>
          <Labeled label={t('ideas_pillars')} tip={t('ideas_pillars_hint')}>
            <input className="input w-full" value={pillarText} placeholder={t('ideas_pillars_ph')} maxLength={400} onChange={(e) => setPillarText(e.target.value)} />
          </Labeled>
        </div>

        <div className="rounded border border-line p-3 text-sm space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeDays} onChange={(e) => setIncludeDays(e.target.checked)} />{t('ideas_include_days')}</label>
            <span className="flex-1" />
            <button type="button" className="btn btn-sm" onClick={() => setEditDays(true)}>{t('ideas_days_edit')}</button>
          </div>
          <div className="text-xs text-ink-2">{t('ideas_days_title')}</div>
          {daysQ.isLoading ? <Spinner size={14} /> : days.length ? (
            <div className="flex flex-wrap gap-1.5">
              {days.map((d) => (
                <span key={d.id} className={`badge ${d.custom ? 'badge-pos' : 'badge-muted'} ${includeDays ? '' : 'opacity-50'}`}>
                  <span className="num">{d.date.slice(8)}</span>&nbsp;{d.name}
                  {d.approx && <span className="ml-1 text-warn" title={t('ideas_days_approx_tip')}>({t('ideas_days_approx')})</span>}
                  {d.solemn && <span className="ml-1" title={t('ideas_days_solemn_tip')}>({t('ideas_days_solemn')})</span>}
                </span>
              ))}
            </div>
          ) : <div className="text-xs text-ink-2">{t('ideas_days_none')}</div>}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={!canGenerate || req.busy} onClick={generate}>
            {req.busy ? t('ideas_generating') : ideas.length ? t('ideas_regenerate') : t('ideas_generate')}
          </button>
          {req.busy && <><Spinner size={14} /><button type="button" className="btn btn-sm" onClick={req.cancel}>{t('studio_cancel')}</button></>}
          {result && !req.busy && <CostLine usage={result.usage} costUsd={result.costUsd} caps={caps.data} />}
        </div>
        <SendPanel feature="ideas" params={params} enabled={canGenerate} />
        {error && <div className="text-neg text-sm" role="alert">{error}</div>}
      </div>

      {ideas.length ? (
        <>
          <div className="panel p-3 flex flex-wrap items-center gap-3 text-sm sticky top-0 z-10">
            <span className="font-medium">{t('ideas_selected', { n: selected.size })}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set(ideas.map((i) => i.id)))}>{t('ideas_select_all')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>{t('ideas_select_none')}</button>
            <span className="flex-1" />
            <span className="text-ink-2">{t('ideas_schedule')}</span>
            <label className="flex items-center gap-1.5" title={t('ideas_schedule_suggested_hint')}><input type="radio" name="ideas-schedule" checked={schedule === 'suggested'} onChange={() => setSchedule('suggested')} />{t('ideas_schedule_suggested')}</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="ideas-schedule" checked={schedule === 'none'} onChange={() => setSchedule('none')} />{t('ideas_schedule_none')}</label>
            <button type="button" className="btn btn-primary btn-sm" disabled={!selected.size || drafting} onClick={toDrafts}>{t('ideas_to_drafts', { n: selected.size })}</button>
          </div>
          {created && (
            <div className="panel px-4 py-2 text-sm flex items-center gap-3" role="status">
              <span className="flex-1">{t('ideas_created', { n: created.n })}</span>
              <button type="button" className="btn btn-sm" onClick={() => navigate(`/planner?date=${created.month}-01`)}>{t('ideas_open_planner')}</button>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ideas.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} selected={selected.has(idea.id)} onToggle={() => toggle(idea.id)}
                onChange={(next) => setIdeas((cur) => cur.map((i) => (i.id === next.id ? next : i)))} />
            ))}
          </div>
        </>
      ) : !req.busy && <div className="panel p-8 text-center text-ink-2 text-sm">{t('ideas_empty')}</div>}

      <SpecialDaysEditor open={editDays} initial={daysQ.data?.custom ?? []} onClose={() => setEditDays(false)} />
    </div>
  );
}

function Labeled({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="flex items-center gap-1 text-xs text-ink-2 mb-1">{label}{tip && <InfoTip text={tip} />}</span>
      {children}
    </label>
  );
}
