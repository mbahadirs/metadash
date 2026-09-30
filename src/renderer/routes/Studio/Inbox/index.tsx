import { Link } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { InboxView } from '@/routes/Inbox/InboxView';

/**
 * Studio → Inbox (v1.5 chunk D, generalised in v2.0): the unified multi-platform inbox embedded in the studio, with a
 * link to the full /inbox page. Replies still go through the same composer (AI suggestions + explicit confirmation).
 */
export function InboxTab() {
  const t = useT();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2 max-w-3xl">
        <span>{t('ib_intro_v2')}</span>
        <Link className="text-accent" to="/inbox">{t('ib_open_inbox')}</Link>
      </div>
      <InboxView embedded />
    </div>
  );
}
