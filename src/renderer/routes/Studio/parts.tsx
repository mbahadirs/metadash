import { useT, type Key } from '@/lib/i18n';
import { fmtNum } from '@/lib/format';
import { EmptyState } from '@/components/ui';
import { fmtUsd } from '@/hooks/useStudio';
import type { AiUsage, StudioCapabilities } from '@/lib/types';

/** Shared Studio UI pieces (v1.5 chunk A). Chunks B/C/D may import these; they must not edit this file. */

/** Placeholder for a Studio tab whose chunk has not landed yet. */
export function ComingSoon() {
  const t = useT();
  return <EmptyState title={t('studio_coming_soon')} />;
}

/** "≈ 1,234 in / 56 out tokens · ≈ $0.0012 (estimate)" or "local"; hidden when the user turned cost display off. */
export function CostLine({ usage, costUsd, caps }: { usage: AiUsage | null | undefined; costUsd: number | null | undefined; caps?: StudioCapabilities | null }) {
  const t = useT();
  if (!usage || caps?.showCost === false) return null;
  const cost = caps?.local ? t('studio_cost_local') : costUsd == null ? t('studio_cost_unknown') : fmtUsd(costUsd);
  return <span className="text-xs text-ink-2 num">{t('studio_cost_line', { i: fmtNum(usage.inputTokens), o: fmtNum(usage.outputTokens), c: cost })}</span>;
}

/** Provider / model / vision / local badges for the Studio header and generate panels. */
export function CapabilityBadges({ caps }: { caps: StudioCapabilities }) {
  const t = useT();
  const vision: Key = caps.visionDisabledByUser ? 'studio_vision_off' : caps.vision === true ? 'studio_vision_yes' : caps.vision === false ? 'studio_vision_no' : 'studio_vision_unknown';
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="badge badge-muted">{t('studio_provider_badge', { p: t(`ai_provider_${caps.provider}` as Key), m: caps.model })}</span>
      <span className={`badge ${caps.vision === true ? 'badge-pos' : 'badge-muted'}`}>{t(vision)}</span>
      {caps.local && <span className="badge badge-pos">{t('studio_local_badge')}</span>}
    </span>
  );
}

/** Month-to-date spend with the budget warning (Settings → AI budget). */
export function SpendBadge({ caps }: { caps: StudioCapabilities }) {
  const t = useT();
  if (caps.showCost === false) return null;
  const over = caps.budgetUsd != null && caps.monthToDateUsd > caps.budgetUsd;
  return (
    <span className={`badge ${over ? 'badge-warn' : 'badge-muted'} num`} title={over ? t('studio_budget_over', { s: fmtUsd(caps.monthToDateUsd), b: fmtUsd(caps.budgetUsd) }) : undefined}>
      {t('ai_mtd', { c: fmtUsd(caps.monthToDateUsd) })}{caps.budgetUsd != null ? ` / ${fmtUsd(caps.budgetUsd)}` : ''}
    </span>
  );
}
