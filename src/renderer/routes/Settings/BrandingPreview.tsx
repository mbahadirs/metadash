import { useT } from '@/lib/i18n';
import type { Branding } from '@/hooks/useBranding';

/** Miniature report page showing the current branding. The logo is only ever rendered via <img src="data:…">. */
export function BrandingPreview({ b }: { b: Branding }) {
  const t = useT();
  const bars = [72, 48, 90, 60, 35];
  return (
    <div>
      <div className="text-xs text-ink-2 mb-1">{t('preview')}</div>
      <div className="rounded border border-line bg-white text-[#111] p-4 text-[11px] shadow-sm" aria-label={t('preview')}>
        {(b.agencyName || b.logo) && (
          <div className="flex items-center gap-2 pb-2 mb-3" style={{ borderBottom: `2px solid ${b.accent}` }}>
            {b.logo && <img src={b.logo} alt="" className="h-6 max-w-[100px] object-contain" />}
            {b.agencyName && <span className="font-semibold text-xs">{b.agencyName}</span>}
          </div>
        )}
        <div className="text-sm font-semibold">{t('brand_sample_title')}</div>
        <div className="text-[#666] mb-3">@client · 01.09 – 28.09</div>
        <div className="font-semibold mb-1 pl-2" style={{ borderLeft: `3px solid ${b.accent}` }}>{t('reach')}</div>
        <div className="flex items-end gap-1 h-12 mb-3">{bars.map((h, i) => <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: b.accent, opacity: 0.35 + i * 0.13 }} />)}</div>
        <div className="border-t border-[#ddd] pt-2 text-[#666] space-y-0.5">
          {b.footerText && <div className="text-[#111] truncate">{b.footerText}</div>}
          {!b.hideCredit && <div>{t('brand_sample_credit')}</div>}
        </div>
      </div>
    </div>
  );
}
