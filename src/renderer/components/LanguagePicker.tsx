import { useT, LOCALES, completeness, type Lang } from '@/lib/i18n';

/** Chips for every language in locales/index.json (native names); partial translations are marked. */
export function LanguagePicker({ value, onChange, showCompleteness = false, className = '' }: { value: Lang; onChange: (lang: Lang) => void; showCompleteness?: boolean; className?: string }) {
  const t = useT();
  return (
    <div className={`flex flex-wrap gap-1 ${className}`} role="radiogroup" aria-label={t('language')}>
      {LOCALES.map((l) => (
        <button key={l.code} type="button" role="radio" aria-checked={value === l.code} lang={l.code} className={`chip ${value === l.code ? 'active' : ''}`} onClick={() => onChange(l.code)} title={l.partial ? t('lang_partial_tip') : undefined}>
          {l.name}
          {l.partial && <span className="ml-1 text-[10px] text-ink-2">{showCompleteness ? t('lang_partial_pct', { pct: completeness(l.code) }) : t('lang_partial')}</span>}
        </button>
      ))}
    </div>
  );
}
