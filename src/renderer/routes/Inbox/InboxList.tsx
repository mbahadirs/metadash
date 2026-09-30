import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useT } from '@/lib/i18n';
import { fmtRelative } from '@/lib/format';
import { PlatformIcon } from '@/components/PlatformBadge';
import { Spinner } from '@/components/ui';
import type { InboxRow } from '@/lib/types';
import { sentimentClass, sentimentKey } from './format';

const ROW_HEIGHT = 84;

/** Virtualised comment list (@tanstack/react-virtual). Comment text is rendered as plain text only. */
export function InboxList({ items, selectedId, onSelect, hasMore, loadingMore, onLoadMore, height }: {
  items: InboxRow[]; selectedId: string | null; onSelect: (id: string) => void; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void; height: number | string;
}) {
  const t = useT();
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_HEIGHT, overscan: 8 });
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? -1;

  useEffect(() => {
    if (hasMore && !loadingMore && lastIndex >= items.length - 5) onLoadMore();
  }, [lastIndex, items.length, hasMore, loadingMore, onLoadMore]);

  useEffect(() => {
    const idx = items.findIndex((i) => i.commentId === selectedId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' });
  }, [selectedId, items, virtualizer]);

  return (
    <div ref={parentRef} className="overflow-auto panel" style={{ height }} role="listbox" aria-label={t('ix_list')}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map((v) => {
          const it = items[v.index];
          const active = it.commentId === selectedId;
          return (
            <div
              key={it.commentId}
              role="option"
              aria-selected={active}
              tabIndex={-1}
              onClick={() => onSelect(it.commentId)}
              className={`absolute left-0 right-0 px-3 py-2 border-b border-line cursor-pointer ${active ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
              style={{ top: v.start, height: ROW_HEIGHT }}
            >
              <div className="flex items-center gap-1.5 text-xs text-ink-2 min-w-0">
                <PlatformIcon platform={it.platform} size={12} />
                <span className="truncate">@{it.accountUsername}</span>
                <span className="ml-auto flex-none">{fmtRelative(it.createdAt)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm min-w-0">
                <span className="font-medium truncate">{it.username || t('ix_unknown_user')}</span>
                {it.overdue && <span className="badge badge-neg">{t('ix_overdue')}</span>}
                {it.status === 'replied' && <span className="badge badge-pos">{t('ix_status_replied')}</span>}
                {(it.status === 'done' || it.status === 'ignored') && <span className="badge badge-muted">{t(it.status === 'done' ? 'ix_status_done' : 'ix_ignored')}</span>}
                {it.isQuestion && <span className="badge badge-muted" title={t('ix_question')}>?</span>}
                {it.sentiment && <span className={`badge ${sentimentClass(it.sentiment)}`}>{t(sentimentKey(it.sentiment))}</span>}
                {it.assignee && <span className="badge badge-muted truncate">{it.assignee}</span>}
              </div>
              <div className="text-xs text-ink-2 line-clamp-2 break-words">{it.isHidden ? `(${t('ix_hidden')}) ` : ''}{it.text}</div>
            </div>
          );
        })}
      </div>
      {loadingMore && <div className="flex justify-center p-2"><Spinner size={12} /></div>}
    </div>
  );
}
