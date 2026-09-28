import { useState } from 'react';
import { useAppStore } from '@/store/app';
import { useT } from '@/lib/i18n';
import { WEEKDAYS, fmtPct, fmtNum } from '@/lib/format';
import type { HeatCell } from '@/lib/types';

/** Day × hour matrix; cells under minPosts are grey. Custom SVG (spec 2). */
export function Heatmap({ matrix, minPosts }: { matrix: HeatCell[][]; minPosts: number }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const [hover, setHover] = useState<HeatCell | null>(null);
  const cell = 26;
  const gap = 3;
  const left = 36;
  const top = 18;
  const width = left + 24 * (cell + gap);
  const height = top + 7 * (cell + gap);
  const qualified = matrix.flat().filter((c) => c.qualified && c.value != null);
  const max = Math.max(0.01, ...qualified.map((c) => c.value as number));
  const min = Math.min(max, ...qualified.map((c) => c.value as number));
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxHeight: 240 }} role="img" aria-label="heatmap">
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => <text key={h} x={left + h * (cell + gap)} y={12} fontSize="11" fill="var(--ink-2)">{h}:00</text>)}
        {order.map((wd, row) => (
          <g key={wd}>
            <text x={0} y={top + row * (cell + gap) + cell / 2 + 4} fontSize="11" fill="var(--ink-2)">{WEEKDAYS[lang][wd]}</text>
            {matrix[wd].map((c) => {
              const norm = c.qualified && c.value != null ? (c.value - min) / (max - min || 1) : 0;
              const fill = c.qualified ? `rgba(79,124,255,${(0.18 + 0.82 * norm).toFixed(2)})` : c.count ? 'var(--line)' : 'var(--surface-2)';
              return (
                <rect key={c.hour} x={left + c.hour * (cell + gap)} y={top + row * (cell + gap)} width={cell} height={cell} rx={3} fill={fill}
                  stroke={hover === c ? 'var(--ink-1)' : 'none'} onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)} />
              );
            })}
          </g>
        ))}
      </svg>
      {hover && (
        <div className="absolute right-0 top-0 rounded border border-line bg-surface-2 px-3 py-2 text-xs num pointer-events-none">
          <div className="text-ink-2">{WEEKDAYS[lang][hover.weekday]} {hover.hour}:00</div>
          <div>{hover.count} {t('posts').toLowerCase()}{hover.count < minPosts ? ` (< ${minPosts})` : ''}</div>
          {hover.value != null && <div>ER {fmtPct(hover.value, 2)} · {t('reach').toLowerCase()} {fmtNum(hover.avgReach)}</div>}
        </div>
      )}
    </div>
  );
}
