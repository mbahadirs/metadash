import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { fmtNum } from '@/lib/format';
import { Spinner } from '@/components/ui';
import { fmtUsd, useSendPreview } from '@/hooks/useStudio';
import type { SendPreviewItem } from '@/lib/types';
import { errorText, tx } from '../lib';

function ItemRow({ item }: { item: SendPreviewItem }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const bits = [
    item.count != null ? t('sv_item_count', { n: fmtNum(item.count) }) : null,
    item.chars != null ? t('sv_item_chars', { n: fmtNum(item.chars) }) : null,
  ].filter(Boolean);
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span>{tx(`sv_item_${item.label}`, lang, undefined, item.label)}</span>
      <span className="text-ink-2 num text-xs whitespace-nowrap">{bits.join(' · ')}</span>
    </li>
  );
}

/**
 * "What will be sent?" disclosure for a generate button. The preview runs the same prompt builder as the real call
 * (studio:preview) and is only fetched when the panel is opened.
 */
export function SendPreview({ feature, params, disabled }: { feature: string; params: Record<string, unknown>; disabled?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const q = useSendPreview(feature, params, open && !disabled);
  const d = q.data;
  return (
    <details className="text-xs" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-ink-2 select-none">{t('studio_what_sent')}</summary>
      <div className="mt-1.5 rounded border border-line p-2 space-y-1.5">
        {q.isFetching && <Spinner size={12} />}
        {q.error ? <div className="text-neg">{errorText(q.error)}</div> : null}
        {d && (
          <>
            <ul className="space-y-0.5">{d.items.map((it) => <ItemRow key={it.label} item={it} />)}</ul>
            <div className="text-ink-2 num">
              {d.local ? t('sv_preview_local') : t('sv_preview_est', { n: fmtNum(d.estInputTokens), c: d.estCostUsd == null ? t('studio_cost_unknown') : fmtUsd(d.estCostUsd) })}
            </div>
          </>
        )}
        <div className="text-ink-2">{t('sv_preview_never')}</div>
      </div>
    </details>
  );
}
