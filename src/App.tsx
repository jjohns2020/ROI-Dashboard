import { useCallback, useMemo, useState } from 'react';
import { ExportModal } from './components/export/ExportModal';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { sampleDataSource, type DataSource } from './data/dataSource';
import { clearSession, loadSession, saveSession, type Session } from './lib/auth';
import { DashboardProvider } from './state/DashboardContext';
import { Login } from './views/Login';
import { ViewRouter } from './views/ViewRouter';

export function App({ dataSource = sampleDataSource }: { dataSource?: DataSource }) {
  const dataset = useMemo(() => dataSource.load(), [dataSource]);
  const [session, setSession] = useState<Session | null>(() => loadSession(Object.keys(dataset.clients)));

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  if (!session) {
    return (
      <Login
        clients={dataset.clients}
        onSignedIn={(next) => {
          saveSession(next);
          setSession(next);
        }}
      />
    );
  }

  return (
    <DashboardProvider key={`${session.role}:${session.clientKey ?? ''}`} dataset={dataset} session={session} onSignOut={signOut}>
      <Header />
      <div className="layout">
        <Sidebar />
        <main id="main">
          <ViewRouter />
        </main>
      </div>
      <ExportModal />
    </DashboardProvider>
  );
}
