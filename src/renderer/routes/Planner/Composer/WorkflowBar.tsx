import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { plannerApi, publishingApi } from '@/hooks/usePlanner';
import type { PlannerPost, PostStatus } from '@/lib/types';
import { useToast } from '../Toast';
import { ConfirmDialog, PromptDialog } from '../parts';
import { errorText, isNotImplemented, tx } from '../lib';

function B({ label, onClick, primary, disabled, title, busy }: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string; busy: boolean }) {
  return <button type="button" className={`btn btn-sm ${primary ? 'btn-primary' : ''}`} onClick={onClick} disabled={busy || disabled} title={title}>{label}</button>;
}

type Dialog = null | 'approve' | 'changes' | 'publishNow' | 'delete';

/**
 * Status transitions for one post (plan §3): draft → in review → approved → scheduled, plus request changes,
 * unschedule, publish now, retry, archive/restore, duplicate and delete. Scheduling goes through chunk B's publishing
 * channels; while those are not available the action reports it instead of failing silently.
 */
export function WorkflowBar({ post, requireApproval, blocked, hasTime, busy, onFlush, onDuplicated, onDeleted }: {
  post: PlannerPost | null; requireApproval: boolean; blocked: boolean; hasTime: boolean; busy: boolean;
  onFlush: () => Promise<PlannerPost | null>; onDuplicated: (id: number) => void; onDeleted: () => void;
}) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [working, setWorking] = useState(false);
  const status: PostStatus = post?.status ?? 'draft';

  const run = async (fn: (p: PlannerPost) => Promise<void>) => {
    setWorking(true);
    try {
      const saved = await onFlush();
      if (saved) await fn(saved);
    } catch (e) {
      toast(isNotImplemented(e) ? t('pl_publishing_unavailable') : errorText(e), 'error');
    } finally {
      setWorking(false);
    }
  };
  const setStatus = (to: PostStatus, extra: { note?: string; approver?: string } = {}) => run(async (p) => {
    const res = await plannerApi.setStatus({ ids: [p.id], status: to, ...extra });
    const rej = res.rejected[0];
    if (rej) toast(tx(`pl_reason_${rej.reason}`, lang, undefined, rej.reason), 'error');
    else toast(t('pl_status_now', { status: t(`st_${to}`) }), 'ok');
  });
  const schedule = () => {
    if (!hasTime) { toast(t('pl_need_time'), 'error'); return; }
    return run(async (p) => {
      const res = await publishingApi.schedule(p.id);
      toast(t('pl_scheduled_result', { queued: res?.queued ?? 0, handedOff: res?.handedOff ?? 0 }), 'ok');
    });
  };

  const dis = busy || working;
  const canSchedule = !blocked && !(requireApproval && status === 'draft');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(status === 'draft' || status === 'changes_requested') && <B busy={dis} label={t('pl_submit_review')} onClick={() => setStatus('in_review')} primary={requireApproval} />}
      {status === 'in_review' && <>
        <B busy={dis} label={t('pl_approve')} onClick={() => setDialog('approve')} primary />
        <B busy={dis} label={t('pl_request_changes')} onClick={() => setDialog('changes')} />
      </>}
      {(status === 'draft' || status === 'approved') && (
        <B busy={dis} label={t('pl_schedule')} onClick={schedule} primary={!requireApproval || status === 'approved'} disabled={!canSchedule}
          title={blocked ? t('pl_errors_block') : requireApproval && status === 'draft' ? t('pl_reason_approval_required') : undefined} />
      )}
      {(status === 'failed' || status === 'partial') && <B busy={dis} label={t('pl_retry_post')} onClick={schedule} primary disabled={blocked} />}
      {status === 'scheduled' && <>
        <B busy={dis} label={t('pl_unschedule')} onClick={() => run(async (p) => { await publishingApi.unschedule(p.id); toast(t('pl_status_now', { status: t('st_draft') }), 'ok'); })} />
        <B busy={dis} label={t('pl_publish_now')} onClick={() => setDialog('publishNow')} disabled={blocked} />
      </>}
      {(status === 'in_review' || status === 'changes_requested' || status === 'approved') && <B busy={dis} label={t('pl_back_to_draft')} onClick={() => setStatus('draft')} />}
      {status === 'archived' && <B busy={dis} label={t('pl_restore')} onClick={() => setStatus('draft')} primary />}
      <span className="flex-1" />
      {post && <B busy={dis} label={t('pl_duplicate')} onClick={() => run(async (p) => { const d = await plannerApi.duplicate(p.id, null); toast(t('pl_duplicated', { ref: d.ref }), 'ok'); onDuplicated(d.id); })} />}
      {post && !['publishing', 'archived', 'scheduled'].includes(status) && <B busy={dis} label={t('pl_archive')} onClick={() => setStatus('archived')} />}
      {post && status !== 'publishing' && <button type="button" className="btn btn-sm btn-danger" disabled={dis} onClick={() => setDialog('delete')}>{t('delete')}</button>}

      <PromptDialog open={dialog === 'approve'} title={t('pl_approve')} label={t('pl_approver_name')} placeholder={t('pl_optional')} confirmLabel={t('pl_approve')}
        onClose={() => setDialog(null)} onSubmit={async (v) => { setDialog(null); await setStatus('approved', v ? { approver: v } : {}); }} />
      <PromptDialog open={dialog === 'changes'} title={t('pl_request_changes')} label={t('pl_change_note')} multiline required confirmLabel={t('pl_request_changes')}
        onClose={() => setDialog(null)} onSubmit={async (v) => { setDialog(null); await setStatus('changes_requested', { note: v }); }} />
      <ConfirmDialog open={dialog === 'publishNow'} title={t('pl_publish_now')} text={t('pl_publish_now_confirm')} confirmLabel={t('pl_publish_now')}
        onClose={() => setDialog(null)} onConfirm={() => run(async (p) => { await publishingApi.publishNow(p.id); toast(t('pl_publish_started'), 'ok'); })} />
      <ConfirmDialog open={dialog === 'delete'} danger title={t('delete')} text={status === 'scheduled' ? t('pl_delete_scheduled_confirm') : t('pl_delete_confirm')} confirmLabel={t('delete')}
        onClose={() => setDialog(null)} onConfirm={async () => {
          if (!post) return;
          try { await plannerApi.remove(post.id); toast(t('pl_deleted', { ref: post.ref }), 'ok'); onDeleted(); } catch (e) { toast(errorText(e), 'error'); }
        }} />
    </div>
  );
}
