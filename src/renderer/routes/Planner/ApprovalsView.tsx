import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { fmtDateTime } from '@/lib/format';
import { api } from '@/lib/api';
import { plannerApi, usePlannerPosts } from '@/hooks/usePlanner';
import { EmptyState, ErrorState, Loading, Modal, Toggle } from '@/components/ui';
import type { ApprovalExportInput, ApprovalImportResult, Platform, PostStatus } from '@/lib/types';
import { useToast } from './Toast';
import { AssetThumb, PromptDialog, StatusBadge, TargetDots } from './parts';
import { errorText, isNotImplemented, tx } from './lib';

const REVIEW_STATUSES: PostStatus[] = ['in_review', 'changes_requested', 'approved'];

/** Review queue: approve / request changes (manual path), export a client approval pack, import the client's reply. */
export function ApprovalsView({ accountIds, platforms, onOpen }: { accountIds: string[]; platforms: Platform[]; onOpen: (id: number) => void }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const toast = useToast();
  const [status, setStatus] = useState<PostStatus>('in_review');
  const [selected, setSelected] = useState<number[]>([]);
  const [dialog, setDialog] = useState<null | 'approve' | 'changes' | 'export' | 'import'>(null);
  const params = useMemo(() => ({ statuses: [status], ...(accountIds.length ? { accountIds } : {}), ...(platforms.length ? { platforms } : {}) }), [status, accountIds, platforms]);
  const q = usePlannerPosts(params);
  const rows = q.data ?? [];
  const ids = selected.length ? selected : rows.map((r) => r.id);
  const toggle = (id: number) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const apply = async (to: 'approved' | 'changes_requested', extra: { note?: string; approver?: string }) => {
    setDialog(null);
    try {
      const res = await plannerApi.setStatus({ ids, status: to, ...extra });
      const reasons = [...new Set(res.rejected.map((r) => tx(`pl_reason_${r.reason}`, lang, undefined, r.reason)))];
      toast(t('pl_bulk_result', { ok: res.updated.length, failed: res.rejected.length }) + (reasons.length ? ` (${reasons.join('; ')})` : ''), res.rejected.length ? 'info' : 'ok');
      setSelected([]);
    } catch (e) { toast(errorText(e), 'error'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label={t('status')}>
          {REVIEW_STATUSES.map((s) => (
            <button type="button" key={s} className={`chip ${status === s ? 'active' : ''}`} aria-pressed={status === s} onClick={() => { setStatus(s); setSelected([]); }}>{t(`st_${s}`)}</button>
          ))}
        </div>
        <span className="flex-1" />
        {status === 'in_review' && <>
          <button type="button" className="btn btn-sm btn-primary" disabled={!ids.length} onClick={() => setDialog('approve')}>{selected.length ? t('pl_approve_selected', { n: selected.length }) : t('pl_mark_approved')}</button>
          <button type="button" className="btn btn-sm" disabled={!ids.length} onClick={() => setDialog('changes')}>{t('pl_request_changes')}</button>
        </>}
        <button type="button" className="btn btn-sm" disabled={!ids.length} onClick={() => setDialog('export')}>{t('pl_export_pack')}</button>
        <button type="button" className="btn btn-sm" onClick={() => setDialog('import')}>{t('pl_import_response')}</button>
      </div>
      <p className="text-xs text-ink-2">{t('pl_approvals_hint')}</p>

      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : !rows.length ? <EmptyState title={t('pl_approvals_empty')} /> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="panel px-3 py-2 flex items-center gap-3">
              <input type="checkbox" aria-label={`${t('pl_select')} ${r.ref}`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
              {r.thumb ? <AssetThumb assetId={r.thumb.assetId} kind={r.thumb.kind} size={44} /> : <span className="w-11" />}
              <button type="button" className="flex-1 min-w-0 text-left" onClick={() => onOpen(r.id)}>
                <div className="flex items-center gap-2 text-sm"><span className="num text-ink-2">{r.ref}</span><span className="font-medium truncate">{r.title || r.captionPreview || '—'}</span></div>
                <div className="flex items-center gap-2 text-xs text-ink-2 mt-0.5">
                  <TargetDots targets={r.targets} /><span className="num">{r.scheduledAt ? fmtDateTime(r.scheduledAt) : t('pl_unscheduled')}</span><span>v{r.version}</span>
                  {r.clientName && <span>· {r.clientName}</span>}
                </div>
              </button>
              <StatusBadge status={r.status} />
            </li>
          ))}
        </ul>
      )}

      <PromptDialog open={dialog === 'approve'} title={t('pl_mark_approved')} label={t('pl_approver_name')} placeholder={t('pl_approver_placeholder')} confirmLabel={t('pl_approve')}
        onClose={() => setDialog(null)} onSubmit={(v) => apply('approved', v ? { approver: v } : {})}>
        <p className="text-xs text-ink-2">{t('pl_approve_n_hint', { n: ids.length })}</p>
      </PromptDialog>
      <PromptDialog open={dialog === 'changes'} title={t('pl_request_changes')} label={t('pl_change_note')} multiline required confirmLabel={t('pl_request_changes')}
        onClose={() => setDialog(null)} onSubmit={(v) => apply('changes_requested', { note: v })} />
      <ExportPackDialog open={dialog === 'export'} postIds={ids} onClose={() => setDialog(null)} />
      <ImportResponseDialog open={dialog === 'import'} onClose={() => setDialog(null)} />
    </div>
  );
}

function ExportPackDialog({ open, postIds, onClose }: { open: boolean; postIds: number[]; onClose: () => void }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const toast = useToast();
  const [form, setForm] = useState<Omit<ApprovalExportInput, 'postIds'>>({ format: 'html', title: '', clientName: '', lang, includeNotes: false });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await plannerApi.exportPack({ ...form, postIds, title: form.title || undefined, clientName: form.clientName || undefined });
      if (res?.filePath) {
        toast(t('pl_pack_saved', { n: res.count }), 'ok');
        void api.system.revealFile(res.filePath);
      }
      onClose();
    } catch (e) {
      toast(isNotImplemented(e) ? t('pl_pack_unavailable') : errorText(e), 'error');
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('pl_export_pack')} width={480}>
      <form className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className="text-xs text-ink-2">{t('pl_pack_hint', { n: postIds.length })}</p>
        <label className="block"><span className="text-ink-2">{t('pl_pack_title')}</span><input className="input mt-1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="block"><span className="text-ink-2">{t('pl_client_name')}</span><input className="input mt-1" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} /></label>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2"><span className="text-ink-2">{t('pl_pack_format')}</span>
            <select className="input w-auto" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as 'html' | 'pdf' })}>
              <option value="html">{t('pl_pack_html')}</option><option value="pdf">PDF</option>
            </select>
          </label>
          <label className="flex items-center gap-2"><span className="text-ink-2">{t('language')}</span>
            <select className="input w-auto" value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value as 'tr' | 'en' })}>
              <option value="tr">Türkçe</option><option value="en">English</option>
            </select>
          </label>
        </div>
        <Toggle checked={!!form.includeNotes} onChange={(v) => setForm({ ...form, includeNotes: v })} label={t('pl_pack_include_notes')} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !postIds.length}>{t('pl_export_pack')}</button>
        </div>
      </form>
    </Modal>
  );
}

function ImportResponseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const toast = useToast();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ApprovalImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { setCode(''); setResult(null); onClose(); };
  const submit = async () => {
    setBusy(true);
    try { setResult(await plannerApi.importPack(code.trim())); } catch (e) { toast(isNotImplemented(e) ? t('pl_pack_unavailable') : errorText(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={close} title={t('pl_import_response')} width={560}>
      {!result ? (
        <form className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label className="block"><span className="text-ink-2">{t('pl_response_code')}</span>
            <textarea className="input mt-1 font-mono text-xs" rows={5} value={code} onChange={(e) => setCode(e.target.value)} placeholder="MDAP1.…" autoFocus /></label>
          <p className="text-xs text-ink-2">{t('pl_response_hint')}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={close}>{t('cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>{t('pl_apply')}</button>
          </div>
        </form>
      ) : (
        <div className="space-y-3 text-sm">
          <div><div className="font-medium">{t('pl_applied_n', { n: result.applied.length })}</div>
            <ul className="text-xs mt-1 space-y-0.5">{result.applied.map((a) => <li key={a.ref}><span className="num">{a.ref}</span> · {tx(`st_${a.decision}`, lang, undefined, a.decision)}{a.note ? ` · “${a.note}”` : ''}</li>)}</ul></div>
          {result.stale.length > 0 && <div><div className="font-medium text-warn">{t('pl_stale_n', { n: result.stale.length })}</div>
            <p className="text-xs text-ink-2">{t('pl_stale_hint')}</p>
            <ul className="text-xs mt-1 space-y-0.5">{result.stale.map((s) => <li key={s.ref} className="num">{s.ref} · v{s.packVersion} → v{s.currentVersion}</li>)}</ul></div>}
          {result.unknown.length > 0 && <div className="text-xs text-ink-2">{t('pl_unknown_refs')}: {result.unknown.join(', ')}</div>}
          <div className="flex justify-end"><button type="button" className="btn btn-primary" onClick={close}>{t('close')}</button></div>
        </div>
      )}
    </Modal>
  );
}
