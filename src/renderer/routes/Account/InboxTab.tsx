import { INBOX_READY } from '@/routes/Inbox/feature';

/**
 * Account page "Inbox" tab — STUB (v2.0 chunk B). Chunk D owns this file. The Account page shows the tab only when
 * ACCOUNT_INBOX_TAB is true and the platform's capabilities.inbox is true.
 */
export const ACCOUNT_INBOX_TAB = INBOX_READY;

export function AccountInboxTab({ igId }: { igId: string }) {
  void igId;
  return null;
}
