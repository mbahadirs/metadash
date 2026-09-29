import { useState } from 'react';
import { useT } from '@/lib/i18n';
import type { AskStep } from '@/hooks/useAsk';

const PREVIEW_ROWS = 10;

/** Collapsible "How I found this": each SQL query the model ran, its purpose and a small result table. */
export function StepsPanel({ steps }: { steps: AskStep[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!steps.length) return <div className="text-xs text-ink-2">{t('ask_no_queries')}</div>;
  return (
    <div className="border-t border-line pt-2">
      <button type="button" className="text-xs text-ink-2 hover:text-ink-1 flex items-center gap-1" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>{t('ask_how', { n: steps.length })}
      </button>
      {open && <div className="mt-2 space-y-3">{steps.map((s, i) => <StepView key={i} step={s} index={i + 1} />)}</div>}
    </div>
  );
}

function StepView({ step, index }: { step: AskStep; index: number }) {
  const t = useT();
  const rows = step.rows ?? [];
  const count = step.rowCount ?? 0;
  return (
    <div className="space-y-1">
      <div className="text-xs"><span className="text-ink-2 num">{index}.</span> {step.purpose}</div>
      <pre className="p-2 rounded bg-surface-2 text-[11px] overflow-auto whitespace-pre-wrap break-words">{step.sql}</pre>
      {step.error ? (
        <div className="text-xs text-neg">{t('ask_query_error')}: {step.error}</div>
      ) : (
        <>
          <div className="text-[11px] text-ink-2">{step.truncated ? t('ask_rows_capped', { n: count }) : t('ask_rows', { n: count })}{rows.length > PREVIEW_ROWS && ` · ${t('ask_rows_shown', { n: PREVIEW_ROWS })}`}</div>
          {rows.length > 0 && <ResultTable columns={step.columns ?? []} rows={rows.slice(0, PREVIEW_ROWS)} />}
        </>
      )}
    </div>
  );
}

function ResultTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  return (
    <div className="overflow-auto max-h-64 border border-line rounded">
      <table className="table text-[11px]">
        <thead><tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((v, ci) => <td key={ci} className={typeof v === 'number' ? 'num text-right' : ''}>{formatCell(v)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v);
}
