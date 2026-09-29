import localeIndex from '../../main/locales/index.json';
import type { Key } from '../locales/keys';

/**
 * Renderer translation catalog without store/React dependencies (tests import it directly).
 * Strings live in src/renderer/locales/<lang>/<namespace>.json; the language list is src/main/locales/index.json,
 * shared with the main process. Every locale is bundled eagerly (a few hundred KB), so t() stays synchronous.
 * Fallback chain: lang (e.g. de-AT) → base (de) → en → the key itself.
 */
export type { Key };
/** A code from locales/index.json ('en', 'tr', 'de', 'es', …). */
export type Lang = string;
export interface LocaleInfo { code: string; name: string; englishName: string; dir: string; intl: string; reportIntl: string; dateFns: string; partial?: boolean }
export type Vars = Record<string, string | number>;
type Dict = Readonly<Record<string, string>>;

export const DEFAULT_LANG = 'en';
export const LOCALES: readonly LocaleInfo[] = Object.freeze(localeIndex as LocaleInfo[]);
const BY_CODE = new Map(LOCALES.map((l) => [l.code, l]));

const modules = import.meta.glob<Dict>('../locales/*/*.json', { eager: true, import: 'default' });

/** { lang: { namespace: dict } } */
const CATALOG: Readonly<Record<string, Readonly<Record<string, Dict>>>> = Object.entries(modules).reduce<Record<string, Record<string, Dict>>>((acc, [file, dict]) => {
  const m = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(file);
  return m ? { ...acc, [m[1]]: { ...acc[m[1]], [m[2]]: dict } } : acc;
}, {});

/** { lang: all namespaces merged } */
const DICTS: Readonly<Record<string, Dict>> = Object.fromEntries(
  Object.entries(CATALOG).map(([lang, byNs]) => [lang, Object.freeze(Object.assign({}, ...Object.values(byNs)))]),
);

/** True for codes listed in locales/index.json. */
export const isLang = (v: unknown): boolean => typeof v === 'string' && BY_CODE.has(v);

/** Nearest supported code: exact, then base language, then English. */
export function resolveLang(lang: string | null | undefined): Lang {
  if (typeof lang === 'string' && BY_CODE.has(lang)) return lang;
  const base = typeof lang === 'string' ? lang.split('-')[0] : '';
  return isLang(base) ? base : DEFAULT_LANG;
}

export function fallbackChain(lang: string): string[] {
  const chain = [lang, lang.split('-')[0], DEFAULT_LANG];
  return [...new Set(chain)];
}

export function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

const warned = new Set<string>();
function warnMissing(key: string) {
  if (!import.meta.env?.DEV || warned.has(key)) return;
  warned.add(key);
  console.warn(`[i18n] missing key "${key}" (not in locales/en)`);
}

/** Localized string for key; untranslated keys fall back along the chain, unknown keys return the key. */
export function translate(key: Key | string, lang: Lang, vars?: Vars): string {
  for (const l of fallbackChain(lang)) {
    const v = DICTS[l]?.[key];
    if (typeof v === 'string') return interpolate(v, vars);
  }
  warnMissing(key);
  return interpolate(key, vars);
}

export const localeInfo = (lang: Lang): LocaleInfo => BY_CODE.get(resolveLang(lang)) ?? LOCALES[0];
/** Intl locale for numbers and dates ('en-US', 'tr-TR', …). */
export const intlLocale = (lang: Lang): string => localeInfo(lang).intl;
export const isRtl = (lang: Lang): boolean => localeInfo(lang).dir === 'rtl';
/** Decimal separator of a language's Intl locale ('.' for en-US, ',' for tr/de/es). */
export const decimalSeparator = (lang: Lang): string => new Intl.NumberFormat(intlLocale(lang)).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';

/** Languages the AI studio writes content in (captions, ideas, repurposing); separate from the UI languages. */
export type ContentLang = 'tr' | 'en';
/** Default content language for a UI language. */
export const contentLangFor = (lang: Lang): ContentLang => (resolveLang(lang) === 'tr' ? 'tr' : 'en');

/** Share of English keys translated in lang (0–100, rounded down). */
export function completeness(lang: Lang): number {
  const en = Object.keys(DICTS[DEFAULT_LANG] ?? {});
  if (!en.length) return 100;
  const own = DICTS[lang] ?? {};
  return Math.floor((en.filter((k) => typeof own[k] === 'string').length / en.length) * 100);
}

/** Namespace names per language (for checks and tests). */
export const namespacesOf = (lang: Lang): string[] => Object.keys(CATALOG[lang] ?? {}).sort();
export const namespaceDict = (lang: Lang, ns: string): Dict => CATALOG[lang]?.[ns] ?? {};

/** @deprecated Pre-2.0 tuple view ({ key: [tr, en] }) for the compatibility modules in lib/i18n/. */
export function legacyTuples(ns: string): Record<string, readonly [string, string]> {
  const en = namespaceDict(DEFAULT_LANG, ns);
  const tr = namespaceDict('tr', ns);
  return Object.fromEntries(Object.keys(en).map((k) => [k, [tr[k] ?? en[k], en[k]] as const]));
}
