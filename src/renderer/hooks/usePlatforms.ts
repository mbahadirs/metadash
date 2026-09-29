import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/lib/api';
import { useAppStore } from '@/store/app';
import { PLATFORMS, capsOf, primaryMetricOf } from '@/lib/platforms';
import type { Platform, PlatformCapabilities, PlatformInfo } from '@/lib/types';

/** platforms:list — every platform with enabled/connected/trackedCount/capabilities. */
export const usePlatforms = () =>
  useQuery<PlatformInfo[]>({ queryKey: ['platforms'], queryFn: () => call(api.platforms.list()), staleTime: 30_000 });

/** Platforms that currently have tracked accounts (Instagram assumed while loading). */
export function useActivePlatforms(): Platform[] {
  const q = usePlatforms();
  return useMemo(() => {
    if (!q.data) return ['instagram'];
    const active = PLATFORMS.filter((p) => q.data!.some((x) => x.platform === p && x.enabled !== false && x.trackedCount > 0));
    return active.length ? active : ['instagram'];
  }, [q.data]);
}

/** True when more than one platform has tracked accounts (drives filter visibility and badges). */
export function useMultiPlatform(): boolean {
  return useActivePlatforms().length > 1;
}

/** Capability/primary-metric lookups backed by platforms:list, with static fallbacks. */
export function usePlatformCaps() {
  const q = usePlatforms();
  return useMemo(() => ({
    caps: (p: Platform | null | undefined): PlatformCapabilities => capsOf(p, q.data),
    primary: (p: Platform | null | undefined) => primaryMetricOf(p, q.data),
    info: (p: Platform) => q.data?.find((x) => x.platform === p) ?? null,
  }), [q.data]);
}

/**
 * The effective global platform filter: the persisted selection intersected with platforms that have
 * tracked accounts. Empty array = all platforms (also whenever only one platform exists).
 */
export function usePlatformScope(): Platform[] {
  const filter = useAppStore((s) => s.platformFilter);
  const active = useActivePlatforms();
  return useMemo(() => {
    if (active.length < 2) return [];
    const eff = filter.filter((p) => active.includes(p));
    return eff.length === active.length ? [] : eff;
  }, [filter, active]);
}
