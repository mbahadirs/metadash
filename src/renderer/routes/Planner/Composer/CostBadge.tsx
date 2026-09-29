import { useStudioCapabilities } from '@/hooks/useStudio';
import { CostLine } from '@/routes/Studio/parts';
import type { AiUsage } from '@/lib/types';

/** "≈ N in / M out tokens · ≈ $x (estimate)" (or "local") for one finished generation; hidden when cost display is off. */
export function CostBadge({ result }: { result: { usage?: AiUsage | null; costUsd?: number | null } | null | undefined }) {
  const caps = useStudioCapabilities();
  if (!result?.usage) return null;
  return <CostLine usage={result.usage} costUsd={result.costUsd ?? null} caps={caps.data ?? null} />;
}
