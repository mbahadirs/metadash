import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { fmtDateTime } from '@/lib/format';
import { api, call } from '@/lib/api';
import { usePlannerAudit } from '@/hooks/usePlanner';
import { EmptyState, ErrorState, Loading } from '@/components/ui';
import type { AuditEntry } from '@/lib/types';
import { errorText, tx } from './lib';

const PAGE = 100;

/** One-line human summary of an audit entry's detail JSON. */
function detailText(e: AuditEntry, lang: 'tr' | 'en'): string {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const st = (v: unknown) => tx(`st_${String(v)}`, lang, undefined, String(v));
  if (d.from != null && d.to != null && typeof d.to === 'string') parts.push(`${st(d.from)} → ${st(d.to)}`);
  else if ('to' in d && (typeof d.to === 'number' || d.to === null)) parts.push(`${typeof d.from === 'number' ? fmtDateTime(d.from) : '—'} → ${typeof d.to === 'number' ? fmtDateTime(d.to) : '—'}`);
  if (typeof d.approver === 'string' && d.approver) parts.push(`${tx('pl_by', lang)} ${d.approver}`);
  if (typeof d.note === 'string' && d.note) parts.push(`“${d.note}”`);
  if (Array.isArray(d.fields) && d.fields.length) parts.push(d.fields.join(', '));
  if (typeof d.version === 'number') parts.push(`v${d.version}`);
  if (typeof d.duplicateOf === 'string') parts.push(`${tx('pl_duplicate_of', lang)} ${d.duplicateOf}`);
  for (const k of ['error', 'message', 'code', 'permalink', 'state'] as const) if (typeof d[k] === 'string' || typeof d[k] === 'number') parts.push(String(d[k]));
  return parts.join(' · ');
}

export function AuditRows({ entries, showRef }: { entries: AuditEntry[]; showRef?: boolean }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  return (
    <table className="table">
      <thead><tr><th>{t('date')}</th>{showRef && <th>{t('pl_post')}</th>}<th>{t('pl_actor')}</th><th>{t('pl_action')}</th><th>{t('pl_details')}</th></tr></thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <td className="num text-ink-2">{fmtDateTime(e.at)}</td>
            {showRef && <td className="num">{e.ref ?? '—'}</td>}
            <td>{tx(`actor_${e.actor}`, lang, undefined, e.actor)}</td>
            <td>{tx(`audit_${e.action}`, lang, undefined, e.action)}</td>
            <td className="whitespace-normal text-ink-2 max-w-[480px]">{detailText(e, lang)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Paged audit log (newest first). With `postId` it is the per-post history. */
export function AuditLog({ postId, initial }: { postId?: number; initial?: AuditEntry[] }) {
  const t = useT();
  const q = usePlannerAudit({ ...(postId != null ? { postId } : {}), limit: PAGE }, !initial);
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const base = initial ?? q.data ?? [];
  useEffect(() => { setMore([]); setDone(false); }, [postId, initial]);
  if (!initial && q.isLoading) return <Loading />;
  if (!initial && q.error) return <ErrorState error={q.error} />;
  const rows = [...base, ...more];
  if (!rows.length) return <EmptyState title={t('pl_log_empty')} />;
  const loadMore = async () => {
    try {
      const next = await call<AuditEntry[]>(api.planner.audit({ ...(postId != null ? { postId } : {}), limit: PAGE, before: rows[rows.length - 1].id }));
      setMore((m) => [...m, ...next]);
      if (next.length < PAGE) setDone(true);
    } catch (e) { setErr(errorText(e)); }
  };
  return (
    <div className="space-y-2">
      <div className="overflow-auto"><AuditRows entries={rows} showRef={postId == null} /></div>
      {err && <div className="text-neg text-xs">{err}</div>}
      {!done && rows.length >= (initial ? initial.length : PAGE) && <button type="button" className="btn btn-sm" onClick={loadMore}>{t('pl_load_more')}</button>}
    </div>
  );
}
