/**
 * Report parameter building shared by the CLI (`metadash report`) and, conceptually, the renderer's Reports page
 * (routes/Reports buildParams + store/app.ts presetPeriod — the preset logic is duplicated here because the renderer
 * cannot import main-process modules). Pure: no Electron, database or i18n imports.
 */

/** Templates the CLI can render (basket needs the GUI's post basket). */
export const REPORT_TEMPLATES = Object.freeze(['monthly', 'weekly_client', 'custom', 'portfolio', 'campaign', 'weekly']);
/** Templates that are about specific accounts (need --account / --client / --tag). */
export const ACCOUNT_TEMPLATES = Object.freeze(['monthly', 'weekly_client', 'custom', 'campaign']);
/** Templates that render exactly one account per file. */
export const SINGLE_ACCOUNT_TEMPLATES = Object.freeze(['campaign']);
export const REPORT_FORMATS = Object.freeze(['html', 'pdf', 'xlsx']);
export const PERIOD_PRESETS = Object.freeze(['today', 'yesterday', 'last_7d', 'last_14d', 'last_28d', 'last_30d', 'last_90d', 'this_week', 'last_week', 'this_month', 'last_month']);
/** Period used when neither --period nor --from/--to is given (custom has none: it needs an explicit range). */
export const DEFAULT_PERIOD = Object.freeze({ monthly: 'last_month', weekly_client: 'last_7d', portfolio: 'last_30d', campaign: 'last_30d', weekly: 'last_7d' });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar date as YYYY-MM-DD (same as renderer lib/format isoDate). */
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** True for a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * { from, to } for a preset relative to `now`. last_Nd = N days ending today (the app's "Last N days");
 * weeks run Monday–Sunday; last_week / last_month are complete periods.
 * @returns {{ from: string, to: string } | null} null for an unknown preset
 */
export function presetRange(preset, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = /^last_(\d+)d$/.exec(String(preset ?? ''));
  if (days && PERIOD_PRESETS.includes(preset)) return { from: isoDate(addDays(today, -(Number(days[1]) - 1))), to: isoDate(today) };
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  switch (preset) {
    case 'today': return { from: isoDate(today), to: isoDate(today) };
    case 'yesterday': { const y = isoDate(addDays(today, -1)); return { from: y, to: y }; }
    case 'this_week': return { from: isoDate(monday), to: isoDate(today) };
    case 'last_week': return { from: isoDate(addDays(monday, -7)), to: isoDate(addDays(monday, -1)) };
    case 'this_month': return { from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDate(today) };
    case 'last_month': return { from: isoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: isoDate(new Date(today.getFullYear(), today.getMonth(), 0)) };
    default: return null;
  }
}

/** Error with a machine code and interpolation vars; the CLI maps it to a localized usage error (exit 2). */
export class ReportParamError extends Error {
  constructor(code, vars = {}) {
    super(code);
    this.name = 'ReportParamError';
    this.code = code;
    this.vars = vars;
  }
}

/**
 * Resolves the period: explicit --from/--to win (both required), else --period, else the template default.
 * @returns {{ from: string, to: string, preset: string | null }}
 */
export function resolvePeriod({ template, from, to, period, now = new Date() }) {
  if (from || to) {
    if (!from || !to) throw new ReportParamError('cli_err_from_to_pair');
    if (!isIsoDate(from)) throw new ReportParamError('cli_err_bad_date', { value: from });
    if (!isIsoDate(to)) throw new ReportParamError('cli_err_bad_date', { value: to });
    if (from > to) throw new ReportParamError('cli_err_from_after_to', { from, to });
    return { from, to, preset: null };
  }
  const preset = period ?? DEFAULT_PERIOD[template];
  if (!preset) throw new ReportParamError('cli_err_period_required');
  const range = presetRange(preset, now);
  if (!range) throw new ReportParamError('cli_err_bad_period', { value: preset, list: PERIOD_PRESETS.join(', ') });
  return { ...range, preset };
}

/**
 * Sections map for the export params ({ key: false } = off) from --sections (only these) and --exclude-sections.
 * `available` = the template's built-in sections plus extra (provider/feature) section keys.
 */
export function resolveSections({ available, only = [], exclude = [] }) {
  const known = new Set(available);
  for (const k of [...only, ...exclude]) {
    if (!known.has(k)) throw new ReportParamError('cli_err_bad_section', { value: k, list: available.join(', ') });
  }
  const off = new Set(exclude);
  if (only.length) for (const k of available) if (!only.includes(k)) off.add(k);
  return Object.fromEntries([...off].map((k) => [k, false]));
}

/** Format from --format, else the --out extension, else pdf. */
export function resolveFormat({ format, out }) {
  const ext = /\.(html?|pdf|xlsx)$/i.exec(String(out ?? ''))?.[1]?.toLowerCase();
  const f = format ?? (ext === 'htm' ? 'html' : ext) ?? 'pdf';
  if (!REPORT_FORMATS.includes(f)) throw new ReportParamError('cli_err_bad_format', { value: f, list: REPORT_FORMATS.join(', ') });
  return f;
}

/**
 * Export params exactly as the renderer's Reports page sends them to export:* (routes/Reports buildParams).
 * igIds: resolved account keys (account templates); tagIds / platforms: portfolio filters.
 */
export function buildReportParams({ template, igIds = [], tagIds = [], platforms = [], from, to, lang, sections = {}, commentary = '', coverTitle, branding }) {
  const needsAccount = ACCOUNT_TEMPLATES.includes(template);
  return {
    igIds: needsAccount ? [...igIds] : undefined,
    igId: needsAccount ? igIds[0] : undefined,
    from, to, weekOf: to,
    tagIds: [...tagIds],
    platforms: platforms.length ? [...platforms] : undefined,
    coverTitle: coverTitle || undefined,
    sections: { ...sections },
    basket: [],
    lang,
    commentary: commentary ?? '',
    branding,
  };
}

const SAFE_TOKEN = (s) => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').trim() || 'report';

/**
 * Output path with tokens replaced: {account} (username), {platform}, {client}, {template}, {from}, {to}, {date} (today),
 * {format}. Token values are made filename-safe (no path separators).
 */
export function expandOutPath(pattern, { account, platform, client, template, from, to, format, now = new Date() } = {}) {
  const values = { account, platform, client, template, from, to, format, date: isoDate(now) };
  return String(pattern).replace(/\{(account|platform|client|template|from|to|date|format)\}/g, (_, k) => SAFE_TOKEN(values[k]));
}

/** True when the --out pattern produces one file per account. */
export const isBatchPattern = (pattern) => /\{account\}/.test(String(pattern ?? ''));
