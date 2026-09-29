const HOUR = 3_600_000;

/** Default hours between insight refreshes per post age tier (settings.refreshTiers overrides). */
export const DEFAULT_TIERS = { fresh: 48, recent: 24, month: 168, old: 720 };

/** Which posts need an insight refresh right now, by age tier (hours between refreshes). */
export function needsRefresh(ageHours, lastCapturedAt, now, tiers) {
  if (!lastCapturedAt) return true;
  const sinceLast = (now - lastCapturedAt) / HOUR;
  if (ageHours <= 48) return true;
  if (ageHours <= 24 * 7) return sinceLast >= tiers.recent;
  if (ageHours <= 24 * 30) return sinceLast >= tiers.month;
  return sinceLast >= tiers.old;
}
