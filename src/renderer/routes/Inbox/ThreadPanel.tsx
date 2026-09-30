import { useState, type Ref } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { PLATFORM_LABELS } from '@/lib/platforms';
import { useSession } from '@/hooks/useSession';
import { inbox, useInboxThread, INBOX_KEY, isForbidden } from '@/hooks/useInbox';
import { PostThumb } from '@/components/PostThumb';
import { PlatformIcon } from '@/components/PlatformBadge';
import { Icon } from '@/components/Icons';
import { EmptyState, ErrorState, Loading, Spinner } from '@/components/ui';
import type { InboxCapability, InboxOutboxRow, InboxStatus } from '@/lib/types';
import { NotesThread } from '@/components/NotesThread';
import { ReplyBox } from './ReplyBox';
import { fmtMinutes, sentimentClass, sentimentKey } from './format';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Selected comment: post, thread (replies oldest first), outbox attempts, workflow actions and the reply box. */
export function ThreadPanel({ commentId, capability, textareaRef, onNotice }: {
  commentId: string | null; capability: InboxCapability | undefined; textareaRef?: Ref<HTMLTextAreaElement>; onNotice: (msg: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const session = useSession();
  const thread = useInboxThread(commentId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');

  if (!commentId) return <EmptyState title={t('ix_pick')} hint={t('ix_pick_hint')} />;
  if (thread.isLoading) return <Loading />;
  if (thread.error) return <ErrorState error={thread.error} />;
  const data = thread.data;
  if (!data) return null;
  const root = data.root;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: [INBOX_KEY] });
    } catch (e) {
      setError(isForbidden(e) ? t('ix_read_only') : errText(e));
    } finally {
      setBusy(false);
    }
  };
  const setStatus = (status: InboxStatus) => run(() => inbox.setStatus({ commentIds: [root.commentId], status }));
  const closed = root.status === 'done' || root.status === 'ignored';

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <PostThumb mediaId={root.mediaId} thumbnailPath={root.post.thumb} mediaType={root.post.mediaType ?? 'IMAGE'} mediaProductType={root.post.mediaProductType ?? 'FEED'} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs text-ink-2">
            <PlatformIcon platform={root.platform} size={12} /> @{root.accountUsername} · {PLATFORM_LABELS[root.platform]}
            {(root.post.permalink || root.permalink) && (
              <button className="btn btn-ghost btn-sm px-1 ml-auto" onClick={() => api.system.openExternal((root.permalink ?? root.post.permalink)!)}>{t('ix_open_post')} <Icon.external /></button>
            )}
          </div>
          {root.post.caption && <div className="text-xs text-ink-2 line-clamp-2" title={root.post.caption}>{root.post.caption}</div>}
        </div>
      </div>

      <div className="panel p-3 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{root.username || t('ix_unknown_user')}</span>
          <span className="text-xs text-ink-2" title={fmtDateTime(root.createdAt)}>{fmtRelative(root.createdAt)}</span>
          {root.overdue && <span className="badge badge-neg">{t('ix_overdue')}</span>}
          {root.sentiment && <span className={`badge ${sentimentClass(root.sentiment)}`}>{t(sentimentKey(root.sentiment))}</span>}
          {root.isQuestion && root.sentiment !== 'question' && <span className="badge badge-muted">{t('ix_question')}</span>}
          {root.firstResponseAt && <span className="text-xs text-ink-2">{t('ix_first_response', { d: fmtMinutes(t, (root.firstResponseAt - root.createdAt) / 60_000) })}</span>}
        </div>
        <div className="text-sm whitespace-pre-wrap break-words select-text">{root.text}</div>
        {root.isHidden && <div className="text-xs text-warn">{t('ix_hidden_note')}</div>}
      </div>

      {data.replies.length > 0 && (
        <div className="space-y-1 pl-4 border-l border-line">
          {data.replies.map((r) => (
            <div key={r.commentId} className="text-sm">
              <span className={`font-medium ${r.isFromOwner ? 'text-accent' : ''}`}>{r.isFromOwner ? `@${root.accountUsername}` : r.username || t('ix_unknown_user')}</span>
              <span className="text-xs text-ink-2 ml-2">{fmtRelative(r.createdAt)}</span>
              <div className="whitespace-pre-wrap break-words select-text">{r.text}</div>
            </div>
          ))}
        </div>
      )}

      {data.outbox.filter((o) => o.status !== 'sent').map((o) => <OutboxLine key={o.id} row={o} disabled={busy || session.readOnly} onRetry={() => run(() => inbox.retry(o.id))} />)}

      <div className="flex flex-wrap items-center gap-2">
        {closed
          ? <button className="btn btn-sm" disabled={busy} onClick={() => setStatus('open')}>{t('ix_reopen')}</button>
          : <>
            <button className="btn btn-sm" disabled={busy} onClick={() => setStatus('done')} title="e">{t('ix_mark_done')}</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus('ignored')}>{t('ix_ignore')}</button>
          </>}
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void run(() => inbox.assign({ commentIds: [root.commentId], assignee: assignee.trim() || null })); }}>
          <input className="input w-32 h-7 text-xs" value={assignee} maxLength={80} placeholder={root.assignee ?? t('ix_assign_placeholder')} aria-label={t('ix_assignee')} onChange={(e) => setAssignee(e.target.value)} />
          <button className="btn btn-ghost btn-sm" disabled={busy} type="submit">{assignee.trim() ? t('ix_assign') : t('ix_unassign')}</button>
        </form>
        {capability?.hide && !session.readOnly && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => inbox.hide({ commentId: root.commentId, hidden: !root.isHidden }))}>{root.isHidden ? t('ix_unhide') : t('ix_hide')}</button>
        )}
        {busy && <Spinner size={12} />}
      </div>
      {error && <div className="text-xs text-neg select-text">{error}</div>}

      {!closed && <ReplyBox item={root} capability={capability} onNotice={onNotice} textareaRef={textareaRef} />}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-ink-2">{t('notes')}</summary>
        <div className="mt-2"><NotesThread entityType="comment" entityId={root.commentId} /></div>
      </details>
    </div>
  );
}

function OutboxLine({ row, onRetry, disabled }: { row: InboxOutboxRow; onRetry: () => void; disabled: boolean }) {
  const t = useT();
  return (
    <div className={`rounded border p-2 text-xs space-y-1 ${row.status === 'failed' ? 'border-neg' : 'border-line'}`}>
      <div className="flex items-center gap-2">
        <span className={`badge ${row.status === 'failed' ? 'badge-neg' : 'badge-muted'}`}>{t(row.status === 'failed' ? 'ix_out_failed' : 'ix_out_sending')}</span>
        <span className="text-ink-2">{fmtRelative(row.createdAt)}{row.attempts > 1 ? ` · ${t('ix_attempts', { n: row.attempts })}` : ''}</span>
        {row.status === 'failed' && <button className="btn btn-sm ml-auto" disabled={disabled} onClick={onRetry}>{t('ix_retry')}</button>}
      </div>
      <div className="whitespace-pre-wrap select-text">{row.body}</div>
      {row.error && <div className="text-neg select-text">{row.error}</div>}
    </div>
  );
}
