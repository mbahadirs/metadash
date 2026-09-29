import { useT } from '@/lib/i18n';
import { Spinner, CopyButton } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import type { ChatTurn } from '@/hooks/useAsk';
import { StepsPanel } from './StepsPanel';

/** One question + its answer card (or pending / error / cancelled state). */
export function TurnView({ turn, onCancel }: { turn: ChatTurn; onCancel: () => void }) {
  const t = useT();
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg px-3 py-2 bg-surface-2 text-sm whitespace-pre-wrap break-words">{turn.question}</div>
      </div>
      <div className="panel p-4 space-y-3">
        {turn.status === 'pending' && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-ink-2 text-sm"><Spinner size={14} /> {t('ask_thinking')}</span>
            <button type="button" className="btn btn-sm" onClick={onCancel}>{t('cancel')}</button>
          </div>
        )}
        {turn.status === 'cancelled' && <div className="text-sm text-ink-2">{t('ask_cancelled')}</div>}
        {turn.status === 'error' && <div className="text-sm text-neg">{turn.error}</div>}
        {turn.status === 'done' && turn.result && (
          <>
            {turn.result.refusal ? <div className="text-sm text-warn">{turn.result.answer}</div> : <Markdown text={turn.result.answer} />}
            <div className="flex items-center justify-between gap-3 text-[11px] text-ink-2">
              <span>{t('ask_disclaimer')}{turn.result.truncated && ` ${t('ai_truncated')}`} · {turn.result.model}</span>
              {!turn.result.refusal && <CopyButton text={turn.result.answer} />}
            </div>
            <StepsPanel steps={turn.result.steps} />
          </>
        )}
      </div>
    </div>
  );
}
