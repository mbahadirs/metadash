import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAccounts } from '@/hooks/queries';
import { EmptyState, ErrorState, Loading } from '@/components/ui';
import { PlatformIcon } from '@/components/PlatformBadge';
import { VoiceEditor } from './VoiceEditor';

/** Studio → Voice tab (v1.5 chunk B): pick a tracked account, then edit or derive its brand voice. */
export function VoiceTab() {
  const t = useT();
  const accounts = useAccounts({ onlyTracked: true });
  const [picked, setPicked] = useState<string | null>(null);
  if (accounts.isLoading) return <Loading />;
  if (accounts.error) return <ErrorState error={accounts.error} />;
  const list = accounts.data ?? [];
  if (!list.length) return <EmptyState title={t('sv_no_accounts')} />;
  const current = list.find((a) => a.igId === picked) ?? list[0]!;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={t('sv_account')}>
        {list.map((a) => (
          <button key={a.igId} type="button" role="tab" aria-selected={a.igId === current.igId} className={`chip ${a.igId === current.igId ? 'active' : ''}`} onClick={() => setPicked(a.igId)}>
            <PlatformIcon platform={a.platform} size={11} />@{a.username}
          </button>
        ))}
      </div>
      <VoiceEditor key={current.igId} accountId={current.igId} />
    </div>
  );
}
