import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { fmtNum, fmtDate } from '@/lib/format';
import type { Anomaly } from '@/lib/types';
import { Section, Modal, Loading } from '@/components/ui';
import { useAppStore } from '@/store/app';
import { useAiEnabled, type AiAnswer } from '@/hooks/useAi';

const COLLAPSED = 5;
type Explained = { anomaly: Anomaly; text?: string; model?: string; truncated?: boolean; error?: string };

/** "Needs attention": ±2σ anomalies with an optional AI "Explain" action per row. */
export function AttentionPanel({ anomalies }: { anomalies: Anomaly[] }) {
  const t = useT();
  const nav = useNavigate();
  const lang = useAppStore((s) => s.lang);
  const aiEnabled = useAiEnabled();
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<Explained | null>(null);
  if (!anomalies.length) return null;
  const shown = expanded ? anomalies : anomalies.slice(0, COLLAPSED);
  const fmtVal = (a: Anomaly) => (a.kind === 'reach' ? fmtNum(a.value) : `%${fmtNum(a.value, 2)}`);
  const fmtMean = (a: Anomaly) => (a.kind === 'reach' ? fmtNum(a.mean) : `%${fmtNum(a.mean, 2)}`);

  const explain = async (a: Anomaly) => {
    setOpen({ anomaly: a });
    try {
      const res = await call<AiAnswer>(api.ai.explainAnomaly({ igId: a.igId, date: a.date, kind: a.kind, mediaId: a.mediaId, lang }));
      setOpen((cur) => (cur?.anomaly === a ? { anomaly: a, text: res.text, model: res.model, truncated: res.truncated } : cur));
    } catch (e) {
      setOpen((cur) => (cur?.anomaly === a ? { anomaly: a, error: (e as Error).message } : cur));
    }
  };

  return (
    <Section title={`${t('attention')} · ${anomalies.length}`} className="col-span-12" right={anomalies.length > COLLAPSED && <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(!expanded)}>{expanded ? t('attention_show_less') : t('attention_show_all', { n: anomalies.length })}</button>}>
      <div className="-my-2 divide-y divide-line">
        {shown.map((a) => (
          <div key={`${a.igId}-${a.kind}-${a.date}-${a.mediaId ?? ''}`} className="flex items-center gap-3 h-9 text-sm">
            <button className="font-medium hover:underline" onClick={() => nav(`/account/${a.igId}`)}>@{a.username}</button>
            <span className={`badge ${a.direction === 'up' ? 'badge-pos' : 'badge-neg'}`}>{a.kind === 'reach' ? t('reach') : 'ER'} {a.direction === 'up' ? '▲' : '▼'} {Math.abs(a.z)}σ</span>
            <span className="text-ink-2 num">{fmtDate(a.date)}</span>
            <span className="num">{fmtVal(a)} <span className="text-ink-2">· {t('anomaly_vs_mean', { m: fmtMean(a) })}</span></span>
            {aiEnabled && <button className="btn btn-ghost btn-sm ml-auto" onClick={() => explain(a)}>✦ {t('ai_explain')}</button>}
          </div>
        ))}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? t('ai_explain_title', { u: open.anomaly.username }) : ''}>
        {open && (open.error ? <div className="text-sm text-neg">{open.error}</div>
          : open.text == null ? <Loading label={t('ai_explaining')} />
          : <div className="space-y-3">
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{open.text}</div>
              <div className="text-xs text-ink-2 border-t border-line pt-2">{t('ai_disclaimer')}{open.truncated ? ` ${t('ai_truncated')}` : ''} · {open.model}</div>
            </div>)}
      </Modal>
    </Section>
  );
}
