import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { Tabs } from '@/components/ui';
import { useInboxCounts, useInboxUpdated, INBOX_KEY } from '@/hooks/useInbox';
import { INBOX_READY } from './feature';
import { InboxView } from './InboxView';
import { SlaPanel } from './SlaPanel';
import { useStaffSession } from '@/hooks/useSession';

export { InboxView } from './InboxView';

type Tab = 'comments' | 'sla';

/** /inbox — the multi-platform unified inbox (v2.0 chunk D): comments + response-time (SLA) tab. */
export function InboxPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('comments');
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('nav_inbox')}</h1>
          <div className="text-sm text-ink-2 max-w-3xl">{t('ix_intro')}</div>
        </div>
      </div>
      <Tabs tabs={[{ id: 'comments' as Tab, label: t('ix_tab_comments') }, { id: 'sla' as Tab, label: t('ix_tab_sla') }]} value={tab} onChange={setTab} />
      {tab === 'comments' ? <InboxView /> : <SlaPanel />}
    </div>
  );
}

/** Overdue badge for the nav item: number of overdue comments, or null to hide. */
export function useInboxBadge(): number | null {
  const qc = useQueryClient();
  const staff = useStaffSession(); // inbox:counts is outside the client-view allowlist
  const counts = useInboxCounts(INBOX_READY && staff);
  useInboxUpdated(() => { void qc.invalidateQueries({ queryKey: [INBOX_KEY, 'counts'] }); });
  const n = counts.data?.overdue ?? 0;
  return n > 0 ? n : null;
}
