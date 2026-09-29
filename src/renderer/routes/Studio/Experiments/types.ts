import type { AbMetric, AbVariable, AiUsage } from '@/lib/types';

/** studio:ab:* result shapes (v1.5 chunk D; the core types.ts leaves them generic). */
export type AbVerdict = 'need_more' | 'inconclusive' | 'directional';
export type AbExclusion = 'pending' | 'too_young' | 'no_benchmark' | 'no_metric';

export interface AbTestSummary {
  id: number; name: string; hypothesis: string | null; variable: AbVariable | null; metric: AbMetric; status: 'running' | 'concluded';
  createdAt: number; concludedAt: number | null; conclusion: string | null;
  verdict: AbVerdict; winner: string | null; arms: { arm: string; n: number; mean: number | null; total: number }[];
}

export interface AbPost {
  itemId: number; targetId: number | null; mediaKey: string | null; username: string | null; platform: string | null; postedAt: number | null;
  caption: string | null; permalink: string | null; thumbnailPath: string | null; mediaType: string | null; mediaProductType: string | null;
  targetState: string | null; scheduledAt: number | null; lift: number | null; excluded: AbExclusion | null;
}

export interface AbArmResult { arm: string; n: number; mean: number | null; median: number | null; ci: [number, number] | null; excluded: number; posts: AbPost[] }

export interface AbTestDetail extends Omit<AbTestSummary, 'arms'> {
  arms: AbArmResult[]; probBest: number | null; minN: number; minAgeHours: number;
  usage?: AiUsage; costUsd?: number | null;
}

export interface AbCandidates {
  media: { mediaKey: string; accountId: string; username: string; platform: string; caption: string | null; postedAt: number; mediaType: string; mediaProductType: string; thumbnailPath: string | null; reach: number | null; views: number | null; typeKey: string }[];
  targets: { targetId: number; postId: number; accountId: string; username: string | null; platform: string; state: string; mediaKey: string | null; caption: string | null; scheduledAt: number | null; status: string; ref: string | null }[];
}

export type ArmPick = { mediaKeys: string[]; targetIds: number[] };
