import { useNavigate } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { PLATFORM_LABELS } from '@/lib/platforms';
import { useSession } from '@/hooks/useSession';
import { useStudioCapabilities } from '@/hooks/useStudio';
import { inbox } from '@/hooks/useInbox';
import { ReplyComposer } from '@/routes/Studio/Inbox/ReplyComposer';
import type { InboxCapability, InboxRow } from '@/lib/types';
import type { Ref } from 'react';

/**
 * Reply editor for one top-level comment: the v1.5 composer (AI suggestions, explicit confirmation) sending through
 * inbox:reply with the platform's character limit. Disabled with a "missing permission — how to enable" hint when the
 * adapter cannot reply for this account, and in a read-only team workspace.
 */
export function ReplyBox({ item, capability, onNotice, textareaRef }: {
  item: InboxRow; capability: InboxCapability | undefined; onNotice: (msg: string) => void; textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  const t = useT();
  const navigate = useNavigate();
  const session = useSession();
  const caps = useStudioCapabilities();
  if (session.readOnly) return <div className="text-xs text-ink-2">{t('ix_read_only')}</div>;
  if (capability && !capability.reply) {
    return (
      <div className="rounded border border-line p-2 text-xs space-y-1">
        <div className="text-warn">{capability.missingScopes.length ? t('ix_missing_scope', { scopes: capability.missingScopes.join(', ') }) : t('ix_reply_unavailable', { platform: PLATFORM_LABELS[item.platform] })}</div>
        {capability.missingScopes.length > 0 && <button className="btn btn-ghost btn-sm px-1" onClick={() => navigate('/settings#connections')}>{t('ix_how_to_enable')}</button>}
      </div>
    );
  }
  return (
    <ReplyComposer
      key={item.commentId}
      item={item}
      caps={caps.data}
      onDone={onNotice}
      options={{
        maxLength: capability?.maxReplyLength ?? undefined,
        platformLabel: PLATFORM_LABELS[item.platform],
        textareaRef,
        send: async (body) => {
          const row = await inbox.reply({ commentId: item.commentId, body, confirmed: true });
          return { demo: String(row.remoteId ?? '').startsWith('demo-') };
        },
        dismiss: () => inbox.setStatus({ commentIds: [item.commentId], status: 'done' }),
        suggest: (p) => inbox.suggest(p),
      }}
    />
  );
}
