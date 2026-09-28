import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { ChartTooltip } from './Tooltip';
import { useT } from '@/lib/i18n';

export function LifecycleChart({ curve, hoursTo80 }: { curve: { ageHours: number; ratio: number | null; samples?: number }[]; hoursTo80: number | null }) {
  const t = useT();
  const data = curve.map((p) => ({ ...p, pct: p.ratio != null ? Math.round(p.ratio * 100) : null }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="ageHours" tickFormatter={(v) => `${v}${t('hours_short')}`} tickLine={false} axisLine={{ stroke: 'var(--line)' }} type="number" scale="sqrt" domain={[0, 'dataMax']} ticks={[1, 6, 12, 24, 48, 96, 168, 336, 720]} />
        <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} tickLine={false} axisLine={false} width={40} />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Tooltip isAnimationActive={false} content={({ active, payload }: any) => active && payload?.[0] ? <ChartTooltip label={`${payload[0].payload.ageHours} ${t('hours')}`} items={[{ name: t('pct_of_final'), value: payload[0].payload.pct, format: (v) => `${v}%` }, { name: t('sample'), value: payload[0].payload.samples ?? null }]} /> : null} />
        {hoursTo80 != null && <ReferenceLine x={hoursTo80} stroke="var(--warn)" strokeDasharray="4 3" label={{ value: `80% → ${hoursTo80}${t('hours_short')}`, fill: 'var(--warn)', fontSize: 11, position: 'insideTopRight' }} />}
        <ReferenceLine y={80} stroke="var(--line)" strokeDasharray="2 4" />
        <Line type="monotone" dataKey="pct" stroke="var(--accent)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
