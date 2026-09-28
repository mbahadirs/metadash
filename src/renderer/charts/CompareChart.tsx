import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { fmtCompact, fmtDate } from '@/lib/format';
import { rechartsTooltip } from './Tooltip';

export function CompareChart({ merged, series, format }: { merged: Record<string, string | number | null>[]; series: { igId: string; username: string; color: string }[]; format?: (v: number | null) => string }) {
  const formatters = Object.fromEntries(series.map((s) => [s.igId, { name: '@' + s.username, format }]));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={merged} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="date" tickFormatter={(v) => fmtDate(v)} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={28} />
        <YAxis tickFormatter={(v) => (format ? format(v) : fmtCompact(v))} tickLine={false} axisLine={false} width={52} />
        <Tooltip content={rechartsTooltip(formatters)} isAnimationActive={false} />
        <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        {series.map((s) => <Line key={s.igId} dataKey={s.igId} name={'@' + s.username} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />)}
      </LineChart>
    </ResponsiveContainer>
  );
}
