import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/tokens.css';
import { hydrateStore, useAppStore } from './store/app';
import { useSyncEvents } from './hooks/useSyncEvents';
import { Layout } from './components/Layout';
import { api, call } from './lib/api';
import type { SetupState } from './lib/types';
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

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 0, refetchOnWindowFocus: false } } });

function App() {
  useSyncEvents();
  const [ready, setReady] = useState(false);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const setDemo = useAppStore((s) => s.setDemo);
  useEffect(() => {
    (async () => {
      await hydrateStore();
      const s = await call<SetupState>(api.setup.getState()).catch(() => null);
      setSetup(s);
      setDemo(!!s?.demo);
      setReady(true);
    })();
  }, [setDemo]);
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
