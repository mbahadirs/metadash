import { PLATFORM_LABELS } from '@/lib/platforms';
import type { Platform } from '@/lib/types';

/** Brand colours; Threads uses the ink colour so it reads in both themes. */
const STYLE: Record<Platform, { bg: string; fg: string; glyph: string }> = {
  instagram: { bg: 'linear-gradient(135deg, #F58529, #DD2A7B 55%, #8134AF)', fg: '#fff', glyph: 'IG' },
  facebook: { bg: '#1877F2', fg: '#fff', glyph: 'f' },
  threads: { bg: 'var(--ink-1)', fg: 'var(--surface-1)', glyph: '@' },
};

/** Round platform mark (used as Avatar corner badge and in dense lists). */
export function PlatformIcon({ platform, size = 14, title }: { platform: Platform; size?: number; title?: string }) {
  const s = STYLE[platform] ?? STYLE.instagram;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold flex-none leading-none"
      style={{ width: size, height: size, background: s.bg, color: s.fg, fontSize: Math.max(7, size * (s.glyph.length > 1 ? 0.42 : 0.62)) }}
      title={title ?? PLATFORM_LABELS[platform]} aria-label={title ?? PLATFORM_LABELS[platform]} role="img"
    >{s.glyph}</span>
  );
}

/** Labelled pill: icon + platform name. */
export function PlatformBadge({ platform, label = true }: { platform: Platform; label?: boolean }) {
  return (
    <span className="badge badge-muted inline-flex items-center gap-1">
      <PlatformIcon platform={platform} size={12} />{label && PLATFORM_LABELS[platform]}
    </span>
  );
}
