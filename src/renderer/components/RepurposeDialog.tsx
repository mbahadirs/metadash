import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT, type Key } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { useAccounts } from '@/hooks/queries';
import { useAiEnabled } from '@/hooks/useAi';
import { studio, useStudioCapabilities, useStudioRequest } from '@/hooks/useStudio';
import { countGraphemes, errorText } from '@/routes/Planner/lib';
import { CostLine } from '@/routes/Studio/parts';
import { SendPanel } from '@/routes/Studio/Ideas/SendPanel';
import type { Account, Platform, RepurposeInput, RepurposeTarget, StudioCost } from '@/lib/types';
import { Modal, Spinner } from './ui';

/**
 * Repurpose a post with AI (v1.5 chunk C): reel/post → carousel text, Threads version, Facebook version or story frames.
 * The result is editable and becomes a Planner draft (lineage kept in main). Mounted as one button in PostDrawer
 * (synced media) and in the Planner composer's WorkflowBar (planner posts). Hidden while AI is off.
 */
type Source = RepurposeInput['source'];
interface Slide { title: string; body: string }
interface RpDraft { to: RepurposeTarget; lang: 'tr' | 'en'; title: string; caption: string; slides?: Slide[]; posts?: string[]; text?: string; frames?: { text: string }[]; truncated?: boolean; shortened?: boolean }
type Result = StudioCost & { draft: RpDraft };

const TARGETS: RepurposeTarget[] = ['carousel', 'threads', 'facebook', 'story'];
/** Platforms that can carry each draft (mirrors DRAFT_TARGETS in main/ai/studio/repurpose.js). */
const PLATFORMS_FOR: Record<RepurposeTarget, Platform[]> = { carousel: ['instagram', 'facebook'], story: ['instagram'], threads: ['threads'], facebook: ['facebook'] };
const THREADS_MAX = 500;

export function RepurposeButton({ source, sourceAccountIds = [], isVideo = false, onCreated, className = 'btn btn-sm' }: {
  source: Source; sourceAccountIds?: string[]; isVideo?: boolean; onCreated?: (postId: number) => void; className?: string;
}) {
  const t = useT();
  const enabled = useAiEnabled();
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  return (
    <>
      <button type="button" className={className} title={t('rp_button_tip')} onClick={() => setOpen(true)}>{t('rp_button')}</button>
      {open && <RepurposeDialog source={source} sourceAccountIds={sourceAccountIds} isVideo={isVideo} onClose={() => setOpen(false)} onCreated={onCreated} />}
    </>
  );
}

export function RepurposeDialog({ source, sourceAccountIds, isVideo, onClose, onCreated }: {
  source: Source; sourceAccountIds: string[]; isVideo: boolean; onClose: () => void; onCreated?: (postId: number) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const uiLang = useAppStore((s) => s.lang);
  const caps = useStudioCapabilities();
  const accountsQ = useAccounts({ onlyTracked: true });
  const [to, setTo] = useState<RepurposeTarget>(isVideo ? 'carousel' : 'threads');
  const [lang, setLang] = useState<'tr' | 'en'>(uiLang);
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [draft, setDraft] = useState<RpDraft | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const req = useStudioRequest<Result>();

  const eligible = useMemo(() => (accountsQ.data ?? []).filter((a) => PLATFORMS_FOR[to].includes(a.platform)), [accountsQ.data, to]);
  const defaults = useMemo(() => defaultAccounts(eligible, accountsQ.data ?? [], sourceAccountIds), [eligible, accountsQ.data, sourceAccountIds]);
  const chosen = (picked ?? defaults).filter((id) => eligible.some((a) => a.igId === id));
  const params = useMemo(() => ({ source, to, lang, ...(transcript.trim() ? { transcript: transcript.trim() } : {}) }), [source, to, lang, transcript]);

  const pickTarget = (next: RepurposeTarget) => { setTo(next); setResult(null); setDraft(null); setPicked(null); setError(null); };
  const generate = async () => {
    setError(null);
    try {
      const res = await req.run((requestId) => studio.call<Result>('repurpose', { ...params, requestId }));
      setResult(res);
      setDraft(res.draft);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const createDraft = async () => {
    if (!draft || !chosen.length) return;
    setSaving(true);
    setError(null);
    try {
      const { postId } = await studio.repurpose.toDraft({ source, to, draft: draft as unknown as Record<string, unknown>, accountIds: chosen });
      onClose();
      if (onCreated) onCreated(postId);
      else navigate(`/planner?post=${postId}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const toggleAccount = (id: string) => setPicked(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  return (
    <Modal open onClose={onClose} title={t('rp_title')} width={680}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('rp_to')}>
          {TARGETS.map((x) => <button key={x} type="button" className={`chip ${to === x ? 'active' : ''}`} aria-pressed={to === x} onClick={() => pickTarget(x)}>{t(`rp_to_${x}` as Key)}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">{t('rp_lang')}
            <select className="input" value={lang} onChange={(e) => setLang(e.target.value as 'tr' | 'en')}>
              <option value="tr">{t('ideas_lang_tr')}</option>
              <option value="en">{t('ideas_lang_en')}</option>
            </select>
          </label>
        </div>
        {isVideo && (
          <label className="block">
            <span className="text-xs text-ink-2">{t('rp_transcript')}</span>
            <textarea className="input w-full min-h-[70px]" value={transcript} maxLength={8000} placeholder={t('rp_transcript_ph')} onChange={(e) => setTranscript(e.target.value)} />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={req.busy} onClick={generate}>{req.busy ? t('rp_generating') : t('rp_generate')}</button>
          {req.busy && <><Spinner size={14} /><button type="button" className="btn btn-sm" onClick={req.cancel}>{t('studio_cancel')}</button></>}
          {result && !req.busy && <CostLine usage={result.usage} costUsd={result.costUsd} caps={caps.data} />}
        </div>
        <SendPanel feature="repurpose" params={params} />

        {draft && (
          <div className="space-y-3 border-t border-line pt-3">
            <div className="text-xs text-ink-2">{t('rp_result')}</div>
            {draft.shortened && <div className="text-xs text-warn">{t('rp_shortened')}</div>}
            <input className="input w-full" value={draft.title} maxLength={200} aria-label={t('rp_draft_title')} placeholder={t('rp_draft_title')} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <DraftEditor draft={draft} onChange={setDraft} />
            <div>
              <div className="text-xs text-ink-2 mb-1">{t('rp_accounts')}</div>
              {eligible.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {eligible.map((a) => <button key={a.igId} type="button" className={`chip ${chosen.includes(a.igId) ? 'active' : ''}`} aria-pressed={chosen.includes(a.igId)} onClick={() => toggleAccount(a.igId)}>{a.platform === 'instagram' ? '' : `${a.platform === 'facebook' ? 'FB' : 'Threads'} · `}@{a.username}</button>)}
                </div>
              ) : <div className="text-xs text-ink-2">{t('rp_no_accounts')}</div>}
            </div>
            <div className="flex justify-end">
              <button type="button" className="btn btn-primary" disabled={!chosen.length || saving} onClick={createDraft}>{t('rp_create_draft')}</button>
            </div>
          </div>
        )}
        {error && <div className="text-neg text-sm" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

/** Same client as the source account first; otherwise the source account itself, otherwise the first eligible one. */
function defaultAccounts(eligible: Account[], all: Account[], sourceIds: string[]): string[] {
  const src = all.filter((a) => sourceIds.includes(a.igId));
  const direct = eligible.filter((a) => sourceIds.includes(a.igId));
  if (direct.length) return [direct[0].igId];
  const client = src.find((a) => a.clientName)?.clientName;
  const sameClient = client ? eligible.filter((a) => a.clientName === client) : [];
  if (sameClient.length) return [sameClient[0].igId];
  const linked = eligible.find((a) => src.some((s) => s.linkedAccountId === a.igId || a.linkedAccountId === s.igId));
  return linked ? [linked.igId] : eligible[0] ? [eligible[0].igId] : [];
}

function DraftEditor({ draft, onChange }: { draft: RpDraft; onChange: (d: RpDraft) => void }) {
  const t = useT();
  if (draft.to === 'carousel') {
    const slides = draft.slides ?? [];
    const setSlide = (i: number, patch: Partial<Slide>) => onChange({ ...draft, slides: slides.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
    return (
      <div className="space-y-2">
        {slides.map((s, i) => (
          <div key={i} className="grid gap-1 md:grid-cols-[110px_1fr]">
            <span className="text-xs text-ink-2 pt-2">{t('rp_slide', { n: i + 1 })}</span>
            <div className="space-y-1">
              <input className="input w-full" value={s.title} maxLength={120} aria-label={t('rp_slide_title')} onChange={(e) => setSlide(i, { title: e.target.value })} />
              <textarea className="input w-full min-h-[48px]" value={s.body} maxLength={600} aria-label={t('rp_slide_body')} onChange={(e) => setSlide(i, { body: e.target.value })} />
            </div>
          </div>
        ))}
        <Caption label={t('rp_caption')} value={draft.caption} onChange={(caption) => onChange({ ...draft, caption })} />
      </div>
    );
  }
  if (draft.to === 'threads') {
    const posts = draft.posts ?? [];
    return (
      <div className="space-y-2">
        {posts.map((p, i) => (
          <Caption key={i} label={t('rp_post', { n: i + 1 })} value={p} max={THREADS_MAX}
            onChange={(v) => { const next = posts.map((x, j) => (j === i ? v : x)); onChange({ ...draft, posts: next, caption: next[0] ?? '' }); }} />
        ))}
        {posts.length > 1 && <div className="text-xs text-ink-2">{t('rp_chain_note')}</div>}
      </div>
    );
  }
  if (draft.to === 'facebook') return <Caption label={t('rp_caption')} value={draft.text ?? ''} onChange={(text) => onChange({ ...draft, text, caption: text })} />;
  const frames = draft.frames ?? [];
  return (
    <div className="space-y-2">
      {frames.map((f, i) => <Caption key={i} label={t('rp_frame', { n: i + 1 })} value={f.text} rows={2} onChange={(text) => onChange({ ...draft, frames: frames.map((x, j) => (j === i ? { text } : x)) })} />)}
    </div>
  );
}

function Caption({ label, value, onChange, max, rows = 4 }: { label: string; value: string; onChange: (v: string) => void; max?: number; rows?: number }) {
  const t = useT();
  const n = countGraphemes(value);
  return (
    <label className="block">
      <span className="flex justify-between text-xs text-ink-2"><span>{label}</span>{max && <span className={`num ${n > max ? 'text-neg' : ''}`}>{t('rp_chars', { n, max })}</span>}</span>
      <textarea className="input w-full" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
