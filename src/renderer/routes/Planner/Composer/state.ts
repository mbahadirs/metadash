import type { Platform, PlannerAsset, PlannerCreateInput, PlannerDraft, PlannerFormat, PlannerPatch, PlannerPost, TargetMode, TargetOptions } from '@/lib/types';

/** Local composer state; targets keep `format: null` for "auto" (main infers it from the media). */
export interface ComposerTarget {
  accountId: string; platform: Platform; format: PlannerFormat | null; captionOverride: string | null; firstCommentOverride: string | null;
  options: TargetOptions; mode: TargetMode;
}
export interface ComposerMedia { asset: PlannerAsset; altText: string }
export interface ComposerState {
  title: string; caption: string; firstComment: string; scheduledAt: number | null; notes: string; clientName: string;
  targets: ComposerTarget[]; media: ComposerMedia[];
}

export interface ComposerSeed { scheduledAt?: number | null; caption?: string; accountIds?: string[] }

export function emptyState(seed: ComposerSeed = {}): ComposerState {
  return { title: '', caption: seed.caption ?? '', firstComment: '', scheduledAt: seed.scheduledAt ?? null, notes: '', clientName: '', targets: [], media: [] };
}

export function fromPost(p: PlannerPost): ComposerState {
  return {
    title: p.title ?? '',
    caption: p.caption ?? '',
    firstComment: p.firstComment ?? '',
    scheduledAt: p.scheduledAt,
    notes: p.notes ?? '',
    clientName: p.clientName ?? '',
    targets: p.targets.map((tg) => ({
      accountId: tg.accountId, platform: tg.platform, format: tg.format, captionOverride: tg.captionOverride, firstCommentOverride: tg.firstCommentOverride,
      options: tg.options ?? {}, mode: tg.mode,
    })),
    media: p.assets.filter((a) => a.role === 'media').sort((a, b) => a.position - b.position).map((a) => ({ asset: a.asset, altText: a.altText ?? '' })),
  };
}

const nul = (s: string) => (s.trim() ? s : null);

function targetsInput(s: ComposerState) {
  return s.targets.map((tg) => ({
    accountId: tg.accountId, format: tg.format ?? undefined, captionOverride: tg.captionOverride, firstCommentOverride: tg.firstCommentOverride,
    options: Object.keys(tg.options).length ? tg.options : null, mode: tg.mode,
  }));
}

function assetsInput(s: ComposerState) {
  return s.media.map((m) => ({ assetId: m.asset.id, role: 'media' as const, altText: nul(m.altText) }));
}

export function toCreate(s: ComposerState): PlannerCreateInput {
  let timezone: string | null = null;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null; } catch { /* ignore */ }
  return {
    title: nul(s.title), caption: s.caption, firstComment: nul(s.firstComment), scheduledAt: s.scheduledAt, timezone, notes: nul(s.notes), clientName: nul(s.clientName),
    targets: targetsInput(s), assets: assetsInput(s), source: 'manual',
  };
}

export function toDraft(s: ComposerState, id: number | null): PlannerDraft {
  return { ...toCreate(s), ...(id != null ? { id } : {}) };
}

/** Content patch (time goes through planner:posts:reschedule). */
export function toPatch(s: ComposerState): PlannerPatch {
  return {
    title: nul(s.title), caption: s.caption, firstComment: nul(s.firstComment), notes: nul(s.notes), clientName: nul(s.clientName),
    targets: targetsInput(s), assets: assetsInput(s),
  };
}

/** Stable fingerprint of the content fields (dirty tracking without deep compares). */
export function contentKey(s: ComposerState): string {
  return JSON.stringify(toPatch(s));
}

export function platformsOf(s: ComposerState): Platform[] {
  return [...new Set(s.targets.map((tg) => tg.platform))];
}
