import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { Avatar } from '@/components/ui';
import { PlatformIcon } from '@/components/PlatformBadge';
import { mediaUrl, type Account } from '@/lib/types';
import { inferFormat, tx } from '../lib';
import type { ComposerState } from './state';

const PREVIEW_CHARS = 220;

/** Approximate IG feed/reel/story, Facebook and Threads previews for one target at a time (not pixel-exact). */
export function PreviewPane({ state, accounts }: { state: ComposerState; accounts: Map<string, Account> }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const [sel, setSel] = useState<string | null>(null);
  const target = state.targets.find((tg) => tg.accountId === sel) ?? state.targets[0];
  if (!target) return <div className="text-xs text-ink-2">{t('pl_preview_pick')}</div>;
  const acc = accounts.get(target.accountId);
  const format = target.format ?? inferFormat(target.platform, state.media.map((m) => m.asset));
  const caption = target.captionOverride ?? state.caption;
  const first = state.media[0]?.asset;
  const story = format === 'story';
  const tall = story || format === 'reel';
  const captionBlock = caption && !story ? (
    <div className="text-[13px] whitespace-pre-wrap break-words px-3 py-2">
      {target.platform === 'instagram' && <span className="font-semibold mr-1">{acc?.username}</span>}
      {caption.length > PREVIEW_CHARS ? `${caption.slice(0, PREVIEW_CHARS)}… ${t('pl_more')}` : caption}
    </div>
  ) : null;
  const mediaBlock = first ? (
    <div className="relative bg-black" style={{ aspectRatio: tall ? '9 / 16' : first.width && first.height ? `${first.width} / ${first.height}` : '4 / 5', maxHeight: 420 }}>
      {first.kind === 'video'
        ? <video src={mediaUrl(first.id)} poster={mediaUrl(first.id, 'thumb')} muted className="w-full h-full object-cover" aria-label={t('pl_preview_media')} />
        : <img src={mediaUrl(first.id)} alt={state.media[0].altText} className="w-full h-full object-cover" />}
      {state.media.length > 1 && <span className="absolute top-2 right-2 text-[11px] px-1.5 rounded bg-black/60 text-white num">1/{state.media.length}</span>}
    </div>
  ) : null;

  return (
    <div className="space-y-2">
      {state.targets.length > 1 && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('pl_preview')}>
          {state.targets.map((tg) => (
            <button type="button" role="tab" key={tg.accountId} aria-selected={tg.accountId === target.accountId} className={`chip ${tg.accountId === target.accountId ? 'active' : ''}`} onClick={() => setSel(tg.accountId)}>
              <PlatformIcon platform={tg.platform} size={11} />@{accounts.get(tg.accountId)?.username ?? tg.accountId}
            </button>
          ))}
        </div>
      )}
      <div className="mx-auto max-w-[280px] rounded-lg border border-line bg-surface-0 overflow-hidden" aria-label={t('pl_preview')}>
        <div className="flex items-center gap-2 px-3 py-2">
          <Avatar username={acc?.username ?? '?'} url={acc?.profilePicUrl} color={acc?.color} size={26} platform={target.platform} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold truncate">{target.platform === 'facebook' ? acc?.name ?? acc?.username : acc?.username}</div>
            <div className="text-[11px] text-ink-2">{format ? tx(`fmt_${format}`, lang, undefined, format) : '—'}</div>
          </div>
        </div>
        {target.platform === 'instagram' ? <>{mediaBlock}{captionBlock}</> : <>{captionBlock}{mediaBlock}</>}
        {target.platform === 'facebook' && format === 'link' && target.options.link && (
          <div className="mx-3 mb-2 border border-line rounded px-2 py-1 text-[12px] text-ink-2 truncate">{target.options.link}</div>
        )}
        {!first && !caption && <div className="px-3 py-6 text-center text-xs text-ink-2">{t('pl_preview_empty')}</div>}
      </div>
    </div>
  );
}
