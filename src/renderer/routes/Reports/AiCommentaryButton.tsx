import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { useAiEnabled, type AiAnswer } from '@/hooks/useAi';

/** Report params the main process needs to rebuild the analytics summary (logo, sections, commentary are not sent). */
export interface CommentaryParams { template: string; igIds?: string[]; igId?: string; tagIds?: number[]; from: string; to: string; weekOf?: string; basket?: string[]; lang: 'tr' | 'en' }

/** "Write with AI" for the report commentary. Hidden unless the AI assistant is enabled in Settings. */
export function AiCommentaryButton({ getParams, current, onText, disabled }: { getParams: () => CommentaryParams; current: string; onText: (text: string) => void; disabled?: boolean }) {
  const t = useT();
  const enabled = useAiEnabled();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  if (!enabled) return null;

  const run = async () => {
    if (current.trim() && !confirm(t('ai_replace_confirm'))) return;
    setBusy(true); setNote(null);
    try {
      const res = await call<AiAnswer>(api.ai.reportCommentary(getParams()));
      onText(res.text);
      setNote({ kind: 'ok', text: `${t('ai_draft_note')}${res.truncated ? ` ${t('ai_truncated')}` : ''} · ${res.model}` });
    } catch (e) {
      setNote({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex items-center gap-2 min-w-0">
      {note && <span className={`text-xs truncate ${note.kind === 'ok' ? 'text-ink-2' : 'text-neg'}`} title={note.text}>{note.text}</span>}
      <button type="button" className="btn btn-sm flex-none" disabled={busy || disabled} onClick={run}>{busy ? t('ai_writing') : `✦ ${t('ai_write')}`}</button>
    </span>
  );
}
