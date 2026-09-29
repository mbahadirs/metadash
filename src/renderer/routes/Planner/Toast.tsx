import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ToastKind = 'info' | 'ok' | 'error';
interface ToastItem { id: number; kind: ToastKind; text: string }

const TOAST_MS = 5000;
const MAX_TOASTS = 4;

const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => {});

/** Planner-local toasts (aria-live so screen readers announce results of drag-and-drop and workflow actions). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++seq.current;
    setItems((cur) => [...cur.slice(-(MAX_TOASTS - 1)), { id, kind, text }]);
    setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== id)), TOAST_MS);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-[420px]" role="status" aria-live="polite">
        {items.map((it) => (
          <div key={it.id} className="panel shadow-xl px-3 py-2 text-sm flex items-start gap-2" style={{ borderColor: it.kind === 'error' ? 'var(--neg)' : it.kind === 'ok' ? 'var(--pos)' : 'var(--line)' }}>
            <span className="flex-1">{it.text}</span>
            <button type="button" className="btn btn-ghost btn-sm" aria-label="close" onClick={() => setItems((cur) => cur.filter((x) => x.id !== it.id))}>✕</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
