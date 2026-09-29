import { upsertLatest } from '../db/queries/media.js';

/**
 * Interactions = likes + comments + saved + shares + reposts + quotes (missing values count as 0, so Instagram
 * values are unchanged; reposts/quotes are Threads-only). Link clicks are deliberately excluded.
 */
export function interactions(m) {
  return (m.likes ?? 0) + (m.comments ?? 0) + (m.saved ?? 0) + (m.shares ?? 0) + (m.reposts ?? 0) + (m.quotes ?? 0);
}

/** Engagement rate by followers (percentage). Default table column — comparable with competitors. */
export function erByFollowers(m, followers) {
  if (!followers) return null;
  return (interactions(m) / followers) * 100;
}

/** Engagement rate by reach (percentage). */
export function erByReach(m) {
  if (!m.reach) return null;
  return (interactions(m) / m.reach) * 100;
}

/** Save rate = saved / reach (percentage). Best content-quality indicator. */
export function saveRate(m) {
  if (!m.reach) return null;
  return ((m.saved ?? 0) / m.reach) * 100;
}

/** Writes media_latest with the derived engagement rate (by followers). */
export function materializeLatest(mediaId, values, followers, at = Date.now()) {
  const er = erByFollowers(values, followers);
  upsertLatest(mediaId, values, er, at);
  return er;
}

export const METRIC_DEFINITIONS = {
  er_followers: { tr: 'Etkileşim oranı (takipçiye göre) = (beğeni+yorum+kaydetme+paylaşım) / takipçi', en: 'Engagement rate (by followers) = (likes+comments+saves+shares) / followers' },
  er_reach: { tr: 'Etkileşim oranı (erişime göre) = (beğeni+yorum+kaydetme+paylaşım) / erişim', en: 'Engagement rate (by reach) = (likes+comments+saves+shares) / reach' },
  save_rate: { tr: 'Kaydetme oranı = kaydetme / erişim', en: 'Save rate = saves / reach' },
  growth: { tr: 'Takipçi büyümesi = dönem sonu − dönem başı takipçi', en: 'Follower growth = followers at end − followers at start' },
  consistency: { tr: 'Paylaşım düzenliliği = son 30 gün haftalık gönderi sayısının standart sapması (düşük = düzenli)', en: 'Posting consistency = std. dev. of weekly post count in last 30 days (lower = steadier)' },
  health: { tr: 'Sağlık skoru = büyüme %30 + etkileşim %30 + düzenlilik %20 + yanıt oranı %20, portföy yüzdeliğine göre', en: 'Health score = growth 30% + engagement 30% + consistency 20% + response rate 20%, percentile-normalised within portfolio' },
};
