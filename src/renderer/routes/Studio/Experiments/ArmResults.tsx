import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT, type Key } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { api } from '@/lib/api';
import { fmtDate, fmtPct } from '@/lib/format';
import { studio, useStudioCapabilities, useStudioRequest, STUDIO_KEY } from '@/hooks/useStudio';
import { ErrorState, InfoTip, Loading, Modal, Section, Spinner } from '@/components/ui';
import { PostThumb } from '@/components/PostThumb';
import { Icon } from '@/components/Icons';
import { CostLine } from '../parts';
import { PostPicker } from './PostPicker';
import type { AbArmResult, AbTestDetail, AbVerdict, ArmPick } from './types';

const lift = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(2)}×`);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function VerdictBadge({ verdict, winner }: { verdict: AbVerdict; winner: string | null }) {
  const t = useT();
  const cls = verdict === 'directional' ? 'badge-pos' : verdict === 'inconclusive' ? 'badge-muted' : 'badge-warn';
  return <span className={`badge ${cls}`}>{verdict === 'directional' ? t('exp_verdict_directional', { a: winner ?? '' }) : t(`exp_verdict_${verdict}` as Key)}</span>;
}

/** One experiment: verdict + significance hint, per-arm table (n, mean/median lift, 90% CI), posts, tagging, conclusion. */
export function ExperimentDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery<AbTestDetail>({ queryKey: [STUDIO_KEY, 'ab', 'get', id], queryFn: () => studio.ab.get<AbTestDetail>(id) });
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'ab'] });

  const untag = async (itemId: number) => {
    setError(null);
    try { await studio.call('ab:untag', { testId: id, itemId }); await invalidate(); } catch (e) { setError(errText(e)); }
  };
  const remove = async () => {
    if (!window.confirm(t('exp_delete_confirm'))) return;
    try { await studio.call('ab:delete', { id }); await invalidate(); onBack(); } catch (e) { setError(errText(e)); }
  };

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div className="space-y-3"><button className="btn btn-ghost btn-sm" onClick={onBack}>← {t('exp_back')}</button><ErrorState error={q.error} /></div>;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← {t('exp_back')}</button>
        <button className="btn btn-ghost btn-sm btn-danger" onClick={remove}>{t('exp_delete')}</button>
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{d.name}</h2>
          <span className={`badge ${d.status === 'running' ? 'badge-muted' : 'badge-pos'}`}>{t(d.status === 'running' ? 'exp_running' : 'exp_concluded')}</span>
        </div>
        {d.hypothesis && <div className="text-sm text-ink-2">{d.hypothesis}</div>}
        <div className="text-xs text-ink-2">
          {d.variable ? `${t(`exp_var_${d.variable}` as Key)} · ` : ''}{t(`exp_metric_${d.metric}` as Key)} · {fmtDate(d.createdAt)}
        </div>
      </div>
      <VerdictPanel d={d} />
      <Section title={<span>{t('exp_metric')}: {t(`exp_metric_${d.metric}` as Key)}<InfoTip text={t('exp_lift_hint')} /></span>}>
        <table className="table w-full">
          <thead><tr><th>{t('exp_arm', { a: '' }).trim()}</th><th className="text-right">{t('exp_col_n')}</th><th className="text-right">{t('exp_col_mean')}</th><th className="text-right">{t('exp_col_median')}</th><th className="text-right">{t('exp_col_ci')}</th><th className="text-right">{t('exp_col_excluded')}</th><th /></tr></thead>
          <tbody>
            {d.arms.map((a) => (
              <tr key={a.arm}>
                <td className="font-medium">{a.arm}{d.winner === a.arm && ' ★'}</td>
                <td className="text-right num">{a.n}</td>
                <td className="text-right num">{lift(a.mean)}</td>
                <td className="text-right num">{lift(a.median)}</td>
                <td className="text-right num">{a.ci ? `${a.ci[0].toFixed(2)} – ${a.ci[1].toFixed(2)}` : '—'}</td>
                <td className="text-right num">{a.excluded}</td>
                <td className="text-right">{d.status === 'running' && <button className="btn btn-ghost btn-sm" onClick={() => setAdding(a.arm)}>+ {t('exp_tag_more')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <div className="grid md:grid-cols-2 gap-4">
        {d.arms.map((a) => <ArmPosts key={a.arm} arm={a} running={d.status === 'running'} onRemove={untag} />)}
      </div>
      {error && <div className="text-xs text-neg">{error}</div>}
      <ConclusionPanel d={d} />
      {adding && <AddPostsDialog d={d} arm={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function VerdictPanel({ d }: { d: AbTestDetail }) {
  const t = useT();
  const hint = d.verdict === 'directional' ? t('exp_verdict_directional_hint', { a: d.winner ?? '' })
    : d.verdict === 'inconclusive' ? t('exp_verdict_inconclusive_hint') : t('exp_verdict_need_more_hint', { n: d.minN });
  const best = d.arms.reduce<AbArmResult | null>((b, a) => (a.mean != null && (b?.mean == null || a.mean > b.mean) ? a : b), null);
  return (
    <div className="panel p-4 space-y-1">
      <VerdictBadge verdict={d.verdict} winner={d.winner} />
      <div className="text-sm text-ink-2">{hint}</div>
      {d.probBest != null && best && d.verdict !== 'need_more' && <div className="text-xs text-ink-2 num">{t('exp_prob_best', { a: best.arm, p: fmtPct(d.probBest * 100, 0) })}</div>}
    </div>
  );
}

function ArmPosts({ arm, running, onRemove }: { arm: AbArmResult; running: boolean; onRemove: (itemId: number) => void }) {
  const t = useT();
  return (
    <Section title={t('exp_arm', { a: arm.arm })} right={<span className="text-xs text-ink-2">{t('exp_posts', { n: arm.posts.length })}</span>}>
      <div className="space-y-2">
        {arm.posts.map((p) => (
          <div key={p.itemId} className="flex items-center gap-2 text-sm">
            <PostThumb mediaId={p.mediaKey ?? `t${p.targetId}`} thumbnailPath={p.thumbnailPath} mediaType={p.mediaType ?? 'IMAGE'} mediaProductType={p.mediaProductType ?? 'FEED'} size={32} />
            <div className="flex-1 min-w-0">
              <div className="truncate" title={p.caption ?? ''}>{p.caption || '—'}</div>
              <div className="text-xs text-ink-2">
                {p.username ? `@${p.username} · ` : ''}{p.postedAt ? fmtDate(p.postedAt) : p.scheduledAt ? t('exp_scheduled', { d: fmtDate(p.scheduledAt) }) : ''}
              </div>
            </div>
            {p.excluded ? <span className="badge badge-muted">{t(`exp_excl_${p.excluded}` as Key)}</span> : <span className={`num text-sm ${p.lift != null && p.lift >= 1 ? 'text-pos' : 'text-neg'}`}>{lift(p.lift)}</span>}
            {p.permalink && <button className="btn btn-ghost btn-sm px-1" onClick={() => api.system.openExternal(p.permalink!)} aria-label="open"><Icon.external /></button>}
            {running && <button className="btn btn-ghost btn-sm px-1" onClick={() => onRemove(p.itemId)}>{t('exp_remove')}</button>}
          </div>
        ))}
      </div>
    </Section>
  );
}

function ConclusionPanel({ d }: { d: AbTestDetail }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const qc = useQueryClient();
  const caps = useStudioCapabilities();
  const req = useStudioRequest<AbTestDetail>();
  const [text, setText] = useState(d.conclusion ?? '');
  const [result, setResult] = useState<AbTestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aiOn = caps.data?.enabled === true;

  const conclude = async (summarizeWithAi: boolean) => {
    setError(null);
    try {
      const res = await req.run((requestId) => studio.call<AbTestDetail>('ab:conclude', { id: d.id, conclusion: text.trim() || undefined, summarizeWithAi, requestId, lang }));
      setResult(res);
      setText(res.conclusion ?? '');
      await qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'ab'] });
    } catch (e) {
      setError(errText(e));
    }
  };
  const reopen = async () => {
    try { await studio.call('ab:conclude', { id: d.id, reopen: true }); await qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'ab'] }); } catch (e) { setError(errText(e)); }
  };

  return (
    <Section title={t('exp_conclusion')}>
      <div className="space-y-2">
        <textarea className="input text-sm" rows={3} maxLength={2000} placeholder={t('exp_conclusion_placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-primary" disabled={req.busy} onClick={() => conclude(false)}>{t('exp_conclude')}</button>
          {aiOn && <button className="btn btn-sm" disabled={req.busy} onClick={() => conclude(true)} title={t('exp_summarize_hint')}>{req.busy ? <Spinner size={12} /> : null}{t('exp_summarize_ai')}</button>}
          {req.busy && <button className="btn btn-ghost btn-sm" onClick={req.cancel}>{t('cancel')}</button>}
          {d.status === 'concluded' && <button className="btn btn-ghost btn-sm" onClick={reopen}>{t('exp_reopen')}</button>}
          {result?.usage && <CostLine usage={result.usage} costUsd={result.costUsd} caps={caps.data} />}
        </div>
        {aiOn && <div className="text-xs text-ink-2">{t('exp_summarize_hint')}</div>}
        {error && <div className="text-xs text-neg">{error}</div>}
      </div>
    </Section>
  );
}

function AddPostsDialog({ d, arm, onClose }: { d: AbTestDetail; arm: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [pick, setPick] = useState<ArmPick>({ mediaKeys: [], targetIds: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taken = new Set(d.arms.flatMap((a) => a.posts.flatMap((p) => [p.mediaKey ? `m:${p.mediaKey}` : null, p.targetId ? `t:${p.targetId}` : null].filter((x): x is string => !!x))));

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const mediaKey of pick.mediaKeys) await studio.ab.tag({ testId: d.id, arm, mediaKey });
      for (const targetId of pick.targetIds) await studio.ab.tag({ testId: d.id, arm, targetId });
      await qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'ab'] });
      onClose();
    } catch (e) {
      setError(errText(e));
      await qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'ab'] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${t('exp_tag_more')} · ${t('exp_arm', { a: arm })}`} width={720}>
      <div className="space-y-3">
        <PostPicker value={pick} onChange={setPick} taken={taken} />
        {error && <div className="text-xs text-neg">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy || !(pick.mediaKeys.length + pick.targetIds.length)} onClick={add}>{busy ? <Spinner size={12} /> : null}{t('exp_add')}</button>
        </div>
      </div>
    </Modal>
  );
}
