/**
 * Root Application Component
 *
 * Sets up routing, layout wrapper, and global providers.
 * All pages are rendered within the Layout component which
 * provides the sidebar navigation and top header bar.
 *
 * TODO: Implementation steps:
 * 1. Set up BrowserRouter (or HashRouter for Electron)
 * 2. Define routes for all pages
 * 3. Wrap with Layout component
 * 4. Initialize connection on mount (auto-detect external config)
 * 5. Set up IPC event listeners for background updates
 */

import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useConnectionStore } from './stores/connection-store';

// Pages
import { Dashboard } from './pages/Dashboard';
import { MyDomains } from './pages/MyDomains';
import { BulkSearch } from './pages/BulkSearch';
import { SearchEngine } from './pages/SearchEngine';
import { Auctions } from './pages/Auctions';
import { Marketplace } from './pages/Marketplace';
import { Watchlist } from './pages/Watchlist';
import { History } from './pages/History';
import { Explore } from './pages/Explore';
import { BlockDetail } from './pages/BlockDetail';
import { NameDetail } from './pages/NameDetail';
import { Settings } from './pages/Settings';
import { Send } from './pages/Send';
import { Receive } from './pages/Receive';
import { Swap } from './pages/Swap';
import { SignMessage } from './pages/SignMessage';
import { VerifyMessage } from './pages/VerifyMessage';
import { WalletOnboardingModal } from './components/wallet/WalletOnboardingModal';
import { SetupWizard } from './components/setup/SetupWizard';
import { useSetupStore } from './stores/setup-store';

/** Routes that require both a running node and an explicit wallet login. */
function RequireSession() {
  const canAccess = useConnectionStore(
    (s) => s.connectionState === 'connected' && s.isLoggedIn,
  );
  return canAccess ? <Outlet /> : <Navigate to="/settings" replace />;
}

/** The app always opens on Settings until the user logs in. */
function HomeRedirect() {
  const canAccess = useConnectionStore(
    (s) => s.connectionState === 'connected' && s.isLoggedIn,
  );
  return <Navigate to={canAccess ? '/dashboard' : '/settings'} replace />;
}

/**
 * Root App component.
 *
 * Uses HashRouter (not BrowserRouter) because Electron loads files
 * from the filesystem, which doesn't support HTML5 history API.
 */
export function App() {
  const checkFirstRun = useSetupStore((state) => state.checkFirstRun);

  // Handess Wallet is GPLv3 free software; no license acceptance gate is
  // required. The license text is available in Settings → About & Legal.
  useEffect(() => {
    void checkFirstRun();
  }, [checkFirstRun]);

  // Subscribe to HSD process lifecycle events so the renderer knows
  // when the managed node crashes or errors out.
  useEffect(() => {
    if (!window.api?.on) return;

    const unsubStateChange = window.api.on.hsdStateChange((state: string) => {
      const s = useConnectionStore.getState();
      if (state === 'running') {
        s.setProcessStatus('running');
      } else if (state === 'stopped') {
        // Also clears wallet data and invalidates the login session.
        s.handleNodeStopped();
      } else if (state === 'error') {
        s.handleNodeError('HSD node crashed. Restart it from Settings.');
      } else if (state === 'starting') {
        s.setProcessStatus('starting');
      } else {
        s.setProcessStatus('stopped');
      }
    });

    const unsubError = window.api.on.hsdError((err: string) => {
      useConnectionStore.getState().handleNodeError(`HSD error: ${err}`);
    });

    return () => { unsubStateChange(); unsubError(); };
  }, []);

  return (
    <ErrorBoundary>
    <SetupWizard />
    <HashRouter>
      <Layout>
        <WalletOnboardingModal />
        <Routes>
          {/* App opens on Settings; only a logged-in session reaches Dashboard. */}
          <Route path="/" element={<HomeRedirect />} />

          <Route path="/settings" element={<Settings />} />

          {/* Every wallet/menu page requires a running node + login. */}
          <Route element={<RequireSession />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/domains" element={<MyDomains />} />
            <Route path="/search" element={<BulkSearch />} />
            <Route path="/search-engine" element={<SearchEngine />} />
            <Route path="/auctions" element={<Auctions />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/history" element={<History />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/explore/block/:height" element={<BlockDetail />} />
            <Route path="/explore/name/:name" element={<NameDetail />} />
            <Route path="/send" element={<Send />} />
            <Route path="/receive" element={<Receive />} />
            <Route path="/swap" element={<Swap />} />
            <Route path="/sign_message" element={<SignMessage />} />
            <Route path="/verify_message" element={<VerifyMessage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </Layout>
    </HashRouter>
    </ErrorBoundary>
  );
}
