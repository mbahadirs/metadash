import { fmtNum } from '@/lib/format';

/** Horizontal bar list for breakdowns (demographics, ad breakdowns). */
export function BarList({ items, color = 'var(--accent)', format = fmtNum, max: maxProp, animate = false }: { items: { label: string; value: number; color?: string }[]; color?: string; format?: (v: number) => string; max?: number; animate?: boolean }) {
  const max = maxProp ?? Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={it.label} className="flex items-center gap-2 text-xs">
          <div className="w-24 truncate text-ink-2" title={it.label}>{it.label}</div>
          <div className="flex-1 h-4 bg-surface-2 rounded-sm overflow-hidden"><div className={`h-full rounded-sm ${animate ? 'grow-x' : ''}`} style={{ width: `${(it.value / max) * 100}%`, background: it.color ?? color, ["--i" as string]: i }} /></div>
          <div className="w-16 text-right num">{format(it.value)}</div>
          <div className="w-10 text-right num text-ink-2">{((it.value / total) * 100).toFixed(0)}%</div>
        </div>
      ))}
    </div>
  );
}
