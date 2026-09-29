import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { useSettings } from '@/hooks/queries';
import type { BackgroundSettings } from '@/lib/types';
import { Section, Toggle, Loading } from '@/components/ui';

const BG_KEY = ['appBackground'];
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
const MISSED_POLICIES = [['ask', 'bg_missed_ask'], ['publish', 'bg_missed_publish'], ['skip', 'bg_missed_skip']] as const;

/** Tray mode, launch at login, hidden start, keep-awake and the missed-post policy (v1.4 plan §9). */
export function BackgroundSection() {
  const t = useT();
  const qc = useQueryClient();
  const bg = useQuery<BackgroundSettings>({ queryKey: BG_KEY, queryFn: () => call(api.app.background.get()) });
  const [err, setErr] = useState<string | null>(null);
  const patch = async (p: Partial<BackgroundSettings>) => {
    setErr(null);
    try { qc.setQueryData(BG_KEY, await call<BackgroundSettings>(api.app.background.set(p))); } catch (e) { setErr((e as Error).message); qc.invalidateQueries({ queryKey: BG_KEY }); }
  };

  const s = bg.data;
  return (
    <Section title={t('bg_section')}>
      <div className="text-xs text-ink-2 mb-3">{t('bg_intro')}</div>
      {bg.isLoading || !s ? <Loading /> : (
        <div className="space-y-3">
          <div>
            <Toggle checked={s.trayMode} onChange={(v) => patch({ trayMode: v })} label={t(IS_MAC ? 'bg_tray_mode_mac' : 'bg_tray_mode')} />
            <div className="text-xs text-ink-2 pl-12">{t('bg_tray_hint')}</div>
          </div>
          {s.supported.loginItem
            ? <Toggle checked={s.launchAtLogin} onChange={(v) => patch({ launchAtLogin: v })} label={t('bg_launch_at_login')} />
            : <div className="text-xs text-ink-2">{t('bg_login_unsupported')}</div>}
          <div className={`pl-6 ${s.launchAtLogin && s.trayMode ? '' : 'opacity-50 pointer-events-none'}`} aria-disabled={!(s.launchAtLogin && s.trayMode)}>
            <Toggle checked={s.startHidden} onChange={(v) => patch({ startHidden: v })} label={t('bg_start_hidden')} />
            <div className="text-xs text-ink-2 pl-12">{t('bg_start_hidden_note')}</div>
          </div>
          <div>
            <Toggle checked={s.keepAwakeForPosts} onChange={(v) => patch({ keepAwakeForPosts: v })} label={t('bg_keep_awake')} />
            <div className="text-xs text-ink-2 pl-12">{t('bg_keep_awake_note')}</div>
          </div>
          {err && <div className="text-xs text-neg">{err}</div>}
          <MissedPolicy />
        </div>
      )}
    </Section>
  );
}

function MissedPolicy() {
  const t = useT();
  const qc = useQueryClient();
  const settings = useSettings();
  const v = (settings.data ?? {}) as Record<string, unknown>;
  const set = async (key: string, value: unknown) => { await call(api.settings.set(key, value)); qc.invalidateQueries({ queryKey: ['settings'] }); };
  const policy = typeof v['planner.missedPolicy'] === 'string' ? (v['planner.missedPolicy'] as string) : 'ask';
  return (
    <div className="border-t border-line pt-3 space-y-2">
      <div className="font-medium text-sm">{t('bg_missed_title')}</div>
      <div className="text-xs text-ink-2">{t('bg_missed_hint')}</div>
      <div className="flex items-center gap-3"><span className="w-72 text-sm">{t('bg_missed_policy')}</span>
        <select className="input w-56" value={policy} onChange={(e) => set('planner.missedPolicy', e.target.value)}>
          {MISSED_POLICIES.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
        </select>
      </div>
      <NumberSetting label={t('bg_missed_grace')} value={Number(v['planner.missedGraceMin'] ?? 15)} min={1} max={240} onSave={(n) => set('planner.missedGraceMin', n)} />
      <NumberSetting label={t('bg_missed_max_late')} value={Number(v['planner.maxLateMin'] ?? 180)} min={5} max={1440} onSave={(n) => set('planner.maxLateMin', n)} disabled={policy !== 'publish'} />
      {policy === 'publish' && <div className="text-xs text-ink-2">{t('bg_missed_max_late_note')}</div>}
    </div>
  );
}

/** Number input saved on blur, clamped to [min, max]. */
export function NumberSetting({ label, value, min, max, onSave, disabled }: { label: string; value: number; min: number; max: number; onSave: (n: number) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <span className="w-72 text-sm">{label}</span>
      <input type="number" className="input w-24 num" min={min} max={max} defaultValue={value} key={value} disabled={disabled}
        onBlur={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n) && n !== value) onSave(Math.min(max, Math.max(min, n))); }} />
    </label>
  );
}
