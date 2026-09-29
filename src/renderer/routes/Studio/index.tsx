import { useNavigate, useSearchParams } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { useAiStatus } from '@/hooks/useAi';
import { useStudioCapabilities } from '@/hooks/useStudio';
import { EmptyState, Loading, Tabs } from '@/components/ui';
import { CapabilityBadges, SpendBadge } from './parts';
import { VoiceTab } from './Voice';
import { IdeasTab } from './Ideas';
import { InboxTab } from './Inbox';
import { ExperimentsTab } from './Experiments';
import { UsageView } from './Usage/UsageView';

type Tab = 'voice' | 'ideas' | 'inbox' | 'experiments' | 'usage';
const TABS: Tab[] = ['voice', 'ideas', 'inbox', 'experiments', 'usage'];

/** /studio?tab=… — AI studio shell (v1.5 chunk A). Tabs are owned by chunks B (voice), C (ideas), D (inbox, experiments). */
export function StudioPage() {
  const t = useT();
  const status = useAiStatus();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'voice';
  if (status.isLoading) return <Loading />;
  const enabled = status.data?.enabled === true;
  const setTab = (next: Tab) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', next); return n; }, { replace: true });
  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('studio_title')}</h1>
          <div className="text-sm text-ink-2 mt-0.5">{t('studio_intro')}</div>
        </div>
        {enabled && <StudioStatus />}
      </div>
      <Tabs tabs={TABS.map((id) => ({ id, label: t(`studio_tab_${id}`) }))} value={tab} onChange={setTab} />
      {tab === 'usage' ? <UsageView /> : enabled ? <TabBody tab={tab} /> : <AiOff />}
    </div>
  );
}

function StudioStatus() {
  const caps = useStudioCapabilities();
  if (!caps.data) return null;
  return <div className="flex flex-wrap items-center gap-1.5"><CapabilityBadges caps={caps.data} /><SpendBadge caps={caps.data} /></div>;
}

function TabBody({ tab }: { tab: Exclude<Tab, 'usage'> }) {
  if (tab === 'voice') return <VoiceTab />;
  if (tab === 'ideas') return <IdeasTab />;
  if (tab === 'inbox') return <InboxTab />;
  return <ExperimentsTab />;
}

function AiOff() {
  const t = useT();
  const navigate = useNavigate();
  return <EmptyState title={t('studio_off_title')} hint={t('studio_off_hint')} action={<button className="btn btn-primary" onClick={() => navigate('/settings', { state: { focus: 'ai' } })}>{t('studio_open_settings')}</button>} />;
}
