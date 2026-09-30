import type { Key } from '@/lib/i18n';
import type { InboxSentiment } from '@/lib/types';
import { fmtNum } from '@/lib/format';

type T = (key: Key, vars?: Record<string, string | number>) => string;

/** Minutes → "45 min" / "3.5 h" / "2.1 d" (localized). */
export function fmtMinutes(t: T, min: number | null | undefined): string {
  if (min == null) return '—';
  if (min < 60) return t('ix_min', { n: fmtNum(min) });
  if (min < 48 * 60) return t('ix_hours', { n: fmtNum(min / 60, 1) });
  return t('ix_days', { n: fmtNum(min / 1440, 1) });
}

export const SENTIMENTS: InboxSentiment[] = ['positive', 'neutral', 'negative', 'question', 'complaint', 'spam'];
export const sentimentKey = (s: InboxSentiment) => `ix_sent_${s}` as Key;
export const sentimentClass = (s: InboxSentiment | null) =>
  s === 'negative' || s === 'complaint' ? 'badge-warn' : s === 'spam' ? 'badge-neg' : s === 'positive' ? 'badge-pos' : 'badge-muted';

/** Handles mentioned in a reply other than the commenter (a third party would be notified → extra confirmation). */
export function thirdPartyMentions(text: string, commenter: string, account: string): string[] {
  const skip = new Set([commenter.toLowerCase(), account.toLowerCase()]);
  const found = [...text.matchAll(/@([A-Za-z0-9._]{1,30})/g)].map((m) => m[1]);
  return [...new Set(found.filter((h) => !skip.has(h.toLowerCase())))];
}
