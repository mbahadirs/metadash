import { useState } from 'react';
import { useT, type Key } from '@/lib/i18n';
import { fmtNum } from '@/lib/format';
import { fmtUsd, useSendPreview } from '@/hooks/useStudio';
import { ErrorState, Spinner } from '@/components/ui';

/**
 * "What will be sent?" expandable panel for the ideas and repurpose generate buttons (v1.5 chunk C). The preview runs
 * the same builders as the real call in main (studio:preview), only when opened.
 */
export function SendPanel({ feature, params, enabled = true }: { feature: 'ideas' | 'repurpose'; params: Record<string, unknown>; enabled?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const q = useSendPreview(feature, params, open && enabled);
  return (
    <div className="text-xs">
      <button type="button" className="text-accent hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)} disabled={!enabled}>
        {open ? '▾' : '▸'} {t('studio_what_sent')}
      </button>
      {open && enabled && (
        <div className="mt-2 rounded border border-line bg-surface-2 p-3 space-y-1.5">
          {q.isLoading ? <Spinner size={14} /> : q.error ? <ErrorState error={q.error} /> : q.data ? (
            <>
              <ul className="space-y-1">
                {q.data.items.map((it) => (
                  <li key={it.label} className="flex justify-between gap-3">
                    <span>{t(it.label as Key)}</span>
                    <span className="text-ink-2 num">
                      {it.count != null ? t('ideas_send_count', { n: fmtNum(it.count) }) : ''}
                      {it.count != null && it.chars != null ? ' · ' : ''}
                      {it.chars != null ? t('ideas_send_chars', { n: fmtNum(it.chars) }) : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="text-ink-2 num">
                {t('studio_est_tokens', { n: fmtNum(q.data.estInputTokens) })}
                {q.data.local ? ` · ${t('studio_cost_local')}` : q.data.estCostUsd != null ? ` · ≈ ${fmtUsd(q.data.estCostUsd)}` : ''}
              </div>
              <div className="text-ink-2">{t('ideas_send_note')}</div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
