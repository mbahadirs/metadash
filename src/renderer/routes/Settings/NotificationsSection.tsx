import { useT } from '@/lib/i18n';
import { Section, Toggle } from '@/components/ui';
import { useSettingToggle } from './useSettingToggle';

const TYPES = [
  ['notify.anomalies', 'notify_anomalies'],
  ['notify.budget', 'notify_budget'],
  ['notify.silent', 'notify_silent'],
  ['notify.token', 'notify_token'],
] as const;

/** Master switch and per-type toggles for desktop notifications. */
export function NotificationsSection() {
  const t = useT();
  const { get, set } = useSettingToggle();
  const enabled = get('notify.enabled');
  return (
    <Section title={t('notifications')}>
      <div className="text-xs text-ink-2 mb-3">{t('notify_hint')}</div>
      <div className="space-y-3">
        <Toggle checked={enabled} onChange={(v) => set('notify.enabled', v)} label={t('notify_enabled')} />
        <div className={`pl-6 space-y-2 ${enabled ? '' : 'opacity-50 pointer-events-none'}`} aria-disabled={!enabled}>
          {TYPES.map(([key, label]) => <div key={key}><Toggle checked={get(key)} onChange={(v) => set(key, v)} label={t(label)} /></div>)}
        </div>
      </div>
    </Section>
  );
}
