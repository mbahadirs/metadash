import { useT } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/format';
import { api, call } from '@/lib/api';
import { useSession } from '@/hooks/useSession';
import { useTeamState } from '@/hooks/useTeam';
import { ClientViewBanner } from './ClientViewBanner';

/** "Shared workspace, data as of … from …" while this install is a read-only subscriber. */
export function WorkspaceBanner() {
  const t = useT();
  const session = useSession();
  const team = useTeamState();
  if (!session.readOnly || session.role === 'client') return null;
  const s = team.data;
  const text = s?.snapshotAt ? t('team_workspace_banner', { date: fmtDateTime(s.snapshotAt), publisher: s.publisher ?? '—' }) : t('team_workspace_banner_nodate');
  return (
    <div className="bg-surface-2 px-4 py-1.5 text-xs text-ink-2 flex items-center justify-between border-b border-line" role="status">
      <span>{text}{s?.error ? <span className="text-neg ml-2">{s.error}</span> : null}</span>
      <button className="btn btn-ghost btn-sm" onClick={() => { void call(api.team.pullNow()).catch(() => {}); }}>{t('team_pull_now')}</button>
    </div>
  );
}

/** Both team banners, for a single Layout slot (`<TeamBanners />` above the page outlet). */
export function TeamBanners() {
  return <><ClientViewBanner /><WorkspaceBanner /></>;
}
