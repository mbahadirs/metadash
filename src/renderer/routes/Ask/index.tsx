import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { useAiStatus } from '@/hooks/useAi';
import { useAskChat } from '@/hooks/useAsk';
import { useAccounts } from '@/hooks/queries';
import { Loading, EmptyState } from '@/components/ui';
import { TurnView } from './TurnView';

/** "Ask your data": natural-language questions answered by the AI assistant querying the local DB. */
export function AskPage() {
  const status = useAiStatus();
  if (status.isLoading) return <Loading />;
  if (!status.data?.enabled) return <AiOff />;
  return <Chat />;
}

function AiOff() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="max-w-3xl">
      <EmptyState title={t('ask_off_title')} hint={t('ask_off_hint')} action={<button className="btn btn-primary" onClick={() => navigate('/settings', { state: { focus: 'ai' } })}>{t('ask_open_settings')}</button>} />
    </div>
  );
}

function Chat() {
  const t = useT();
  const { turns, busy, ask, cancel, reset } = useAskChat();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [turns]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    setDraft('');
    ask(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); }
  };

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4 min-h-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{t('nav_ask')}</h1>
          <p className="text-sm text-ink-2">{t('ask_intro')}</p>
        </div>
        {turns.length > 0 && <button type="button" className="btn btn-sm flex-none" onClick={reset}>{t('ask_new_chat')}</button>}
      </div>

      <div className="flex-1 space-y-5">
        {turns.length === 0 ? <Suggestions onPick={send} /> : turns.map((turn) => <TurnView key={turn.id} turn={turn} onCancel={cancel} />)}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 bg-surface-0 pt-2 pb-1">
        <div className="flex items-end gap-2">
          <textarea className="input resize-none" rows={2} maxLength={2000} value={draft} placeholder={t('ask_placeholder')} aria-label={t('ask_placeholder')} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
          {busy
            ? <button type="button" className="btn" onClick={cancel}>{t('cancel')}</button>
            : <button type="button" className="btn btn-primary" disabled={!draft.trim()} onClick={() => send(draft)}>{t('ask_send')}</button>}
        </div>
      </div>
    </div>
  );
}

function Suggestions({ onPick }: { onPick: (q: string) => void }) {
  const t = useT();
  const accounts = useAccounts({ onlyTracked: true });
  const first = accounts.data?.[0]?.username;
  const items = [
    t('ask_s_growth'),
    first ? t('ask_s_type', { u: first }) : t('ask_s_type_all'),
    t('ask_s_spend'),
    t('ask_s_reach'),
  ];
  return (
    <div className="panel p-4">
      <div className="text-xs text-ink-2 mb-2">{t('ask_suggestions')}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((q) => <button key={q} type="button" className="btn btn-sm text-left h-auto py-1.5" onClick={() => onPick(q)}>{q}</button>)}
      </div>
    </div>
  );
}
