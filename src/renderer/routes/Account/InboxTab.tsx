import { INBOX_READY } from '@/routes/Inbox/feature';
import { InboxView } from '@/routes/Inbox/InboxView';

/**
 * Account page "Inbox" tab (v2.0 chunk D): the unified inbox pinned to this account. The Account page shows the tab
 * only when ACCOUNT_INBOX_TAB is true and the platform's capabilities.inbox is true.
 */
export const ACCOUNT_INBOX_TAB = INBOX_READY;

export function AccountInboxTab({ igId }: { igId: string }) {
  return <InboxView embedded accountId={igId} />;
}
