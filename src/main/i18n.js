import { getConfig } from './config/store.js';
import { translate, intlLocale, isSupportedLang, DEFAULT_LANG } from './locales/catalog.js';

/**
 * Main-process user-facing messages. Strings live in locales/<lang>/<namespace>.json (see locales/catalog.js and
 * docs/translating.md); this module only adds "the configured UI language" as the default.
 */
export { LOCALES, LANG_CODES, LANGUAGE, isSupportedLang, resolveLang, reportLocale, intlLocale, isRtl, dateFnsLocaleName } from './locales/catalog.js';

/** Current UI language from config (any code in locales/index.json); falls back to 'en'. */
export function currentLang() {
  try { const lang = getConfig('lang'); return isSupportedLang(lang) ? lang : DEFAULT_LANG; } catch { return DEFAULT_LANG; }
}

/** Localized message for key with {var} interpolation; lang defaults to the configured language. */
export function msg(key, vars, lang = currentLang()) {
  return translate(key, vars, lang);
}

/** Intl locale for number/date formatting in exports, following the configured language. */
export function locale(lang = currentLang()) {
  return intlLocale(lang);
}
