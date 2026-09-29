import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT, contentLangFor, type ContentLang } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { fmtDateTime } from '@/lib/format';
import { ErrorState, InfoTip, Loading, Section, Toggle } from '@/components/ui';
import { STUDIO_KEY, studio, useStudioCapabilities, useStudioChanged, useStudioRequest } from '@/hooks/useStudio';
import type { BrandVoice, BrandVoiceProfile, StudioCost } from '@/lib/types';
import { SendPreview } from '@/routes/Planner/Composer/SendPreview';
import { CostBadge } from '@/routes/Planner/Composer/CostBadge';
import { errorText } from '@/routes/Planner/lib';
import { VoiceStats, type VoiceStatsData } from './VoiceStats';
import { lineDiff } from './diff';

type Voice = BrandVoice & { stats?: VoiceStatsData };
type Derived = StudioCost & { proposal: { brief: string; profile: BrandVoiceProfile }; derivedFrom?: number; visionUsed?: boolean; visionDropped?: boolean };
type Lang = ContentLang;
const LIST_FIELDS = ['tone', 'hooks', 'ctaPatterns', 'doList', 'dontList'] as const;
type ListField = (typeof LIST_FIELDS)[number];
interface Form { brief: string; formality: string; pronoun: string; visualStyle: string; lists: Record<ListField, string> }

const toForm = (brief: string, p: BrandVoiceProfile | null | undefined): Form => ({
  brief,
  formality: p?.formality ?? '',
  pronoun: p?.pronoun ?? '',
  visualStyle: typeof p?.visualStyle === 'string' ? p.visualStyle : '',
  lists: Object.fromEntries(LIST_FIELDS.map((k) => [k, ((p?.[k] as string[] | undefined) ?? []).join('\n')])) as Record<ListField, string>,
});

/** Form → profile, keeping measured fields (avgLength, emoji…, sampleMediaIds) from the base profile. */
function toProfile(f: Form, base: BrandVoiceProfile | null | undefined): BrandVoiceProfile {
  const lists = Object.fromEntries(LIST_FIELDS.map((k) => [k, f.lists[k].split('\n').map((s) => s.trim()).filter(Boolean)]));
  return {
    ...(base ?? {}),
    ...lists,
    formality: f.formality || undefined,
    pronoun: f.pronoun === 'sen' || f.pronoun === 'siz' ? f.pronoun : undefined,
    visualStyle: f.visualStyle.trim() || undefined,
  };
}

const LABELS: Record<ListField, 'sv_tone' | 'sv_hooks' | 'sv_ctas' | 'sv_do' | 'sv_dont'> = { tone: 'sv_tone', hooks: 'sv_hooks', ctaPatterns: 'sv_ctas', doList: 'sv_do', dontList: 'sv_dont' };

function DiffView({ before, after }: { before: string; after: string }) {
  const t = useT();
  const diff = useMemo(() => lineDiff(before, after), [before, after]);
  if (!diff.some((d) => d.op !== 'same')) return <div className="text-xs text-ink-2">{t('sv_diff_none')}</div>;
  return (
    <pre className="text-xs whitespace-pre-wrap rounded border border-line p-2 max-h-72 overflow-auto font-[inherit]">
      {diff.map((d, i) => (
        <div key={i} className={d.op === 'add' ? 'text-pos' : d.op === 'del' ? 'text-neg line-through' : 'text-ink-2'}>{d.op === 'add' ? '+ ' : d.op === 'del' ? '− ' : '  '}{d.line || ' '}</div>
      ))}
    </pre>
  );
}

/** Per-account brand voice: stats (no AI), brief + profile editor, derive/re-derive with diff, per-account AI opt-out. */
export function VoiceEditor({ accountId }: { accountId: string }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const qc = useQueryClient();
  const caps = useStudioCapabilities();
  const key = [STUDIO_KEY, 'voice', accountId];
  const voiceQ = useQuery<Voice | null>({ queryKey: key, queryFn: () => studio.voice.get(accountId) as Promise<Voice | null> });
  const voice = voiceQ.data ?? null;
  const [form, setForm] = useState<Form>(() => toForm('', null));
  const [baseline, setBaseline] = useState<string>('');
  const [adopted, setAdopted] = useState<Derived | null>(null);
  const [proposal, setProposal] = useState<Derived | null>(null);
  const [n, setN] = useState(50);
  const [deriveLang, setDeriveLang] = useState<Lang>(contentLangFor(lang));
  const [useImages, setUseImages] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const req = useStudioRequest<Derived>();

  useStudioChanged(() => { void qc.invalidateQueries({ queryKey: key }); }, 'voice');

  // Hydrate when the account changes or the stored voice is (re)loaded without local edits.
  useEffect(() => {
    if (!voice) return;
    const next = toForm(voice.brief, voice.profile);
    setForm(next);
    setBaseline(JSON.stringify(next));
    setAdopted(null);
  }, [voice?.accountId, voice?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setProposal(null); setMsg(null); }, [accountId]);

  if (voiceQ.isLoading) return <Loading />;
  if (voiceQ.error) return <ErrorState error={voiceQ.error} />;
  if (!voice) return null;

  const dirty = JSON.stringify(form) !== baseline;
  const aiOn = !voice.aiDisabled;
  const setList = (k: ListField, v: string) => setForm((f) => ({ ...f, lists: { ...f.lists, [k]: v } }));

  const save = async () => {
    setMsg(null);
    const profile = toProfile(form, adopted?.proposal.profile ?? voice.profile);
    const source = adopted ? (form.brief === adopted.proposal.brief ? 'ai' : 'ai_edited') : voice.source === 'manual' ? 'manual' : 'ai_edited';
    try {
      await studio.call('voice:save', {
        accountId, brief: form.brief, profile, source,
        ...(adopted ? { derived: { provider: adopted.provider, model: adopted.model, derivedFrom: adopted.derivedFrom } } : {}),
      });
      setMsg({ ok: true, text: t('sv_saved') });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  const setOptOut = async (disabled: boolean) => {
    try {
      await studio.voice.save({ accountId, brief: voice.brief, aiDisabled: disabled });
      await qc.invalidateQueries({ queryKey: [STUDIO_KEY] });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  const derive = async () => {
    setMsg(null);
    try {
      const res = await req.run((requestId) => studio.call<Derived>('voice:derive', { accountId, n, lang: deriveLang, useImages, requestId }));
      setProposal(res);
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  const adopt = () => {
    if (!proposal) return;
    setForm(toForm(proposal.proposal.brief, proposal.proposal.profile));
    setAdopted(proposal);
    setProposal(null);
  };

  const sourceKey = `sv_source_${voice.source}` as const;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4 min-w-0">
        <Section
          title={t('sv_brief')}
          right={<span className="text-xs text-ink-2">{voice.updatedAt ? `${t(sourceKey)} · ${t('sv_saved_at', { d: fmtDateTime(voice.updatedAt) })}` : t('sv_never_saved')}</span>}
        >
          <div className="space-y-3">
            <div className="text-sm text-ink-2">{t('sv_intro')}</div>
            <label className="block">
              <span className="sr-only">{t('sv_brief')}</span>
              <textarea className="input font-[inherit]" rows={10} value={form.brief} maxLength={8000} placeholder={t('sv_brief_placeholder')} onChange={(e) => setForm({ ...form, brief: e.target.value })} />
              <span className="text-xs text-ink-2">{t('sv_brief_hint')}</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm"><span className="text-ink-2">{t('sv_formality')}</span>
                <select className="input mt-1" value={form.formality} onChange={(e) => setForm({ ...form, formality: e.target.value })}>
                  <option value="">—</option>
                  {(['casual', 'neutral', 'formal'] as const).map((v) => <option key={v} value={v}>{t(`sv_formality_${v}`)}</option>)}
                </select>
              </label>
              <label className="block text-sm"><span className="text-ink-2">{t('sv_pronoun')}</span>
                <select className="input mt-1" value={form.pronoun} onChange={(e) => setForm({ ...form, pronoun: e.target.value })}>
                  <option value="">{t('sv_pronoun_none')}</option>
                  <option value="sen">sen</option>
                  <option value="siz">siz</option>
                </select>
              </label>
              {LIST_FIELDS.map((k) => (
                <label key={k} className="block text-sm"><span className="text-ink-2">{t(LABELS[k])}</span><InfoTip text={t('sv_list_hint')} />
                  <textarea className="input mt-1" rows={3} value={form.lists[k]} onChange={(e) => setList(k, e.target.value)} />
                </label>
              ))}
              <label className="block text-sm"><span className="text-ink-2">{t('sv_visual_style')}</span>
                <textarea className="input mt-1" rows={3} value={form.visualStyle} maxLength={600} onChange={(e) => setForm({ ...form, visualStyle: e.target.value })} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" disabled={!dirty} onClick={() => void save()}>{t('save')}</button>
              {dirty && <button type="button" className="btn btn-ghost" onClick={() => { setForm(JSON.parse(baseline) as Form); setAdopted(null); }}>{t('sv_revert')}</button>}
              {dirty && <span className="text-xs text-warn">{t('sv_unsaved')}</span>}
              {msg && <span className={`text-sm ${msg.ok ? 'text-pos' : 'text-neg'}`}>{msg.text}</span>}
            </div>
          </div>
        </Section>

        {proposal && (
          <Section title={t('sv_proposal')} right={<CostBadge result={proposal} />}>
            <div className="space-y-3">
              <div className="text-sm text-ink-2">{t('sv_proposal_hint')}</div>
              {proposal.visionDropped && <div className="text-xs text-warn">{t('sv_vision_dropped')}</div>}
              <div className="text-xs text-ink-2">{t('sv_diff')}</div>
              <DiffView before={form.brief} after={proposal.proposal.brief} />
              <div className="text-sm space-y-1">
                {LIST_FIELDS.map((k) => ((proposal.proposal.profile[k] as string[] | undefined)?.length ? <div key={k}><span className="text-ink-2">{t(LABELS[k])}: </span>{(proposal.proposal.profile[k] as string[]).join(' · ')}</div> : null))}
                {typeof proposal.proposal.profile.visualStyle === 'string' && <div><span className="text-ink-2">{t('sv_visual_style')}: </span>{proposal.proposal.profile.visualStyle}</div>}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary btn-sm" onClick={adopt}>{t('sv_use_proposal')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProposal(null)}>{t('sv_discard')}</button>
              </div>
            </div>
          </Section>
        )}
      </div>

      <div className="space-y-4">
        <Section title={voice.derivedAt || voice.source !== 'manual' ? t('sv_rederive') : t('sv_derive')}>
          <div className="space-y-2 text-sm">
            <div>
              <Toggle checked={voice.aiDisabled} onChange={(v) => void setOptOut(v)} label={t('sv_ai_optout')} />
              <div className="text-xs text-ink-2 mt-1">{t('sv_ai_optout_hint')}</div>
            </div>
            {aiOn ? (
              <>
                <label className="flex items-center justify-between gap-2"><span className="text-ink-2">{t('sv_derive_n')}</span>
                  <select className="input w-auto py-0.5" value={n} disabled={req.busy} onChange={(e) => setN(Number(e.target.value))}>{[20, 50, 100].map((x) => <option key={x} value={x}>{x}</option>)}</select>
                </label>
                <label className="flex items-center justify-between gap-2"><span className="text-ink-2">{t('sv_derive_lang')}</span>
                  <select className="input w-auto py-0.5" value={deriveLang} disabled={req.busy} onChange={(e) => setDeriveLang(e.target.value as Lang)}>
                    <option value="tr">{t('sv_lang_tr')}</option><option value="en">{t('sv_lang_en')}</option>
                  </select>
                </label>
                {caps.data?.vision !== false && (
                  <label className="flex items-center gap-2"><input type="checkbox" checked={useImages} disabled={req.busy} onChange={(e) => setUseImages(e.target.checked)} />{t('sv_derive_images')}</label>
                )}
                <SendPreview feature="voice" params={{ accountId, n, lang: deriveLang, useImages }} />
                <div className="flex items-center gap-2">
                  <button type="button" className="btn btn-primary btn-sm" disabled={req.busy || !voice.stats?.posts} onClick={() => void derive()}>
                    {req.busy ? t('sv_deriving') : voice.derivedAt || voice.source !== 'manual' ? t('sv_rederive') : t('sv_derive')}
                  </button>
                  {req.busy && <button type="button" className="btn btn-ghost btn-sm" onClick={req.cancel}>{t('studio_cancel')}</button>}
                </div>
              </>
            ) : <div className="text-xs text-warn">{t('sv_ai_disabled_note')}</div>}
          </div>
        </Section>
        <VoiceStats stats={voice.stats} />
      </div>
    </div>
  );
}
