import { useCallback, useEffect, useRef, useState } from 'react';
import { api, call } from '@/lib/api';
import { useAppStore } from '@/store/app';

export interface AskStep { sql: string; purpose: string; rowCount?: number; truncated?: boolean; columns?: string[]; rows?: unknown[][]; error?: string }
export interface AskResult { answer: string; steps: AskStep[]; truncated: boolean; refusal: boolean; provider: string; model: string }
export type TurnStatus = 'pending' | 'done' | 'error' | 'cancelled';
export interface ChatTurn { id: string; question: string; status: TurnStatus; result?: AskResult; error?: string }

const STORAGE_KEY = 'metadash.ask.turns';
const HISTORY_TURNS = 6;

function loadTurns(): ChatTurn[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((t) => t && typeof t.id === 'string' && t.status !== 'pending') : [];
  } catch {
    return [];
  }
}

function saveTurns(turns: ChatTurn[]) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.filter((t) => t.status !== 'pending'))); } catch { /* storage unavailable: chat stays in memory */ }
}

const newId = () => (typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Prior answered turns as plain text for the main process (it caps and validates them again). */
const historyOf = (turns: ChatTurn[]) =>
  turns.filter((t) => t.status === 'done' && t.result && !t.result.refusal).slice(-HISTORY_TURNS).map((t) => ({ question: t.question, answer: t.result!.answer }));

/** Chat state for "Ask your data": one request at a time, cancellable, kept for the session. */
export function useAskChat() {
  const [turns, setTurns] = useState<ChatTurn[]>(loadTurns);
  const pendingId = useRef<string | null>(null);
  useEffect(() => saveTurns(turns), [turns]);
  // Leaving the page aborts the in-flight request (its answer could not be shown anyway).
  useEffect(() => () => { if (pendingId.current) api.ai.askCancel(pendingId.current)?.catch?.(() => {}); }, []);

  const patch = useCallback((id: string, next: Partial<ChatTurn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id && t.status === 'pending' ? { ...t, ...next } : t)));
  }, []);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || pendingId.current) return;
    const id = newId();
    const { period, lang } = useAppStore.getState();
    const history = historyOf(turns);
    pendingId.current = id;
    setTurns((prev) => [...prev, { id, question: q, status: 'pending' }]);
    try {
      const result = await call<AskResult>(api.ai.ask({ requestId: id, question: q, history, period, lang }));
      patch(id, { status: 'done', result });
    } catch (e) {
      patch(id, { status: 'error', error: (e as Error).message });
    } finally {
      if (pendingId.current === id) pendingId.current = null;
    }
  }, [turns, patch]);

  const cancel = useCallback(() => {
    const id = pendingId.current;
    if (!id) return;
    pendingId.current = null;
    patch(id, { status: 'cancelled' });
    api.ai.askCancel(id)?.catch?.(() => {});
  }, [patch]);

  const reset = useCallback(() => {
    cancel();
    setTurns([]);
  }, [cancel]);

  const busy = turns.some((t) => t.status === 'pending');
  return { turns, busy, ask, cancel, reset };
}
