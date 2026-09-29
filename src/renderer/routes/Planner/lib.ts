import { t, type Key, type Lang } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/format';
import { ApiCallError } from '@/lib/api';
import type { Issue, Platform, PlannerFormat, PostStatus, TargetState } from '@/lib/types';

/** Pure helpers for the Planner screens (dates, statuses, counters, issue text). */

export const DAY_MS = 86_400_000;
export const QUARTER_MS = 15 * 60_000;
export const DEFAULT_HOUR = 10;
export const PAST_GRACE_MS = 60_000;

/** i18n lookup with a fallback for dynamic keys (issue codes, audit actions, reasons). */
export function tx(key: string, lang: Lang, vars?: Record<string, string | number>, fallback?: string): string {
  const s = t(key as Key, lang, vars);
  return s === key ? (fallback ?? key) : s;
}

export function isNotImplemented(e: unknown): boolean {
  return e instanceof ApiCallError && e.code === 'NOT_IMPLEMENTED';
}

export function errorCode(e: unknown): string | null {
  return e instanceof ApiCallError ? String(e.code) : null;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiCallError) return e.hint ? `${e.message} ${e.hint}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

// ---- dates ---------------------------------------------------------------------------------------------------
export function startOfDay(ms: number): Date {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

/** First day of the week containing `d` (weekStartsOn: 0 = Sunday, 1 = Monday). */
export function startOfWeek(d: Date, weekStartsOn: number): Date {
  const day = startOfDay(d.getTime());
  const diff = (day.getDay() - weekStartsOn + 7) % 7;
  return addDays(day, -diff);
}

/** 42 days (6 weeks) covering the month of `anchor`. */
export function monthGrid(anchor: Date, weekStartsOn: number): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first, weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekDays(anchor: Date, weekStartsOn: number): Date[] {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Same time-of-day as `prev` (or DEFAULT_HOUR) on the given day. */
export function keepTimeOnDay(day: Date, prev: number | null): number {
  const p = prev != null ? new Date(prev) : null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), p ? p.getHours() : DEFAULT_HOUR, p ? p.getMinutes() : 0).getTime();
}

/** `<input type="datetime-local">` value in local time. */
export function toLocalInput(ms: number | null): string {
  if (ms == null) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function fmtTime(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

export function fmtMonthTitle(d: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { month: 'long', year: 'numeric' }).format(d);
}

export function fmtDayTitle(d: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

// ---- statuses ------------------------------------------------------------------------------------------------
export const POST_STATUSES: PostStatus[] = ['draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'archived'];

/** CSS colour per status (a token so both themes work). */
export const STATUS_COLOR: Record<PostStatus, string> = {
  draft: 'var(--ink-2)',
  in_review: 'var(--warn)',
  changes_requested: 'var(--neg)',
  approved: 'var(--pos)',
  scheduled: 'var(--accent)',
  publishing: 'var(--accent)',
  published: 'var(--pos)',
  partial: 'var(--warn)',
  failed: 'var(--neg)',
  archived: 'var(--ink-2)',
};

export const STATUS_BADGE: Record<PostStatus, string> = {
  draft: 'badge-muted', in_review: 'badge-warn', changes_requested: 'badge-neg', approved: 'badge-pos', scheduled: 'badge-muted',
  publishing: 'badge-muted', published: 'badge-pos', partial: 'badge-warn', failed: 'badge-neg', archived: 'badge-muted',
};

export const TARGET_BADGE: Record<TargetState, string> = {
  idle: 'badge-muted', queued: 'badge-muted', hosting: 'badge-muted', container: 'badge-muted', ready: 'badge-muted', handed_off: 'badge-pos',
  publishing: 'badge-muted', commenting: 'badge-muted', published: 'badge-pos', failed: 'badge-neg', canceled: 'badge-muted', missed: 'badge-warn', paused: 'badge-warn',
};

/** Posts whose time can be changed by drag and drop. */
export function canReschedule(status: PostStatus): boolean {
  return status !== 'publishing' && status !== 'published' && status !== 'archived';
}

/** Content is read-only while publishing and once published. */
export function isContentLocked(status: PostStatus): boolean {
  return status === 'publishing' || status === 'published';
}

// ---- platforms / formats ---------------------------------------------------------------------------------------
export const FORMATS: Record<Platform, PlannerFormat[]> = {
  instagram: ['image', 'carousel', 'reel', 'story'],
  facebook: ['text', 'link', 'photo', 'album', 'video', 'reel'],
  threads: ['text', 'image', 'video', 'carousel'],
};

/** Renderer mirror of main publishing/limits.js (the server-side validation is authoritative). */
export const TEXT_LIMITS: Record<Platform, { captionMax: number; hashtagsMax?: number; mentionsMax?: number; topicTagsMax?: number; linksMax?: number }> = {
  instagram: { captionMax: 2200, hashtagsMax: 30, mentionsMax: 20 },
  facebook: { captionMax: 63206 },
  threads: { captionMax: 500, topicTagsMax: 1, linksMax: 5 },
};

/** Mirror of main capabilities.inferFormat (for the "Auto (…)" label). */
export function inferFormat(platform: Platform, media: { kind: 'image' | 'video'; width: number | null; height: number | null; rotation: number }[]): PlannerFormat | null {
  if (!media.length) return platform === 'instagram' ? null : 'text';
  if (media.length > 1) return platform === 'facebook' ? 'album' : 'carousel';
  const m = media[0];
  if (m.kind === 'image') return platform === 'facebook' ? 'photo' : 'image';
  if (platform === 'instagram') return 'reel';
  if (platform === 'threads') return 'video';
  const rotated = m.rotation === 90 || m.rotation === 270;
  const w = rotated ? m.height : m.width;
  const h = rotated ? m.width : m.height;
  return w && h && h > w ? 'reel' : 'video';
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export function countGraphemes(text: string): number {
  if (!text) return 0;
  if (!segmenter) return Array.from(text).length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n += 1; // eslint-disable-line @typescript-eslint/no-unused-vars
  return n;
}

const count = (re: RegExp, text: string) => (text ? (text.match(re) ?? []).length : 0);
export const countHashtags = (text: string) => count(/(^|[^\p{L}\p{N}_&#])#[\p{L}\p{N}_]+/gu, text);
export const countMentions = (text: string) => count(/(^|[^\p{L}\p{N}_.@])@[\p{L}\p{N}_.]+/gu, text);
export const countLinks = (text: string) => count(/\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/giu, text);

// ---- issues ----------------------------------------------------------------------------------------------------
function fmtParam(k: string, v: unknown, lang: Lang): string {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (k === 'at' && typeof v === 'number') return fmtDateTime(v);
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (k === 'format' || k === 'kind') return tx(`fmt_${v}`, lang, undefined, String(v));
  return String(v);
}

export function issueText(issue: Issue, lang: Lang): string {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(issue.params ?? {})) vars[k] = fmtParam(k, v, lang);
  return tx(issue.code, lang, vars, issue.code);
}

export const LEVEL_ORDER: Record<Issue['level'], number> = { error: 0, warn: 1, info: 2 };

export function sortIssues(list: Issue[]): Issue[] {
  return [...list].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

export const hasErrors = (list: Issue[] | undefined) => !!list?.some((i) => i.level === 'error');
