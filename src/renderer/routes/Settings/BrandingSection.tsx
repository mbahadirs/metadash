import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { Section, Toggle, Loading } from '@/components/ui';
import { useBranding, isHex, DEFAULT_ACCENT, type Branding } from '@/hooks/useBranding';
import { BrandingPreview } from './BrandingPreview';

/** Settings → Report branding: agency name/logo, accent colour, footer text, MetaDash credit toggle. */
export function BrandingSection() {
  const t = useT();
  const { branding, loading, save } = useBranding();
  const [draft, setDraft] = useState<Branding | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (branding) setDraft(branding); }, [branding]);
  if (loading || !draft) return <Section title={t('brand_section')}><Loading /></Section>;

  const commit = async (patch: Partial<Branding>) => {
    setErr(null);
    try { setDraft(await save(patch)); } catch (e) { setErr((e as Error).message); }
  };
  const pickLogo = async () => {
    setErr(null);
    try { const r = await call<{ dataUrl: string } | null>(api.export.pickLogo()); if (r) await commit({ logo: r.dataUrl }); } catch (e) { setErr((e as Error).message); }
  };
  const accentOk = isHex(draft.accent);
  const field = 'text-xs text-ink-2 mb-1';

  return (
    <Section title={t('brand_section')}>
      <div className="text-xs text-ink-2 mb-3">{t('brand_hint')}</div>
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-3 text-sm">
          <label className="block"><div className={field}>{t('agency_name')}</div><input className="input" maxLength={80} value={draft.agencyName} onChange={(e) => setDraft({ ...draft, agencyName: e.target.value })} onBlur={() => draft.agencyName !== branding?.agencyName && commit({ agencyName: draft.agencyName })} /></label>
          <div><div className={field}>{t('agency_logo')}</div>
            <div className="flex items-center gap-2">
              <button className="btn btn-sm" onClick={pickLogo}>{t('upload_logo')}</button>
              {draft.logo && <><img src={draft.logo} alt="" className="h-7 max-w-[120px] object-contain" /><button className="btn btn-ghost btn-sm" onClick={() => commit({ logo: null })} aria-label={t('remove_logo')}>✕</button></>}
            </div>
            <div className="text-xs text-ink-2 mt-1">{t('logo_limit')}</div>
          </div>
          <div><div className={field}>{t('accent_color')}</div>
            <div className="flex items-center gap-2">
              <input type="color" className="w-9 h-8 rounded border border-line bg-transparent p-0.5 cursor-pointer" value={accentOk && draft.accent.length === 7 ? draft.accent : DEFAULT_ACCENT} onChange={(e) => setDraft({ ...draft, accent: e.target.value })} onBlur={() => commit({ accent: draft.accent })} aria-label={t('accent_color')} />
              <input className={`input w-28 num ${accentOk ? '' : 'border-neg'}`} value={draft.accent} onChange={(e) => setDraft({ ...draft, accent: e.target.value })} onBlur={() => accentOk && draft.accent !== branding?.accent && commit({ accent: draft.accent })} />
              {draft.accent.toLowerCase() !== DEFAULT_ACCENT.toLowerCase() && <button className="btn btn-ghost btn-sm" onClick={() => commit({ accent: DEFAULT_ACCENT })}>↺</button>}
              {!accentOk && <span className="text-xs text-neg">{t('invalid_hex')}</span>}
            </div>
          </div>
          <label className="block"><div className={field}>{t('footer_text')}</div><input className="input" maxLength={240} value={draft.footerText} placeholder={t('footer_placeholder')} onChange={(e) => setDraft({ ...draft, footerText: e.target.value })} onBlur={() => draft.footerText !== branding?.footerText && commit({ footerText: draft.footerText })} /></label>
          <Toggle checked={draft.hideCredit} onChange={(v) => commit({ hideCredit: v })} label={t('hide_credit')} />
          {err && <div className="text-xs text-neg">{err}</div>}
        </div>
        <BrandingPreview b={{ ...draft, accent: accentOk ? draft.accent : DEFAULT_ACCENT }} />
      </div>
    </Section>
  );
}
