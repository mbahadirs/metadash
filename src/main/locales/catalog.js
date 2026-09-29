import fs from 'node:fs';

/**
 * Main-process translation catalog (v2.0). Pure: no config or Electron imports, so pure modules (meta/errors.js,
 * reports, lifecycle rules) and tests can use it directly. `i18n.js` adds the configured-language default on top.
 *
 * Layout: locales/<lang>/<namespace>.json, flat { key: string } per file, `{var}` placeholders.
 * - Message namespaces (every file not listed in DOCUMENT_NAMESPACES) are merged into one keyspace for msg();
 *   keys must be unique across them (tests/i18n.test.js enforces it).
 * - Document namespaces (report, approval) are separate keyspaces read with docTranslator()/namespaceFor().
 * Fallback chain: lang (e.g. de-AT) → base (de) → en → the key itself.
 * JSON is read with fs + import.meta.url (works inside asar, no import attributes needed on Node 20).
 */
const ROOT = new URL('./', import.meta.url);
export const DEFAULT_LANG = 'en';
export const DOCUMENT_NAMESPACES = new Set(['report', 'approval']);
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

/** [{ code, name (native), englishName, dir, intl, reportIntl, dateFns, partial? }] */
export const LOCALES = Object.freeze(JSON.parse(fs.readFileSync(new URL('./index.json', ROOT), 'utf8')));
const BY_CODE = new Map(LOCALES.map((l) => [l.code, l]));
export const LANG_CODES = Object.freeze(LOCALES.map((l) => l.code));
/** Language code → English name, for AI prompts ("Write in German"). */
export const LANGUAGE = Object.freeze(Object.fromEntries(LOCALES.map((l) => [l.code, l.englishName])));

export const isSupportedLang = (lang) => typeof lang === 'string' && BY_CODE.has(lang);

/** Nearest supported code: exact, then base language, then English. */
export function resolveLang(lang) {
  if (isSupportedLang(lang)) return lang;
  const base = typeof lang === 'string' ? lang.split('-')[0] : '';
  return isSupportedLang(base) ? base : DEFAULT_LANG;
}

/** Lookup order for a language: [lang, base, en] (deduplicated; malformed codes collapse to en). */
export function fallbackChain(lang) {
  const chain = [];
  if (typeof lang === 'string' && LANG_RE.test(lang)) {
    chain.push(lang);
    if (lang.includes('-')) chain.push(lang.split('-')[0]);
  }
  chain.push(DEFAULT_LANG);
  return [...new Set(chain)];
}

let namespaceNames = null;
/** Namespace names, discovered from locales/en/*.json (English is the source of truth). */
export function namespaces() {
  namespaceNames ??= fs.readdirSync(new URL('./en/', ROOT)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  return namespaceNames;
}

const fileCache = new Map();
/** One namespace file for one language; {} when missing or unreadable. */
export function loadNamespace(lang, ns) {
  const id = `${lang}/${ns}`;
  if (fileCache.has(id)) return fileCache.get(id);
  let dict = {};
  if (LANG_RE.test(lang) && /^[a-z][a-z0-9.]*$/.test(ns)) {
    try { dict = JSON.parse(fs.readFileSync(new URL(`./${lang}/${ns}.json`, ROOT), 'utf8')); } catch { dict = {}; }
  }
  fileCache.set(id, Object.freeze(dict));
  return fileCache.get(id);
}

const messageCache = new Map();
/** All message namespaces of one language merged into a single dictionary. */
export function messagesFor(lang) {
  if (!messageCache.has(lang)) {
    const merged = Object.assign({}, ...namespaces().filter((ns) => !DOCUMENT_NAMESPACES.has(ns)).map((ns) => loadNamespace(lang, ns)));
    messageCache.set(lang, Object.freeze(merged));
  }
  return messageCache.get(lang);
}

/** Replaces every {name} whose name is in vars (single pass, so values containing braces are left alone). */
export function interpolate(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

function lookup(dictFor, key, lang) {
  for (const l of fallbackChain(lang)) {
    const v = dictFor(l)[key];
    if (typeof v === 'string') return v;
  }
  return null;
}

/** Localized message (message namespaces) with {var} interpolation; unknown keys return the key. */
export function translate(key, vars, lang = DEFAULT_LANG) {
  return interpolate(lookup(messagesFor, key, lang) ?? key, vars);
}

/** A document namespace merged along the fallback chain: { key: string } (English fills gaps). */
export function namespaceFor(lang, ns) {
  return Object.freeze(Object.assign({}, ...fallbackChain(lang).reverse().map((l) => loadNamespace(l, ns))));
}

/** (key, vars) => string over one document namespace. */
export function docTranslator(lang, ns) {
  const dict = namespaceFor(lang, ns);
  return (key, vars) => interpolate(dict[key] ?? key, vars);
}

/** Intl locale for UI numbers/dates. */
export const intlLocale = (lang) => BY_CODE.get(resolveLang(lang)).intl;
/** Intl locale for exported documents (English reports use en-GB day/month order). */
export const reportLocale = (lang) => BY_CODE.get(resolveLang(lang)).reportIntl;
/** date-fns locale export name (e.g. 'enUS', 'tr', 'de'). */
export const dateFnsLocaleName = (lang) => BY_CODE.get(resolveLang(lang)).dateFns;
export const isRtl = (lang) => BY_CODE.get(resolveLang(lang)).dir === 'rtl';

/**
 * Pre-2.0 tuple view of a namespace ({ key: [a, b] } in the given language order). Only for the deprecated
 * compatibility modules under src/main/i18n/; new code uses translate()/msg().
 */
export function legacyTuples(ns, order = ['en', 'tr']) {
  const en = loadNamespace(DEFAULT_LANG, ns);
  const dicts = order.map((l) => loadNamespace(l, ns));
  return Object.fromEntries(Object.keys(en).map((k) => [k, dicts.map((d) => d[k] ?? en[k])]));
}
