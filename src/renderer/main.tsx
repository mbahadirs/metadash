import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/tokens.css';
import { hydrateStore, useAppStore } from './store/app';
import { useSyncEvents } from './hooks/useSyncEvents';
import { useNavigateEvents } from './hooks/useNavigateEvents';
import { Layout } from './components/Layout';
import { useSetupState } from './hooks/queries';
import { SetupPage } from './routes/Setup';
import { OverviewPage } from './routes/Overview';
import { AccountPage } from './routes/Account';
import { ComparePage } from './routes/Compare';
import { ContentPage } from './routes/Content';
import { AdsPage } from './routes/Ads';
import { CompetitorsPage } from './routes/Competitors';
import { ReportsPage } from './routes/Reports';
import { PresentationPage, PresentationRun } from './routes/Presentation';
import { SettingsPage } from './routes/Settings';
import { AskPage } from './routes/Ask';
import { PlannerPage } from './routes/Planner';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 0, refetchOnWindowFocus: false } } });

function App() {
  useSyncEvents();
  useNavigateEvents();
  const [hydrated, setHydrated] = useState(false);
  // Setup state comes from the query cache so finishing setup or loading demo data (invalidateQueries) re-routes immediately.
  const setupQ = useSetupState();
  const setup = setupQ.data ?? null;
  const setDemo = useAppStore((s) => s.setDemo);
  useEffect(() => { hydrateStore().finally(() => setHydrated(true)); }, []);
  useEffect(() => { if (setupQ.data) setDemo(!!setupQ.data.demo); }, [setupQ.data, setDemo]);
  const ready = hydrated && !setupQ.isLoading;
  if (!ready) return <div className="h-full flex items-center justify-center text-ink-2">MetaDash…</div>;
  const needsSetup = !setup?.complete;
  return (
    <div className="h-full" data-app-ready>
      <Routes>
        <Route path="/setup/*" element={<SetupPage />} />
        <Route path="/presentation/run" element={<PresentationRun />} />
        <Route element={<Layout />}>
          <Route path="/" element={needsSetup ? <Navigate to="/setup" replace /> : <OverviewPage />} />
          <Route path="/account/:igId" element={<AccountPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/content" element={<ContentPage />} />
          <Route path="/ads" element={<AdsPage />} />
          <Route path="/competitors" element={<CompetitorsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/presentation" element={<PresentationPage />} />
          <Route path="/planner" element={<PlannerPage />} />
          <Route path="/ask" element={<AskPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter><App /></HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
