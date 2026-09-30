import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { fmtNum } from '@/lib/format';
import { useAccounts } from '@/hooks/queries';
import { useSession } from '@/hooks/useSession';
import { useStudioCapabilities } from '@/hooks/useStudio';
import { inbox, useInboxAutoRefresh, useInboxCapabilities, useInboxList, INBOX_KEY, isForbidden } from '@/hooks/useInbox';
import { EmptyState, ErrorState, Loading, Modal, Spinner } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { DEFAULT_CAPABILITIES } from '@/lib/platforms';
import type { InboxRow, Platform } from '@/lib/types';
import { Filters, type InboxFilters } from './Filters';
import { InboxList } from './InboxList';
import { ThreadPanel } from './ThreadPanel';
import type { ClassifyPreview } from '@/hooks/useInbox';

const PAGE = 50;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * The multi-platform inbox: filters, virtualised list and the thread panel side by side.
 * Keyboard: j / k next / previous, e mark done, r focus the reply box. `accountId` pins it to one account (Account
 * page tab); `embedded` uses a shorter list (Studio tab, Account tab).
 */
export function InboxView({ embedded = false, accountId }: { embedded?: boolean; accountId?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const session = useSession();
  const accountsQ = useAccounts();
  const capsQ = useInboxCapabilities();
  const ai = useStudioCapabilities();
  useInboxAutoRefresh();
  const [filters, setFilters] = useState<InboxFilters>({ status: 'open', sort: 'newest', accountIds: accountId ? [accountId] : undefined });
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const list = useInboxList({ ...filters, limit: PAGE });
  const items = useMemo<InboxRow[]>(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data]);
  const counts = list.data?.pages[0]?.counts;
  const inboxAccounts = useMemo(() => (accountsQ.data ?? []).filter((a) => DEFAULT_CAPABILITIES[a.platform]?.inbox), [accountsQ.data]);
  const platforms = useMemo(() => [...new Set(inboxAccounts.map((a) => a.platform))] as Platform[], [inboxAccounts]);
  const assignees = useMemo(() => [...new Set(items.map((i) => i.assignee).filter((a): a is string => !!a))].sort(), [items]);
  const capByAccount = useMemo(() => new Map((capsQ.data ?? []).map((c) => [c.accountId, c])), [capsQ.data]);
  const current = items.find((i) => i.commentId === selected) ?? null;

  useEffect(() => {
    if (!selected && items.length && !embedded) setSelected(items[0].commentId);
  }, [items, selected, embedded]);

  const move = useCallback((delta: number) => {
    if (!items.length) return;
    const idx = items.findIndex((i) => i.commentId === selected);
    const next = items[Math.min(items.length - 1, Math.max(0, (idx < 0 ? 0 : idx + delta)))];
    setSelected(next.commentId);
  }, [items, selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === 'j') { e.preventDefault(); move(1); }
      else if (e.key === 'k') { e.preventDefault(); move(-1); }
      else if (e.key === 'r' && replyRef.current) { e.preventDefault(); replyRef.current.focus(); }
      else if (e.key === 'e' && selected) {
        e.preventDefault();
        const idx = items.findIndex((i) => i.commentId === selected);
        const next = items[idx + 1]?.commentId ?? items[idx - 1]?.commentId ?? null;
        inbox.setStatus({ commentIds: [selected], status: 'done' })
          .then(() => { setSelected(next); return qc.invalidateQueries({ queryKey: [INBOX_KEY] }); })
          .catch((err) => setNotice(isForbidden(err) ? t('ix_read_only') : errText(err)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, selected, items, qc, t]);

  const refresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const res = await inbox.refresh({ accountIds: accountId ? [accountId] : undefined });
      setNotice(res.demo ? t('ix_refresh_demo') : [t('ix_refreshed', { n: fmtNum(res.fetched) }), res.errors ? t('ix_refresh_errors', { n: fmtNum(res.errors) }) : null].filter(Boolean).join(' · '));
      await qc.invalidateQueries({ queryKey: [INBOX_KEY] });
    } catch (e) {
      setNotice(isForbidden(e) ? t('ix_read_only') : errText(e));
    } finally {
      setRefreshing(false);
    }
  };

  const listHeight = embedded ? 520 : 'calc(100vh - 270px)';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Filters value={filters} onChange={(f) => { setFilters(f); setSelected(null); }} counts={counts} accounts={inboxAccounts} platforms={platforms} assignees={assignees} lockAccount={!!accountId} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" disabled={refreshing || session.readOnly} onClick={refresh} title={session.readOnly ? t('ix_read_only') : undefined}>
          {refreshing ? <Spinner size={12} /> : <Icon.refresh />}{t('ix_refresh')}
        </button>
        {ai.data?.enabled && <button className="btn btn-ghost btn-sm" onClick={() => setClassifyOpen(true)}>{t('ix_classify')}</button>}
        <span className="text-xs text-ink-2">{t('ix_keys_hint')}</span>
        {notice && <span className="text-xs text-ink-2 select-text">{notice}</span>}
      </div>
      {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} /> : !items.length ? (
        <EmptyState title={t('ix_empty')} hint={t('ix_empty_hint')} />
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(260px, 2fr) minmax(320px, 3fr)' }}>
          <InboxList items={items} selectedId={selected} onSelect={setSelected} hasMore={!!list.hasNextPage} loadingMore={list.isFetchingNextPage}
            onLoadMore={() => { void list.fetchNextPage(); }} height={listHeight} />
          <div className="panel p-3 overflow-auto" style={{ height: listHeight }}>
            <ThreadPanel commentId={selected} capability={current ? capByAccount.get(current.accountId) : undefined} textareaRef={replyRef} onNotice={setNotice} />
          </div>
        </div>
      )}
      <ClassifyDialog open={classifyOpen} onClose={() => setClassifyOpen(false)} onDone={(n) => { setNotice(t('ix_classified', { n: fmtNum(n) })); void qc.invalidateQueries({ queryKey: [INBOX_KEY] }); }} />
    </div>
  );
}

/** Shows what will be sent (count, characters, estimate) before classifying unclassified comments with AI. */
function ClassifyDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (n: number) => void }) {
  const t = useT();
  const [preview, setPreview] = useState<ClassifyPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError(null);
    inbox.classifyPreview({ unclassified: true }).then(setPreview).catch((e) => setError(errText(e)));
  }, [open]);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await inbox.classify({ unclassified: true });
      onDone(res.classified);
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={t('ix_classify')} width={480}>
      <div className="space-y-3 text-sm">
        <div className="text-ink-2">{t('ix_classify_intro')}</div>
        {!preview && !error && <Spinner size={12} />}
        {preview && (
          <div className="rounded border border-line p-2 text-xs space-y-1">
            <div>{t('ix_classify_count', { n: fmtNum(preview.total), b: fmtNum(preview.batches) })}</div>
            <div className="num">{t('ix_classify_est', { n: fmtNum(preview.estInputTokens) })}</div>
          </div>
        )}
        {error && <div className="text-xs text-neg select-text">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn" disabled={busy} onClick={onClose}>{t('ix_cancel')}</button>
          <button className="btn btn-primary" disabled={busy || !preview?.total} onClick={run}>{busy ? <Spinner size={12} /> : null}{t('ix_classify_run')}</button>
        </div>
      </div>
    </Modal>
  );
}
