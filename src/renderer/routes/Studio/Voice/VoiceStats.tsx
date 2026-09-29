import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { fmtNum, fmtPct } from '@/lib/format';
import { Section } from '@/components/ui';

/** Deterministic caption stats computed in main (studio/voice.js voiceStats); shown with or without AI. */
export interface VoiceStatsData {
  posts: number; avgLength: number; medianLength: number; emojiRate: number; emojiPostShare: number; emojiSet: string[];
  hashtagHabit: { avgCount: number; placement: 'end' | 'inline' | 'mixed' | 'none' }; questionRate: number; mentionRate: number; lineBreakRate: number;
  ctaWords: { word: string; share: number }[]; languages: { lang: string; share: number }[]; pronoun: 'sen' | 'siz' | null;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3 py-1 border-b border-line last:border-0"><span className="text-ink-2">{label}</span><span className="num text-right">{children}</span></div>;
}

export function VoiceStats({ stats }: { stats: VoiceStatsData | null | undefined }) {
  const t = useT();
  if (!stats) return null;
  const pct = (v: number) => fmtPct(v * 100, 0);
  return (
    <Section title={t('sv_stats')}>
      <div className="text-xs text-ink-2 mb-2">{t('sv_stats_hint')}</div>
      <div className="text-sm">
        <Row label={t('sv_stat_posts')}>{fmtNum(stats.posts)}</Row>
        <Row label={t('sv_stat_length')}>{fmtNum(stats.avgLength)} / {fmtNum(stats.medianLength)}</Row>
        <Row label={t('sv_stat_emoji')}>{fmtNum(stats.emojiRate, 1)} {stats.emojiSet.join(' ')}</Row>
        <Row label={t('sv_stat_hashtags')}>{fmtNum(stats.hashtagHabit.avgCount, 1)}</Row>
        <Row label={t('sv_stat_placement')}>{t(`sv_place_${stats.hashtagHabit.placement}`)}</Row>
        <Row label={t('sv_stat_questions')}>{pct(stats.questionRate)}</Row>
        <Row label={t('sv_stat_linebreaks')}>{pct(stats.lineBreakRate)}</Row>
        <Row label={t('sv_stat_languages')}>{stats.languages.length ? stats.languages.map((l) => `${l.lang.toUpperCase()} ${pct(l.share)}`).join(' · ') : '—'}</Row>
        <Row label={t('sv_pronoun')}>{stats.pronoun ?? '—'}</Row>
        <Row label={t('sv_stat_cta')}>{stats.ctaWords.length ? stats.ctaWords.map((c) => c.word).join(', ') : '—'}</Row>
      </div>
    </Section>
  );
}
