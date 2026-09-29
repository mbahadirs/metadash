import { plannerError } from '../db/queries/planner.js';
import { PUBLISH_CAPABILITIES, inferFormat } from '../publishing/capabilities.js';

/**
 * Validation of renderer payloads for planner IPC (system boundary). Throws planner_invalid_payload {field}.
 * Account platforms are looked up through the injected `platformOf(accountId)` (never trusted from the renderer).
 */
const MAX = { title: 200, caption: 70_000, comment: 70_000, notes: 10_000, client: 200, tz: 64, label: 50, labels: 20, targets: 50, assets: 30, alt: 1_000, options: 20_000, accountId: 64, search: 200, ids: 500 };
const SOURCES = new Set(['manual', 'duplicate', 'ai_idea', 'repurpose']);
const ROLES = new Set(['media', 'cover']);
const MODES = new Set(['app', 'native']);
const MIN_TIME = Date.UTC(2020, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);

export const invalid = (field) => plannerError('planner_invalid_payload', 'INVALID_PAYLOAD', { field });

export function toId(v, field = 'id') {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw invalid(field);
  return n;
}

export function toIds(v, field = 'ids') {
  if (!Array.isArray(v) || !v.length || v.length > MAX.ids) throw invalid(field);
  return [...new Set(v.map((x) => toId(x, field)))];
}

function str(v, max, field, { nullable = true, trim = false } = {}) {
  if (v === undefined) return undefined;
  if (v === null) { if (nullable) return null; throw invalid(field); }
  if (typeof v !== 'string' || v.length > max) throw invalid(field);
  return trim ? v.trim() : v;
}

export function toTime(v, field = 'scheduledAt') {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < MIN_TIME || n > MAX_TIME) throw invalid(field);
  return n;
}

function toOptions(v) {
  if (v == null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw invalid('options');
  const json = JSON.stringify(v);
  if (json.length > MAX.options) throw invalid('options');
  return JSON.parse(json);
}

function toLabels(v) {
  if (v === undefined) return undefined;
  if (v === null) return [];
  if (!Array.isArray(v) || v.length > MAX.labels) throw invalid('labels');
  return [...new Set(v.map((l) => str(l, MAX.label, 'labels', { nullable: false, trim: true })).filter(Boolean))];
}

/** [{ assetId, role?, altText? }] → normalized items; `assetExists(id)` checks the library. */
export function toAssetItems(v, assetExists) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > MAX.assets) throw invalid('assets');
  return v.map((it) => {
    if (!it || typeof it !== 'object') throw invalid('assets');
    const assetId = toId(it.assetId, 'assetId');
    if (!assetExists(assetId)) throw plannerError('planner_asset_not_found', 'NOT_FOUND');
    const role = it.role ?? 'media';
    if (!ROLES.has(role)) throw invalid('role');
    return { assetId, role, altText: str(it.altText ?? null, MAX.alt, 'altText') };
  });
}

/**
 * [{ accountId, format?, captionOverride?, firstCommentOverride?, options?, mode? }] → targets with a trusted platform
 * and a format (inferred from `media` when omitted).
 * @param {(accountId: string) => string|null} platformOf
 * @param {{ kind: string, width?: number, height?: number, rotation?: number }[]} media ordered media assets
 */
export function toTargets(v, { platformOf, media = [] }) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > MAX.targets) throw invalid('targets');
  const seen = new Set();
  return v.map((t) => {
    if (!t || typeof t !== 'object') throw invalid('targets');
    const accountId = str(String(t.accountId ?? ''), MAX.accountId, 'accountId', { nullable: false, trim: true });
    if (!accountId || seen.has(accountId)) throw invalid('accountId');
    seen.add(accountId);
    const platform = platformOf(accountId);
    if (!platform) throw plannerError('planner_account_unknown', 'ACCOUNT_UNKNOWN', { id: accountId });
    const caps = PUBLISH_CAPABILITIES[platform];
    const format = t.format ?? inferFormat(platform, media) ?? caps.formats[0];
    if (!caps.formats.includes(format)) throw plannerError('planner_format_invalid', 'FORMAT_INVALID', { format: String(format).slice(0, 20), platform });
    const mode = t.mode ?? 'app';
    if (!MODES.has(mode) || (mode === 'native' && !caps.nativeSchedule)) throw invalid('mode');
    return {
      accountId, platform, format, mode,
      captionOverride: str(t.captionOverride ?? null, MAX.caption, 'captionOverride'),
      firstCommentOverride: str(t.firstCommentOverride ?? null, MAX.comment, 'firstCommentOverride'),
      options: toOptions(t.options),
    };
  });
}

/** Post fields shared by create and update (undefined = not provided). */
export function toPostFields(p) {
  if (!p || typeof p !== 'object') throw invalid('payload');
  const source = p.source ?? undefined;
  if (source !== undefined && !SOURCES.has(source)) throw invalid('source');
  const out = {
    title: str(p.title, MAX.title, 'title'),
    caption: p.caption === null ? '' : str(p.caption, MAX.caption, 'caption'),
    firstComment: str(p.firstComment, MAX.comment, 'firstComment'),
    timezone: str(p.timezone, MAX.tz, 'timezone'),
    clientName: str(p.clientName, MAX.client, 'clientName'),
    notes: str(p.notes, MAX.notes, 'notes'),
    labels: toLabels(p.labels),
    scheduledAt: toTime(p.scheduledAt),
    source,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

/** posts:list filters. */
export function toListFilters(p = {}) {
  if (typeof p !== 'object' || p === null) throw invalid('filters');
  const arr = (v, field) => {
    if (v == null) return undefined;
    if (!Array.isArray(v) || v.length > MAX.ids) throw invalid(field);
    return v.map((x) => str(String(x), MAX.accountId, field, { nullable: false }));
  };
  return {
    from: toTime(p.from, 'from') ?? undefined,
    to: toTime(p.to, 'to') ?? undefined,
    accountIds: arr(p.accountIds, 'accountIds'),
    platforms: arr(p.platforms, 'platforms'),
    statuses: arr(p.statuses, 'statuses'),
    includeUnscheduled: p.includeUnscheduled == null ? undefined : !!p.includeUnscheduled,
    search: str(p.search ?? undefined, MAX.search, 'search') ?? undefined,
  };
}
