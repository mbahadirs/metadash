export function Sparkline({ values, color = 'var(--accent)', width = 96, height = 24 }: { values: (number | null)[]; color?: string; width?: number; height?: number }) {
  const v = values.filter((x): x is number => x != null);
  if (v.length < 2) return <span className="text-ink-2">—</span>;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * width).toFixed(1)},${(height - ((x - min) / span) * (height - 4) - 2).toFixed(1)}`);
  const up = v[v.length - 1] >= v[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" opacity={up ? 1 : 0.8} />
    </svg>
  );
}
