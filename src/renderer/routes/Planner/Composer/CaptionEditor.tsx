import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { fmtNum } from '@/lib/format';
import { PlatformIcon } from '@/components/PlatformBadge';
import { PLATFORM_LABELS } from '@/lib/platforms';
import type { Account, Platform } from '@/lib/types';
import { TEXT_LIMITS, countGraphemes, countHashtags, countLinks, countMentions } from '../lib';
import type { ComposerState, ComposerTarget } from './state';

const NEAR_RATIO = 0.98;

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const cls = value > max ? 'text-neg' : value >= max * NEAR_RATIO ? 'text-warn' : 'text-ink-2';
  return <span className={`num ${cls}`}>{label} {fmtNum(value)}/{fmtNum(max)}</span>;
}

/** Live per-platform counters (graphemes, hashtags, mentions, links); mirrors main validation limits. */
export function CaptionCounters({ text, platform }: { text: string; platform: Platform }) {
  const t = useT();
  const L = TEXT_LIMITS[platform];
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" aria-live="polite">
      <span className="inline-flex items-center gap-1"><PlatformIcon platform={platform} size={11} /><Meter label={t('pl_chars')} value={countGraphemes(text)} max={L.captionMax} /></span>
      {L.hashtagsMax != null && <Meter label="#" value={countHashtags(text)} max={L.hashtagsMax} />}
      {L.mentionsMax != null && <Meter label="@" value={countMentions(text)} max={L.mentionsMax} />}
      {L.topicTagsMax != null && <Meter label={t('pl_topic_tags')} value={countHashtags(text)} max={L.topicTagsMax} />}
      {L.linksMax != null && <Meter label={t('pl_links')} value={countLinks(text)} max={L.linksMax} />}
    </span>
  );
}

/**
 * Shared caption + first comment, with per-account override tabs. Targets without an override use the shared text,
 * so the shared tab shows one counter row per platform in use.
 */
export function CaptionEditor({ state, accounts, disabled, onChange }: {
  state: ComposerState; accounts: Map<string, Account>; disabled: boolean; onChange: (patch: Partial<ComposerState>) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<string>('shared');
  const target = state.targets.find((tg) => tg.accountId === tab) ?? null;
  const activeTab = target ? tab : 'shared';
  const platformsOnShared = [...new Set(state.targets.filter((tg) => tg.captionOverride == null).map((tg) => tg.platform))];
  const patchTarget = (accountId: string, p: Partial<ComposerTarget>) => onChange({ targets: state.targets.map((tg) => (tg.accountId === accountId ? { ...tg, ...p } : tg)) });

  return (
    <div className="space-y-2">
      {state.targets.length > 0 && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('pl_caption_per_account')}>
          <button type="button" role="tab" aria-selected={activeTab === 'shared'} className={`chip ${activeTab === 'shared' ? 'active' : ''}`} onClick={() => setTab('shared')}>{t('pl_shared_caption')}</button>
          {state.targets.map((tg) => (
            <button type="button" role="tab" key={tg.accountId} aria-selected={activeTab === tg.accountId} className={`chip ${activeTab === tg.accountId ? 'active' : ''}`} onClick={() => setTab(tg.accountId)}>
              <PlatformIcon platform={tg.platform} size={11} />@{accounts.get(tg.accountId)?.username ?? tg.accountId}{tg.captionOverride != null || tg.firstCommentOverride != null ? ' *' : ''}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'shared' || !target ? (
        <>
          <label className="block">
            <span className="sr-only">{t('pl_caption')}</span>
            <textarea className="input font-[inherit]" rows={7} value={state.caption} disabled={disabled} placeholder={t('pl_caption_placeholder')} aria-label={t('pl_caption')}
              onChange={(e) => onChange({ caption: e.target.value })} />
          </label>
          <div className="flex flex-col gap-0.5">
            {(platformsOnShared.length ? platformsOnShared : (['instagram'] as Platform[])).map((p) => <CaptionCounters key={p} text={state.caption} platform={p} />)}
          </div>
          <label className="block text-sm">
            <span className="text-ink-2">{t('pl_first_comment')}</span>
            <textarea className="input mt-1" rows={2} value={state.firstComment} disabled={disabled} placeholder={t('pl_first_comment_placeholder')}
              onChange={(e) => onChange({ firstComment: e.target.value })} />
          </label>
        </>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={target.captionOverride != null} disabled={disabled}
              onChange={(e) => patchTarget(target.accountId, { captionOverride: e.target.checked ? state.caption : null })} />
            {t('pl_custom_caption_for', { platform: PLATFORM_LABELS[target.platform] })}
          </label>
          <textarea className="input" rows={7} disabled={disabled || target.captionOverride == null} aria-label={t('pl_caption')}
            value={target.captionOverride ?? state.caption} onChange={(e) => patchTarget(target.accountId, { captionOverride: e.target.value })} />
          <CaptionCounters text={target.captionOverride ?? state.caption} platform={target.platform} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={target.firstCommentOverride != null} disabled={disabled}
              onChange={(e) => patchTarget(target.accountId, { firstCommentOverride: e.target.checked ? state.firstComment : null })} />
            {t('pl_custom_first_comment')}
          </label>
          <textarea className="input" rows={2} disabled={disabled || target.firstCommentOverride == null} aria-label={t('pl_first_comment')}
            value={target.firstCommentOverride ?? state.firstComment} onChange={(e) => patchTarget(target.accountId, { firstCommentOverride: e.target.value })} />
        </div>
      )}
    </div>
  );
}
