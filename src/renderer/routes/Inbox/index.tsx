import { Navigate } from 'react-router-dom';
import { INBOX_READY } from './feature';

/**
 * /inbox — the multi-platform unified inbox (v2.0 chunk D). PLACEHOLDER from chunk B: until D sets INBOX_READY it
 * forwards to the v1.5 Studio inbox tab, which D generalises (see v20-contract.md "D reuses v1.5").
 */
export function InboxPage() {
  if (!INBOX_READY) return <Navigate to="/studio?tab=inbox" replace />;
  return null;
}

/** Overdue badge for the nav item (D): number of overdue threads, or null to hide. */
export function useInboxBadge(): number | null {
  return null;
}
