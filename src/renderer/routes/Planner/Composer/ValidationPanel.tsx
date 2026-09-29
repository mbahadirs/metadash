import { Link } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { Spinner } from '@/components/ui';
import type { Account, Issue } from '@/lib/types';
import { IssueCount, IssueList } from '../parts';
import { hasErrors } from '../lib';

/** Result of planner:validate for the unsaved composer state (debounced by the drawer). Errors block scheduling. */
export function ValidationPanel({ issues, loading, failed, accounts }: { issues: Issue[]; loading: boolean; failed: string | null; accounts: Map<string, Account> }) {
  const t = useT();
  const needsSettings = issues.some((i) => i.field === 'mediaHost' || i.code === 'v_missing_scope');
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <IssueCount issues={issues} />
        {loading && <Spinner size={12} />}
        {hasErrors(issues) && <span className="text-xs text-ink-2">{t('pl_errors_block')}</span>}
      </div>
      {failed && <div className="text-xs text-neg">{failed}</div>}
      <IssueList issues={issues} accounts={accounts} empty={<div className="text-xs text-ink-2">{t('pl_no_issues')}</div>} />
      {needsSettings && <Link to="/settings" className="text-xs">{t('pl_open_publishing_settings')}</Link>}
    </div>
  );
}
