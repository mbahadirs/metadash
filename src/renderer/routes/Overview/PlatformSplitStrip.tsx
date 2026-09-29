import { useT } from '@/lib/i18n';
import { fmtCompact, fmtNum } from '@/lib/format';
import { PLATFORM_LABELS, platformOf, type PlatformSplit } from '@/lib/platforms';
import { usePlatformCaps } from '@/hooks/usePlatforms';
import type { Platform, PortfolioRow } from '@/lib/types';
import { PlatformIcon } from '@/components/PlatformBadge';

interface Cell { accounts: number | null; followers: number | null; reach: number | null; posts: number | null }

/**
 * Per-platform breakdown under the Overview KPIs. Uses the backend split when portfolio returns one, otherwise
 * sums the league rows per platform (same numbers the table shows).
 */
export function PlatformSplitStrip({ split, rows, platforms }: { split: PlatformSplit | null; rows: PortfolioRow[]; platforms: Platform[] }) {
  const t = useT();
  const pc = usePlatformCaps();
  const cells = platforms.map((p) => [p, cellFor(p, split, rows)] as const).filter(([, c]) => (c.accounts ?? 1) > 0);
  if (cells.length < 2) return null;
  return (
    <div className="panel px-4 py-2.5 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm" aria-label={t('platform_split')}>
      <span className="text-ink-2 text-xs">{t('platform_split')}</span>
      {cells.map(([p, c]) => (
        <div key={p} className="flex items-center gap-2 num">
          <PlatformIcon platform={p} size={16} />
          <span className="font-medium">{PLATFORM_LABELS[p]}</span>
          {c.accounts != null && <span className="text-ink-2">{fmtNum(c.accounts)} {t('accounts').toLowerCase()}</span>}
          <span>{fmtCompact(c.followers)} <span className="text-ink-2">{t('followers').toLowerCase()}</span></span>
          <span>{fmtCompact(c.reach)} <span className="text-ink-2">{(pc.primary(p) === 'views' ? t('views') : p === 'facebook' ? t('viewers') : t('reach')).toLowerCase()}</span></span>
          {c.posts != null && <span>{fmtNum(c.posts)} <span className="text-ink-2">{t('posts').toLowerCase()}</span></span>}
        </div>
      ))}
      <span className="text-xs text-ink-2 basis-full">{t('follower_overlap_note')}</span>
    </div>
  );
}

function cellFor(p: Platform, split: PlatformSplit | null, rows: PortfolioRow[]): Cell {
  const s = split?.[p];
  if (s) return { accounts: (s.accounts as number | null) ?? null, followers: (s.followers as number | null) ?? null, reach: ((s.reach ?? s.views) as number | null) ?? null, posts: (s.posts as number | null) ?? null };
  const own = rows.filter((r) => platformOf(r) === p);
  const sum = (f: (r: PortfolioRow) => number | null) => own.reduce((acc, r) => acc + (f(r) ?? 0), 0);
  return { accounts: own.length, followers: sum((r) => r.followers), reach: sum((r) => r.reach), posts: sum((r) => r.posts) };
}
