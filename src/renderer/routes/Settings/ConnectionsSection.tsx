import { useT } from '@/lib/i18n';
import { usePlatforms } from '@/hooks/usePlatforms';
import { PLATFORMS, PLATFORM_LABELS } from '@/lib/platforms';
import type { Platform, PlatformInfo } from '@/lib/types';
import { Section, Loading } from '@/components/ui';
import { PlatformIcon } from '@/components/PlatformBadge';
import { FacebookPagesPanel } from '@/routes/Setup/FacebookPages';
import { ThreadsConnect } from '@/routes/Setup/ThreadsConnect';

/** Settings → Connections: per-platform status, Facebook Page tracking and the Threads connection. */
export function ConnectionsSection() {
  const t = useT();
  const q = usePlatforms();
  const info = (p: Platform) => q.data?.find((x) => x.platform === p);
  return (
    <Section title={t('connections')}>
      <div className="space-y-5 text-sm">
        <p className="text-xs text-ink-2 m-0">{t('connections_hint')}</p>
        {q.isLoading ? <Loading /> : (
          <div className="grid grid-cols-3 gap-3">{PLATFORMS.map((p) => <StatusCard key={p} platform={p} info={info(p)} />)}</div>
        )}
        <details className="panel p-3" open={(info('facebook')?.trackedCount ?? 0) > 0}>
          <summary className="cursor-pointer font-medium flex items-center gap-2"><PlatformIcon platform="facebook" size={16} />{t('fb_pages_title')}</summary>
          <div className="mt-3">{info('facebook')?.enabled === false ? <div className="text-ink-2">{t('not_in_build')}</div> : <FacebookPagesPanel />}</div>
        </details>
        <details className="panel p-3" open>
          <summary className="cursor-pointer font-medium flex items-center gap-2"><PlatformIcon platform="threads" size={16} />Threads</summary>
          <div className="mt-3">{info('threads')?.enabled === false ? <div className="text-ink-2">{t('not_in_build')}</div> : <ThreadsConnect onChange={() => q.refetch()} />}</div>
        </details>
      </div>
    </Section>
  );
}

function StatusCard({ platform, info }: { platform: Platform; info: PlatformInfo | undefined }) {
  const t = useT();
  const state = !info || info.enabled === false ? { cls: 'text-ink-2', text: t('not_in_build') }
    : info.connected ? { cls: 'text-pos', text: t('connected') } : { cls: 'text-ink-2', text: t('threads_not_connected_label') };
  return (
    <div className="panel p-3 flex items-center gap-3">
      <PlatformIcon platform={platform} size={24} />
      <div className="min-w-0">
        <div className="font-medium">{PLATFORM_LABELS[platform]} <span className="text-ink-2 text-xs font-normal">· {info?.auth === 'threads' ? 'Threads' : 'Meta'}</span></div>
        <div className="text-xs"><span className={state.cls}>{state.text}</span>{info && info.enabled !== false && <span className="text-ink-2 num"> · {t('tracked_n', { n: info.trackedCount })}</span>}</div>
      </div>
    </div>
  );
}
