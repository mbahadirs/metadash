import { fmtNum } from '@/lib/format';

interface Item { name: string; value: number | null; color?: string; format?: (v: number | null) => string; prev?: number | null }

export function ChartTooltip({ label, items }: { label?: string; items: Item[] }) {
  return (
    <div className="rounded border border-line bg-surface-2 px-3 py-2 text-xs shadow-lg min-w-[140px]">
      {label && <div className="text-ink-2 mb-1">{label}</div>}
      {items.map((it) => (
        <div key={it.name} className="flex items-center justify-between gap-4 num">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: it.color ?? 'var(--accent)' }} />{it.name}</span>
          <span>{(it.format ?? fmtNum)(it.value)}{it.prev != null && <span className="text-ink-2 ml-1">({(it.format ?? fmtNum)(it.prev)})</span>}</span>
        </div>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rechartsTooltip(formatters: Record<string, { name: string; format?: (v: number | null) => string }>, prevLookup?: (label: string, key: string) => number | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <ChartTooltip label={String(label ?? '')} items={payload.map((p: { dataKey: string; value: number; color: string }) => ({
        name: formatters[p.dataKey]?.name ?? p.dataKey, value: p.value, color: p.color, format: formatters[p.dataKey]?.format, prev: prevLookup?.(String(label), p.dataKey) ?? null,
      }))} />
    );
  };
}
