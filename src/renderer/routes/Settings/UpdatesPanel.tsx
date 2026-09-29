import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { Toggle } from '@/components/ui';
import { useUpdateStatus } from '@/hooks/useUpdateStatus';
import type { UpdateStatus } from '@/lib/types';
import { useSettingToggle } from './useSettingToggle';

type T = ReturnType<typeof useT>;

function statusText(s: UpdateStatus, t: T): string {
  if (s.dev) return t('upd_dev');
  switch (s.state) {
    case 'checking': return t('upd_checking');
    case 'available': return t('upd_available', { v: s.version ?? '' });
    case 'not-available': return t('upd_not_available');
    case 'downloading': return t('upd_downloading', { p: s.percent ?? 0 });
    case 'downloaded': return t('upd_downloaded', { v: s.version ?? '' });
    case 'error': return `${t('upd_error')}${s.error ? `: ${s.error}` : ''}`;
    default: return t('upd_idle');
  }
}

/** "Updates" block inside Settings → About: installed version, manual check, status and the auto-check toggle. */
export function UpdatesPanel({ version }: { version: string }) {
  const t = useT();
  const { status, check, download, install, openRelease } = useUpdateStatus();
  const { get, set } = useSettingToggle();
  const [busy, setBusy] = useState(false);
  const onCheck = async () => { setBusy(true); try { await check(); } finally { setBusy(false); } };
  const tone = status.state === 'error' ? 'text-neg' : status.state === 'available' || status.state === 'downloaded' ? 'text-pos' : 'text-ink-2';
  return (
    <div className="mt-4 pt-4 border-t border-line space-y-3 text-sm">
      <div className="font-medium">{t('updates')}</div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-ink-2">{t('current_version')}: <span className="num text-ink-1">v{version}</span></span>
        <button className="btn btn-sm" disabled={busy || status.state === 'checking' || status.state === 'downloading'} onClick={onCheck}>{t('check_updates')}</button>
        <span className={`text-xs ${tone}`}>{statusText(status, t)}</span>
        {status.state === 'available' && !status.manual && <button className="btn btn-primary btn-sm" onClick={() => download()}>{t('upd_download')}</button>}
        {status.state === 'available' && status.manual && <button className="btn btn-primary btn-sm" onClick={() => openRelease()}>{t('upd_open_release')}</button>}
        {status.state === 'downloaded' && <button className="btn btn-primary btn-sm" onClick={() => install()}>{t('upd_restart')}</button>}
      </div>
      <Toggle checked={get('autoUpdateCheck')} onChange={(v) => set('autoUpdateCheck', v)} label={t('auto_update_check')} />
    </div>
  );
}
