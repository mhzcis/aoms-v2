import { useMemo, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Alert, Box, CircularProgress, CssBaseline, ThemeProvider } from '@mui/material';
import { makeTheme } from './theme';
import { AomsProvider, useAoms } from './context/AomsContext';
import { isConfigured } from './config';
import AppShell from './components/AppShell';
import { ErrorBoundary } from './components/Common';
import Login from './pages/Login';
import SetupRequired from './pages/SetupRequired';
import AomsDashboard from './pages/AomsDashboard';
import EntityPage from './pages/EntityPage';
import NotFound from './pages/NotFound';

const AOMS_ROUTES = [
  'categories',
  'assets',
  'operators',
  'operation_logs',
  'fuel_transactions',
  'chlorine_transactions',
  'reports',
  'search',
  'timeline_events',
  'settings',
  'users',
  'backup',
];

function Gate({ mode, setMode }) {
  const { session, loading, error } = useAoms();
  if (!isConfigured()) return <SetupRequired />;
  if (loading) {
    return (
      <Box sx={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!session) return <Login />;

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell mode={mode} setMode={setMode} />}>
          <Route index element={<AomsDashboard />} />
          {AOMS_ROUTES.map(x => (
            <Route key={x} path={x} element={<EntityPage key={x} type={x} />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>

    </HashRouter>
  );
}

export default function App() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem('theme') || 'light';
    } catch {
      return 'light';
    }
  });
  const theme = useMemo(() => makeTheme(mode), [mode]);

  const changeMode = nextMode => {
    setMode(nextMode);
    try {
      localStorage.setItem('theme', nextMode);
    } catch {}
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <AomsProvider>
          <Gate mode={mode} setMode={changeMode} />
        </AomsProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
