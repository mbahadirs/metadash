import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT, type Key } from '@/lib/i18n';
import { fmtDate } from '@/lib/format';
import { studio, useStudioChanged, STUDIO_KEY } from '@/hooks/useStudio';
import { EmptyState, ErrorState, Loading, Modal, Spinner } from '@/components/ui';
import type { AbMetric, AbVariable } from '@/lib/types';
import { PostPicker } from './PostPicker';
import { ExperimentDetail, VerdictBadge } from './ArmResults';
import type { AbTestSummary, ArmPick } from './types';

const VARIABLES: AbVariable[] = ['caption_hook', 'length', 'emoji', 'cta', 'hashtags', 'other'];
const METRICS: AbMetric[] = ['reach_lift', 'er', 'save_rate', 'views_lift'];
const ARM_NAMES = ['A', 'B', 'C', 'D'];

/** Studio → Experiments: A/B caption tests as variant tagging across separately published posts (v1.5 chunk D). */
export function ExperimentsTab() {
  const t = useT();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery<AbTestSummary[]>({ queryKey: [STUDIO_KEY, 'ab', 'list'], queryFn: () => studio.ab.list<AbTestSummary>() });
  useStudioChanged(() => { void qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'ab'] }); }, 'ab');

  if (openId != null) return <ExperimentDetail id={openId} onBack={() => setOpenId(null)} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm text-ink-2 max-w-3xl">{t('exp_intro')}</div>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>{t('exp_new')}</button>
      </div>
      {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} /> : !list.data?.length ? (
        <EmptyState title={t('exp_empty')} hint={t('exp_empty_hint')} action={<button className="btn btn-primary" onClick={() => setCreating(true)}>{t('exp_new')}</button>} />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {list.data.map((x) => (
            <button key={x.id} className="panel p-4 text-left hover:border-accent space-y-2" onClick={() => setOpenId(x.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">{x.name}</div>
                <span className={`badge ${x.status === 'running' ? 'badge-muted' : 'badge-pos'}`}>{t(x.status === 'running' ? 'exp_running' : 'exp_concluded')}</span>
              </div>
              {x.hypothesis && <div className="text-xs text-ink-2 line-clamp-2">{x.hypothesis}</div>}
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                {x.variable && <span>{t(`exp_var_${x.variable}` as Key)}</span>}
                <span>· {t(`exp_metric_${x.metric}` as Key)}</span>
                <span>· {fmtDate(x.createdAt)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <VerdictBadge verdict={x.verdict} winner={x.winner} />
                {x.arms.map((a) => <span key={a.arm} className="badge badge-muted num">{a.arm}: {a.n}/{a.total}{a.mean != null ? ` · ${a.mean.toFixed(2)}×` : ''}</span>)}
              </div>
            </button>
          ))}
        </div>
      )}
      {creating && <CreateDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
    </div>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [variable, setVariable] = useState<AbVariable>('caption_hook');
  const [metric, setMetric] = useState<AbMetric>('reach_lift');
  const [arms, setArms] = useState<Record<string, ArmPick>>({ A: { mediaKeys: [], targetIds: [] }, B: { mediaKeys: [], targetIds: [] } });
  const [active, setActive] = useState('A');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = Object.keys(arms);
  const takenBy = (arm: string) => new Set(names.filter((n) => n !== arm).flatMap((n) => [...arms[n].mediaKeys.map((k) => `m:${k}`), ...arms[n].targetIds.map((id) => `t:${id}`)]));
  const valid = name.trim() && names.every((n) => arms[n].mediaKeys.length + arms[n].targetIds.length > 0);

  const create = async () => {
    if (!valid) { setError(t('exp_need_arms')); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await studio.ab.create({
        name: name.trim(), hypothesis: hypothesis.trim() || undefined, variable, metric,
        arms: names.map((arm) => ({ arm, mediaKeys: arms[arm].mediaKeys, targetIds: arms[arm].targetIds })),
      }) as { id: number };
      await qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'ab'] });
      onCreated(res.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t('exp_new')} width={760}>
      <div className="space-y-3 text-sm">
        <div className="grid md:grid-cols-2 gap-3">
          <label className="space-y-1"><div className="text-xs text-ink-2">{t('exp_name')}</div><input className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label className="space-y-1"><div className="text-xs text-ink-2">{t('exp_hypothesis')}</div><input className="input" maxLength={500} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} /></label>
          <label className="space-y-1">
            <div className="text-xs text-ink-2">{t('exp_variable')}</div>
            <select className="input" value={variable} onChange={(e) => setVariable(e.target.value as AbVariable)}>
              {VARIABLES.map((v) => <option key={v} value={v}>{t(`exp_var_${v}` as Key)}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <div className="text-xs text-ink-2">{t('exp_metric')}</div>
            <select className="input" value={metric} onChange={(e) => setMetric(e.target.value as AbMetric)}>
              {METRICS.map((m) => <option key={m} value={m}>{t(`exp_metric_${m}` as Key)}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {names.map((n) => (
            <button key={n} className={`btn btn-sm ${active === n ? 'btn-primary' : ''}`} onClick={() => setActive(n)}>
              {t('exp_arm', { a: n })} ({arms[n].mediaKeys.length + arms[n].targetIds.length})
            </button>
          ))}
          {names.length < ARM_NAMES.length && (
            <button className="btn btn-ghost btn-sm" onClick={() => { const next = ARM_NAMES[names.length]; setArms({ ...arms, [next]: { mediaKeys: [], targetIds: [] } }); setActive(next); }}>+ {t('exp_add_arm')}</button>
          )}
        </div>
        <PostPicker value={arms[active]} onChange={(v) => setArms({ ...arms, [active]: v })} taken={takenBy(active)} />
        {error && <div className="text-xs text-neg">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy || !valid} onClick={create}>{busy ? <Spinner size={12} /> : null}{t('exp_create')}</button>
        </div>
      </div>
    </Modal>
  );
}
