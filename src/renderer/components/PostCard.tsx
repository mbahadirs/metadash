import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { fmtCompact, fmtPct, fmtDate, mediaTypeLabel } from '@/lib/format';
import type { Media } from '@/lib/types';
import { PostThumb } from './PostThumb';

/** Grid card: fixed 4:5 preview + dense metric footer. */
export function PostCard({ m, onOpen, showAccount }: { m: Media; onOpen: (id: string) => void; showAccount?: boolean }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  return (
    <button className="panel text-left overflow-hidden hover:border-accent focus-visible:border-accent w-full" onClick={() => onOpen(m.mediaId)}>
      <div className="aspect-[4/5] w-full relative">
        <PostThumb mediaId={m.mediaId} thumbnailPath={m.thumbnailPath} mediaType={m.mediaType} mediaProductType={m.mediaProductType} size="100%" rounded={0} />
        {(m.spend ?? 0) > 0 && <span className="absolute left-1.5 top-1.5 badge badge-warn">{t('ad_spend')}</span>}
      </div>
      <div className="p-2.5 text-xs">
        <div className="flex justify-between text-ink-2"><span>{showAccount ? `@${m.username}` : fmtDate(m.postedAt)}</span><span>{mediaTypeLabel(m, lang)}</span></div>
        <div className="truncate mt-1 text-ink-1">{m.caption || '—'}</div>
        <div className="flex justify-between mt-1.5 num"><span>{fmtCompact(m.reach)} <span className="text-ink-2">{t('reach').toLowerCase()}</span></span><span>{fmtCompact(m.saved)} <span className="text-ink-2">{t('saved').toLowerCase()}</span></span><span>ER {fmtPct(m.engagementRate, 2)}</span></div>
      </div>
    </button>
  );
}
