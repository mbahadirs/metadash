import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { fmtNum, fmtRelative } from '@/lib/format';
import { useAccounts } from '@/hooks/queries';
import { studio, useStudioCapabilities, useStudioChanged, STUDIO_KEY } from '@/hooks/useStudio';
import { Avatar, EmptyState, ErrorState, Loading, Spinner, Toggle } from '@/components/ui';
import { PostThumb } from '@/components/PostThumb';
import { Icon } from '@/components/Icons';
import type { StudioCapabilities } from '@/lib/types';
import { ReplyComposer } from './ReplyComposer';
import type { InboxRow } from './types';

const PAGE = 50;

/** Studio → Inbox: unanswered Instagram comments per account, AI reply suggestions, confirmed sends (v1.5 chunk D). */
export function InboxTab() {
  const t = useT();
  const qc = useQueryClient();
  const accountsQ = useAccounts();
  const caps = useStudioCapabilities();
  const [accountId, setAccountId] = useState('');
  const [showAnswered, setShowAnswered] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const igAccounts = useMemo(() => (accountsQ.data ?? []).filter((a) => a.platform === 'instagram'), [accountsQ.data]);
  const accountIds = accountId ? [accountId] : undefined;
  const inbox = useQuery<InboxRow[]>({
    queryKey: [STUDIO_KEY, 'inbox', accountId, showAnswered, limit],
    queryFn: () => studio.replies.inbox({ accountIds, onlyUnanswered: !showAnswered, limit }) as Promise<InboxRow[]>,
  });
  useStudioChanged(() => { void qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'inbox'] }); }, 'inbox');

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    setNotice(null);
    try {
      const res = await studio.call<{ fetched: number; errors: number; demo?: boolean }>('replies:refresh', { accountIds: accountIds ?? igAccounts.map((a) => a.igId) });
      setNotice(res.demo ? t('ib_refresh_demo') : [t('ib_refreshed', { n: fmtNum(res.fetched) }), res.errors ? t('ib_refresh_errors', { n: fmtNum(res.errors) }) : null].filter(Boolean).join(' · '));
      await qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'inbox'] });
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const groups = useMemo(() => {
    const map = new Map<string, InboxRow[]>();
    for (const it of inbox.data ?? []) map.set(it.accountId, [...(map.get(it.accountId) ?? []), it]);
    return [...map.entries()];
  }, [inbox.data]);
  const accountById = useMemo(() => new Map((accountsQ.data ?? []).map((a) => [a.igId, a])), [accountsQ.data]);

  return (
    <div className="space-y-4">
      <div className="text-sm text-ink-2 max-w-3xl">{t('ib_intro')}</div>
      <div className="flex flex-wrap items-center gap-3">
        <select className="input w-56" value={accountId} onChange={(e) => { setAccountId(e.target.value); setLimit(PAGE); }} aria-label={t('ib_all_accounts')}>
          <option value="">{t('ib_all_accounts')}</option>
          {igAccounts.map((a) => <option key={a.igId} value={a.igId}>@{a.username}</option>)}
        </select>
        <Toggle checked={showAnswered} onChange={(v) => { setShowAnswered(v); setLimit(PAGE); }} label={t('ib_show_answered')} />
        <button className="btn btn-sm" disabled={refreshing || !igAccounts.length} onClick={refresh}>
          {refreshing ? <Spinner size={12} /> : <Icon.refresh />}{t('ib_refresh')}
        </button>
        {notice && <span className="text-xs text-ink-2">{notice}</span>}
        {refreshError && <span className="text-xs text-neg">{refreshError}</span>}
      </div>
      {inbox.isLoading ? <Loading /> : inbox.error ? <ErrorState error={inbox.error} /> : !groups.length ? (
        <EmptyState title={t('ib_empty')} hint={t('ib_empty_hint')} />
      ) : (
        <div className="space-y-5">
          {groups.map(([accId, items]) => {
            const acc = accountById.get(accId);
            const waiting = items.filter((i) => !i.answered && i.reply?.status !== 'sent' && i.reply?.status !== 'dismissed').length;
            return (
              <section key={accId} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Avatar username={acc?.username ?? items[0].accountUsername ?? accId} url={acc?.profilePicUrl} color={acc?.color} size={24} platform="instagram" />
                  <div className="font-medium">@{acc?.username ?? items[0].accountUsername ?? accId}</div>
                  {waiting > 0 && <span className="badge badge-warn">{t('ib_count', { n: fmtNum(waiting) })}</span>}
                </div>
                {items.map((item) => <CommentCard key={item.commentId} item={item} caps={caps.data} onNotice={setNotice} />)}
              </section>
            );
          })}
          {(inbox.data?.length ?? 0) >= limit && (
            <div className="flex justify-center"><button className="btn btn-sm" onClick={() => setLimit((l) => l + PAGE)}>{t('ib_load_more')}</button></div>
          )}
        </div>
      )}
    </div>
  );
}

function CommentCard({ item, caps, onNotice }: { item: InboxRow; caps: StudioCapabilities | undefined; onNotice: (msg: string) => void }) {
  const t = useT();
  const closed = item.answered || item.reply?.status === 'sent' || item.reply?.status === 'dismissed';
  return (
    <div className="panel p-3 flex gap-3">
      <PostThumb mediaId={item.mediaId} thumbnailPath={item.thumb} mediaType={item.mediaType ?? 'IMAGE'} mediaProductType={item.mediaProductType ?? 'FEED'} size={48} />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">@{item.username}</span>
          <span className="text-xs text-ink-2">{fmtRelative(item.createdAt)}</span>
          {item.likeCount > 0 && <span className="text-xs text-ink-2 num">♥ {fmtNum(item.likeCount)}</span>}
          {closed && <span className="badge badge-pos">{t('ib_answered')}</span>}
          {item.permalink && (
            <button className="btn btn-ghost btn-sm px-1 ml-auto" onClick={() => api.system.openExternal(item.permalink!)}>{t('ib_open_post')} <Icon.external /></button>
          )}
        </div>
        <div className="text-sm whitespace-pre-wrap break-words select-text">{item.text}</div>
        {item.caption && <div className="text-xs text-ink-2 truncate" title={item.caption}>{item.caption}</div>}
        {!closed && <ReplyComposer item={item} caps={caps} onDone={onNotice} />}
      </div>
    </div>
  );
}
