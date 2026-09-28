import { thumbGradient } from '@/lib/format';

const ICONS: Record<string, string> = { REELS: '▶', CAROUSEL_ALBUM: '❐', VIDEO: '▶', IMAGE: '' };

export function PostThumb({ mediaId, thumbnailPath, mediaType, mediaProductType, size = 40, rounded = 4 }: { mediaId: string; thumbnailPath?: string | null; mediaType: string; mediaProductType: string; size?: number | string; rounded?: number }) {
  const icon = mediaProductType === 'REELS' ? ICONS.REELS : ICONS[mediaType] ?? '';
  const style = { width: size, height: size, borderRadius: rounded, background: thumbnailPath ? undefined : thumbGradient(mediaId) } as const;
  return (
    <div className="relative flex-none overflow-hidden" style={style}>
      {thumbnailPath && <img src={thumbnailPath} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
      {icon && <span className="absolute right-1 top-0.5 text-white/90 text-[10px] drop-shadow">{icon}</span>}
    </div>
  );
}
