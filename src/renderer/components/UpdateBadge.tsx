import { useT } from '@/lib/i18n';
import { useUpdateStatus } from '@/hooks/useUpdateStatus';
import { Icon } from './Icons';

/** Top-bar hint shown only while an update is available, downloading or ready to install. */
export function UpdateBadge() {
  const t = useT();
  const { status, act } = useUpdateStatus();
  const v = status.version ?? '';
  if (status.state === 'downloading') return <span className="badge badge-muted num">{t('upd_downloading', { p: status.percent ?? 0 })}</span>;
  if (status.state !== 'available' && status.state !== 'downloaded') return null;
  const ready = status.state === 'downloaded';
  const title = ready ? t('upd_restart') : status.manual ? t('upd_open_release') : t('upd_download');
  return (
    <button className="badge badge-pos cursor-pointer border-0" onClick={() => act()} title={title}>
      {ready ? <Icon.refresh /> : <Icon.external />}{ready ? t('upd_badge_downloaded') : t('upd_badge_available', { v })}
    </button>
  );
}
