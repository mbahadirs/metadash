import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { useActivePlatforms, usePlatformScope } from '@/hooks/usePlatforms';
import { PLATFORM_LABELS } from '@/lib/platforms';
import type { Platform } from '@/lib/types';
import { PlatformIcon } from './PlatformBadge';

/**
 * Global All / Instagram / Facebook / Threads chips. Only platforms with tracked accounts are offered, and the
 * whole control is hidden while a single platform exists. The selection is persisted (ui.platformFilter).
 */
export function PlatformFilter({ vertical = false }: { vertical?: boolean }) {
  const t = useT();
  const active = useActivePlatforms();
  const scope = usePlatformScope();
  const setFilter = useAppStore((s) => s.setPlatformFilter);
  if (active.length < 2) return null;
  const toggle = (p: Platform) => {
    const next = scope.includes(p) ? scope.filter((x) => x !== p) : [...scope, p];
    setFilter(next.length === active.length ? [] : next);
  };
  return (
    <div className={`flex ${vertical ? 'flex-wrap' : 'items-center'} gap-1`} role="group" aria-label={t('platform_filter')}>
      <button type="button" className={`chip ${!scope.length ? 'active' : ''}`} onClick={() => setFilter([])}>{t('platform_all')}</button>
      {active.map((p) => (
        <button type="button" key={p} className={`chip ${scope.includes(p) ? 'active' : ''}`} onClick={() => toggle(p)} aria-pressed={scope.includes(p)}>
          <PlatformIcon platform={p} size={12} />{PLATFORM_LABELS[p]}
        </button>
      ))}
    </div>
  );
}
