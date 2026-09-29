import { useAppStore } from '@/store/app';
import { translate, type Key, type Lang, type Vars } from './i18nCore';

/**
 * UI strings. Dictionaries live in src/renderer/locales/<lang>/<namespace>.json (see docs/translating.md);
 * the catalog, fallback chain and locale helpers are in ./i18nCore.
 */
export type { Key, Lang } from './i18nCore';
export { LOCALES, decimalSeparator, isLang, resolveLang, intlLocale, isRtl, completeness, localeInfo, contentLangFor, type ContentLang } from './i18nCore';

export function t(key: Key, lang: Lang = useAppStore.getState().lang, vars?: Vars): string {
  return translate(key, lang, vars);
}

export function useT() {
  const lang = useAppStore((s) => s.lang);
  return (key: Key, vars?: Vars) => t(key, lang, vars);
}
