import { type ReactNode, useState, useEffect } from 'react';
import { fmtPct, fmtNum } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { ApiCallError } from '@/lib/api';
import type { Kpi as KpiT, Platform } from '@/lib/types';
import { useMultiPlatform } from '@/hooks/usePlatforms';
import { PlatformIcon } from './PlatformBadge';

export function Delta({ value, digits = 1, suffix }: { value: number | null | undefined; digits?: number; suffix?: string }) {
  const t = useT();
  if (value == null || !Number.isFinite(value)) return <span className="text-ink-2 num">—</span>;
  const up = value > 0;
  const flat = Math.abs(value) < 0.05;
  return (
    <span className={`num inline-flex items-center gap-0.5 ${flat ? 'text-ink-2' : up ? 'text-pos' : 'text-neg'}`} title={t('vs_prev')}>
      <span aria-hidden>{flat ? '·' : up ? '▲' : '▼'}</span>
      {fmtPct(Math.abs(value), digits)}{suffix}
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="loading">
      <circle cx="12" cy="12" r="9" stroke="var(--line)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label }: { label?: string }) {
  const t = useT();
  return <div className="flex items-center gap-2 text-ink-2 py-10 justify-center"><Spinner /> {label ?? t('loading')}</div>;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="panel p-10 text-center">
      <div className="text-base">{title}</div>
      {hint && <div className="text-ink-2 mt-1">{hint}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const e = error as ApiCallError | Error;
  const hint = e instanceof ApiCallError ? e.hint : null;
  return (
    <div className="panel p-6 border-neg/40">
      <div className="text-neg">{e?.message ?? String(error)}</div>
      {hint && <div className="text-ink-2 mt-1">{hint}</div>}
    </div>
  );
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-line text-[10px] text-ink-2 cursor-help ml-1 align-middle" title={text} aria-label={text}>i</span>
  );
}

export function Kpi({ label, kpi, format = fmtNum, suffix, tip }: { label: string; kpi: KpiT | undefined; format?: (v: number | null) => string; suffix?: string; tip?: string }) {
  const t = useT();
  return (
    <div>
      <div className="text-ink-2 text-sm flex items-center">{label}{tip && <InfoTip text={tip} />}</div>
      <div className="kpi-value mt-0.5">{format(kpi?.value ?? null)}{suffix}</div>
      {(kpi?.changePct != null || kpi?.prev != null) && (
        <div className="text-xs mt-1 flex items-center gap-1.5">
          <Delta value={kpi?.changePct} />
          {kpi?.prev != null && <span className="text-ink-2 num">{t('prev')}: {format(kpi.prev)}{suffix}</span>}
        </div>
      )}
    </div>
  );
}

export function KpiStrip({ children }: { children: ReactNode }) {
  return <div className="kpi-strip">{children}</div>;
}

/**
 * Round avatar. With `platform`, a small platform mark sits in the bottom-right corner: always for Facebook and
 * Threads, and for Instagram only while several platforms are tracked (single-platform installs stay unchanged).
 */
export function Avatar({ username, url, color, size = 28, platform }: { username: string; url?: string | null; color?: string | null; size?: number; platform?: Platform | null }) {
  const multi = useMultiPlatform();
  const initials = username.slice(0, 2).toUpperCase();
  const img = url ? (
    <img src={url} alt={username} width={size} height={size} className="rounded-full object-cover flex-none" style={{ width: size, height: size }} />
  ) : (
    <div className="rounded-full flex items-center justify-center flex-none font-medium text-white" style={{ width: size, height: size, background: color ?? '#4F7CFF', fontSize: size * 0.38 }} aria-label={username}>{initials}</div>
  );
  const showBadge = !!platform && (platform !== 'instagram' || multi);
  if (!showBadge) return img;
  const badge = Math.max(10, Math.round(size * 0.42));
  return (
    <span className="relative inline-flex flex-none" style={{ width: size, height: size }}>
      {img}
      <span className="absolute rounded-full" style={{ right: -2, bottom: -2, padding: 1, background: 'var(--surface-1)', lineHeight: 0 }}><PlatformIcon platform={platform!} size={badge} /></span>
    </span>
  );
}

export function TagChip({ name, color, active, onClick, small }: { name: string; color?: string; active?: boolean; onClick?: () => void; small?: boolean }) {
  return (
    <button type="button" className={`chip ${active ? 'active' : ''} ${small ? 'h-5 text-[11px] px-1.5' : ''}`} onClick={onClick}>
      <span className="w-2 h-2 rounded-full" style={{ background: color ?? 'var(--accent)' }} />
      {name}
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex border-b border-line" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.id} role="tab" aria-selected={value === tb.id} className={`tab ${value === tb.id ? 'active' : ''}`} onClick={() => onChange(tb.id)}>{tb.label}</button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = 560 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={onClose} role="dialog" aria-modal>
      <div className="panel p-5 max-h-[85vh] overflow-auto" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-semibold">{title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Section({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between px-4 h-11 border-b border-line">
          <div className="font-medium">{title}</div>
          <div className="flex items-center gap-2">{right}</div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn btn-sm" onClick={async () => { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      {ok ? t('copied') : t('copy')}
    </button>
  );
}

export function HealthBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-ink-2">—</span>;
  const cls = score >= 70 ? 'badge-pos' : score >= 40 ? 'badge-muted' : 'badge-neg';
  return <span className={`badge ${cls} num`}>{score}</span>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`w-9 h-5 rounded-full relative transition-colors ${checked ? 'bg-accent' : 'bg-line'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}
