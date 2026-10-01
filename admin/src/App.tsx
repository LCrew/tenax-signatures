import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './lib/api';
import { initEntra } from './lib/auth';
import { AppCtx, ToastProvider } from './lib/hooks';
import type { PublicConfig, SessionInfo } from './lib/types';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Login } from './pages/Login';
import { Setup } from './pages/Setup';
import { Overview } from './pages/Overview';
import { People } from './pages/People';
import { Person } from './pages/Person';
import { Designs } from './pages/Designs';
import { Companies } from './pages/Companies';
import { Mailboxes } from './pages/Mailboxes';
import { SettingsPage } from './pages/Settings';
import { ActivityPage } from './pages/Activity';
import { MySignature } from './pages/MySignature';

export function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const cfg = await api.get<PublicConfig>('/api/public/config');
      await initEntra(cfg.entra).catch(() => null);
      const s = await api.get<SessionInfo>('/api/auth/session').catch(() => null);
      setConfig(cfg);
      setSession(s);
    } catch {
      setFatal("The signature service isn't responding. Check that the container is running.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setSession(null);
    window.addEventListener('sig:unauthorized', onUnauthorized);
    return () => window.removeEventListener('sig:unauthorized', onUnauthorized);
  }, [refresh]);

  if (fatal) return <div className="main"><div className="callout danger">{fatal}</div></div>;
  if (!config) return <Loading what="Starting" />;

  const signedIn = !!session;
  const admin = session?.isAdmin;
  // First launch: the wizard runs until an admin marks setup finished.
  const inSetup = config.needsFirstAdmin || (signedIn && admin && !config.setupComplete);

  return (
    <AppCtx.Provider value={{ config, session, refresh }}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/setup/*" element={inSetup ? <Setup /> : <Navigate to="/" replace />} />
            <Route
              path="/login"
              element={config.needsFirstAdmin ? <Navigate to="/setup" replace /> : signedIn ? <Navigate to={admin ? '/' : '/me'} replace /> : <Login />}
            />
            {/* Self-service: anyone signed in with Microsoft. Admins also see it inside the console. */}
            <Route
              path="/me"
              element={!signedIn ? <Navigate to="/login" replace /> : session?.kind === 'local' ? <Navigate to="/" replace /> : <MySignature />}
            />
            <Route
              element={
                inSetup ? <Navigate to="/setup" replace /> : !signedIn ? <Navigate to="/login" replace /> : !admin ? <Navigate to="/me" replace /> : <Layout />
              }
            >
              <Route index element={<Overview />} />
              <Route path="people" element={<People />} />
              <Route path="people/:upn" element={<Person />} />
              <Route path="designs" element={<Designs />} />
              <Route path="designs/:company" element={<Designs />} />
              <Route path="companies" element={<Companies />} />
              <Route path="mailboxes" element={<Mailboxes />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="my-signature" element={<MySignature embedded />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AppCtx.Provider>
  );
}

