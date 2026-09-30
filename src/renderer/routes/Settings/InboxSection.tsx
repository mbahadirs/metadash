import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { useSettings } from '@/hooks/queries';
import { Section, Toggle } from '@/components/ui';

/** Mirrors main/inbox/settings.js (INBOX_DEFAULTS and the clamping ranges). */
const NUMBERS = [
  { key: 'inbox.slaHours', label: 'ix_set_sla', min: 1, max: 720, dflt: 24 },
  { key: 'inbox.pollMinutes', label: 'ix_set_poll_minutes', min: 5, max: 1440, dflt: 30 },
  { key: 'inbox.lookbackDays', label: 'ix_set_lookback', min: 1, max: 90, dflt: 14 },
] as const;

type NumberField = (typeof NUMBERS)[number];

/** Settings → Inbox: reply target (SLA), background polling and AI sentiment. Notifications live in NotificationsSection. */
export function InboxSection() {
  const t = useT();
  const qc = useQueryClient();
  const settings = useSettings();
  const v = (settings.data ?? {}) as Record<string, unknown>;
  const [err, setErr] = useState<string | null>(null);
  const set = async (key: string, value: unknown) => {
    setErr(null);
    try {
      await call(api.settings.set(key, value));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      void qc.invalidateQueries({ queryKey: ['settings'] });
    }
  };
  const poll = v['inbox.poll'] !== false;
  return (
    <Section title={t('ix_set_title')}>
      <div className="text-xs text-ink-2 mb-3">{t('ix_set_intro')}</div>
      <div className="space-y-3">
        <NumberRow field={NUMBERS[0]} value={v[NUMBERS[0].key]} onCommit={(n) => set(NUMBERS[0].key, n)} />
        <div>
          <Toggle checked={poll} onChange={(on) => set('inbox.poll', on)} label={t('ix_set_poll')} />
          <div className="text-xs text-ink-2 pl-12">{t('ix_set_poll_hint')}</div>
        </div>
        <div className={`pl-6 space-y-3 ${poll ? '' : 'opacity-50 pointer-events-none'}`} aria-disabled={!poll}>
          {NUMBERS.slice(1).map((f) => <NumberRow key={f.key} field={f} value={v[f.key]} onCommit={(n) => set(f.key, n)} />)}
        </div>
        <div>
          <Toggle checked={v['inbox.aiSentiment'] === true} onChange={(on) => set('inbox.aiSentiment', on)} label={t('ix_set_ai_sentiment')} />
          <div className="text-xs text-ink-2 pl-12">{t('ix_set_ai_sentiment_hint')}</div>
        </div>
        {err && <div className="text-xs text-neg select-text">{err}</div>}
      </div>
    </Section>
  );
}

/** Number input that writes on blur/Enter, clamped to the main-process range. */
function NumberRow({ field, value, onCommit }: { field: NumberField; value: unknown; onCommit: (n: number) => void }) {
  const t = useT();
  const current = typeof value === 'number' && Number.isFinite(value) ? value : field.dflt;
  const [draft, setDraft] = useState(String(current));
  useEffect(() => setDraft(String(current)), [current]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n)) { setDraft(String(current)); return; }
    const clamped = Math.min(field.max, Math.max(field.min, n));
    setDraft(String(clamped));
    if (clamped !== current) onCommit(clamped);
  };
  return (
    <label className="flex items-center gap-3">
      <span className="w-72">{t(field.label)}</span>
      <input type="number" className="input w-24 num" min={field.min} max={field.max} value={draft}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
    </label>
  );
}
