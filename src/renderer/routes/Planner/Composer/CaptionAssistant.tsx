import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { fmtNum } from '@/lib/format';
import { PlatformIcon } from '@/components/PlatformBadge';
import { useAccounts } from '@/hooks/queries';
import { STUDIO_KEY, studio, useStudioCapabilities, useStudioRequest, useStudioSettings } from '@/hooks/useStudio';
import type { CaptionGenerateResult, CaptionVariant, Platform, PublishPlatform } from '@/lib/types';
import { IssueList } from '../parts';
import { errorText } from '../lib';
import { platformsOf, type ComposerState } from './state';
import { SendPreview } from './SendPreview';
import { CostBadge } from './CostBadge';

type Lang = 'tr' | 'en';
const LANGS: Lang[] = ['tr', 'en'];
type Variant = CaptionVariant & { threadsText?: string; shortened?: boolean };
type Result = Omit<CaptionGenerateResult, 'variants'> & { variants: Variant[]; visionDropped?: boolean; visionUnavailable?: boolean; skippedImages?: number };

function VariantCard({ v, disabled, onUse, onUseThreads }: { v: Variant; disabled: boolean; onUse: () => void; onUseThreads?: () => void }) {
  const t = useT();
  return (
    <li className="rounded border border-line p-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="badge badge-muted">{v.label}</span>
        <span className="text-ink-2">{t('sv_angle', { a: v.angle })}</span>
        {v.shortened && <span className="badge badge-warn">{t('sv_shortened')}</span>}
        <span className="ml-auto inline-flex gap-2 text-ink-2 num">
          {Object.entries(v.charCounts).map(([p, n]) => <span key={p} className="inline-flex items-center gap-0.5"><PlatformIcon platform={p as Platform} size={10} />{fmtNum(n ?? 0)}</span>)}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap">{v.text}</p>
      {v.threadsText && (
        <div className="text-sm border-l-2 border-line pl-2">
          <div className="text-xs text-ink-2">{t('sv_threads_text')}</div>
          <p className="whitespace-pre-wrap">{v.threadsText}</p>
        </div>
      )}
      <IssueList issues={v.issues} />
      <div className="flex gap-1.5">
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={onUse}>{t('sv_use')}</button>
        {onUseThreads && <button type="button" className="btn btn-sm btn-ghost" disabled={disabled} onClick={onUseThreads}>{t('sv_use_threads')}</button>}
      </div>
    </li>
  );
}

/**
 * Caption variants for the composer (v1.5 chunk B): brand voice + notes (+ images when the model can see them) →
 * 2–6 variants with per-platform counts and validation issues. "Use" copies a variant into the shared caption
 * (Threads text into the Threads targets' override). Nothing is sent until Generate is pressed.
 */
export function CaptionAssistant({ state, disabled, onChange, postId }: {
  state: ComposerState; disabled: boolean; onChange: (patch: Partial<ComposerState>) => void; postId?: number | null;
}) {
  const t = useT();
  const caps = useStudioCapabilities();
  const settings = useStudioSettings();
  const req = useStudioRequest<Result>();
  const [notes, setNotes] = useState('');
  const [langsPicked, setLangs] = useState<Lang[] | null>(null);
  const [variants, setVariants] = useState(3);
  const [useImages, setUseImages] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState<string | null>(null);

  const accountIds = useMemo(() => state.targets.map((tg) => tg.accountId), [state.targets]);
  // v2.0: only publishable platforms (planner targets are always IG/FB/Threads).
  const platforms = platformsOf(state).filter((p): p is PublishPlatform => p === 'instagram' || p === 'facebook' || p === 'threads');
  const langs = langsPicked ?? (settings.data?.captionLangs?.length ? settings.data.captionLangs : ['tr']);
  const images = useMemo(() => state.media.filter((m) => m.asset.kind === 'image' || m.asset.thumbPath), [state.media]);
  const accounts = useAccounts({ onlyTracked: true });
  const vision = caps.data?.vision;
  const sendImages = useImages && images.length > 0 && vision !== false;
  const voice = useQuery({ queryKey: [STUDIO_KEY, 'voice', accountIds[0]], queryFn: () => studio.voice.get(accountIds[0]!), enabled: !!accountIds[0] });

  const params = useMemo(() => ({
    accountIds, platforms, langs, variants, postId: postId ?? undefined, notes,
    assetIds: sendImages ? images.map((m) => m.asset.id) : [],
    altTexts: Object.fromEntries(state.media.filter((m) => m.altText.trim()).map((m) => [m.asset.id, m.altText.trim()])),
  }), [accountIds, platforms, langs, variants, postId, notes, sendImages, images, state.media]);

  const toggleLang = (l: Lang) => setLangs(langs.includes(l) ? langs.filter((x) => x !== l) : LANGS.filter((x) => x === l || langs.includes(x)));

  const generate = async () => {
    setError(null);
    setUsed(null);
    try {
      const res = await req.run((requestId) => studio.captions.generate({ ...params, requestId }) as Promise<Result>);
      setResult(res);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const use = (v: Variant, threads = false) => {
    if (threads) {
      onChange({ targets: state.targets.map((tg) => (tg.platform === 'threads' ? { ...tg, captionOverride: v.threadsText ?? v.text } : tg)) });
    } else {
      if (state.caption.trim() && state.caption !== v.text && !window.confirm(t('sv_replace_confirm'))) return;
      onChange({ caption: v.text });
    }
    setUsed(v.label);
    if (postId != null) void studio.call('captions:save', { postId, chosenLabel: v.label }).catch(() => {});
  };

  if (!accountIds.length) return <div className="text-xs text-ink-2">{t('sv_assist_need_account')}</div>;
  const voiceName = voice.data?.brief?.trim() ? accounts.data?.find((a) => a.igId === accountIds[0])?.username ?? null : null;

  return (
    <div className="space-y-2">
      <div className="text-xs text-ink-2">{voiceName ? t('sv_voice_used', { u: voiceName }) : t('sv_voice_missing')}</div>
      <label className="block text-sm">
        <span className="text-ink-2">{t('sv_notes')}</span>
        <textarea className="input mt-1" rows={2} value={notes} maxLength={2000} disabled={disabled || req.busy} placeholder={t('sv_notes_placeholder')} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-ink-2">{t('sv_langs')}</span>
          {LANGS.map((l) => (
            <button key={l} type="button" className={`chip ${langs.includes(l) ? 'active' : ''}`} aria-pressed={langs.includes(l)} disabled={req.busy || (langs.length === 1 && langs[0] === l)} onClick={() => toggleLang(l)}>{t(`sv_lang_${l}`)}</button>
          ))}
        </span>
        <label className="inline-flex items-center gap-1.5">
          <span className="text-ink-2">{t('sv_variants_n')}</span>
          <select className="input w-auto py-0.5" value={variants} disabled={req.busy} onChange={(e) => setVariants(Number(e.target.value))}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {images.length > 0 && vision !== false && (
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={useImages} disabled={req.busy} onChange={(e) => setUseImages(e.target.checked)} />{t('sv_use_images')}</label>
        )}
      </div>
      {images.length > 0 && vision === false && <div className="text-xs text-warn">{t('sv_no_vision')}</div>}
      {sendImages && vision === 'unknown' && <div className="text-xs text-ink-2">{t('sv_vision_unknown')}</div>}
      <SendPreview feature="caption" params={params} disabled={disabled} />
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={disabled || req.busy} onClick={() => void generate()}>{req.busy ? t('sv_generating') : t('sv_generate')}</button>
        {req.busy && <button type="button" className="btn btn-sm btn-ghost" onClick={req.cancel}>{t('studio_cancel')}</button>}
        <CostBadge result={result} />
      </div>
      {error && <div className="text-sm text-neg">{error}</div>}
      {result && (
        <>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {result.visionUsed && <span className="badge badge-pos">{t('sv_vision_used')}</span>}
            {result.visionDropped && <span className="badge badge-warn">{t('sv_vision_dropped')}</span>}
            {!!result.skippedImages && <span className="badge badge-warn">{t('sv_images_skipped', { n: result.skippedImages })}</span>}
            {used && <span className="badge badge-pos">{t('sv_variant_used')} · {used}</span>}
          </div>
          <ul className="space-y-2">
            {result.variants.map((v) => (
              <VariantCard key={v.label} v={v} disabled={disabled} onUse={() => use(v)} onUseThreads={v.threadsText ? () => use(v, true) : undefined} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
