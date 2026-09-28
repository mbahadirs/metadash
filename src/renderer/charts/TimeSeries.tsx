import { ResponsiveContainer, ComposedChart, Line, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { fmtCompact, fmtDate } from '@/lib/format';
import { rechartsTooltip } from './Tooltip';

export interface SeriesSpec { key: string; name: string; color: string; type?: 'line' | 'bar' | 'area'; axis?: 'left' | 'right'; format?: (v: number | null) => string; dashed?: boolean }

/** Generic dual-axis time series. Horizontal grid only, axis labels in --ink-2. */
export function TimeSeries({ data, series, xKey = 'date', rightFormat, prevLookup, legend = true }: { data: object[]; series: SeriesSpec[]; xKey?: string; rightFormat?: (v: number) => string; prevLookup?: (label: string, key: string) => number | null; legend?: boolean }) {
  const hasRight = series.some((s) => s.axis === 'right');
  const formatters = Object.fromEntries(series.map((s) => [s.key, { name: s.name, format: s.format }]));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: hasRight ? 8 : 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey={xKey} tickFormatter={(v) => (typeof v === 'string' && v.length === 10 ? fmtDate(v) : String(v))} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={28} />
        <YAxis yAxisId="left" tickFormatter={(v) => fmtCompact(v)} tickLine={false} axisLine={false} width={48} />
        {hasRight && <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => (rightFormat ? rightFormat(v) : fmtCompact(v))} tickLine={false} axisLine={false} width={52} />}
        <Tooltip content={rechartsTooltip(formatters, prevLookup)} cursor={{ stroke: 'var(--line)' }} isAnimationActive={false} />
        {legend && <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--ink-2)' }} />}
        {series.map((s) => {
          const common = { key: s.key, dataKey: s.key, name: s.name, yAxisId: s.axis ?? 'left', isAnimationActive: false } as const;
          if (s.type === 'bar') return <Bar {...common} fill={s.color} opacity={0.6} radius={[2, 2, 0, 0]} maxBarSize={18} />;
          if (s.type === 'area') return <Area {...common} type="monotone" stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={2} dot={false} />;
          return <Line {...common} type="monotone" stroke={s.color} strokeWidth={2} dot={false} strokeDasharray={s.dashed ? '4 3' : undefined} activeDot={{ r: 3 }} />;
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
