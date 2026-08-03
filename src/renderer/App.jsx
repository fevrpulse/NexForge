import React from 'react';
import { NexForgeProvider, useNexForge } from './context/NexForgeContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ToastStack from './components/ToastStack.jsx';
import Sidebar from './components/Sidebar.jsx';
import { NavIcon } from './components/icons.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import LockModal from './components/LockModal.jsx';
import OnboardingModal from './components/OnboardingModal.jsx';
import WhatsNewModal from './components/WhatsNewModal.jsx';
import Dashboard from './screens/Dashboard.jsx';
import Matchmaking from './screens/Matchmaking.jsx';
import Tournaments from './screens/Tournaments.jsx';
import Leaderboard from './screens/Leaderboard.jsx';
import Profile from './screens/Profile.jsx';
import Analytics from './screens/Analytics.jsx';
import Squad from './screens/Squad.jsx';
import Friends from './screens/Friends.jsx';
import Shop from './screens/Shop.jsx';
import Clans from './screens/Clans.jsx';
import Communities from './screens/Communities.jsx';
import { VoiceCallProvider } from './components/VoiceCallOverlay.jsx';

const SCREEN_META = {
  dashboard: { title: 'Dashboard', badge: 'LIVE' },
  matchmaking: { title: 'Matchmaking', badge: 'FIND MATCH' },
  tournaments: { title: 'Tournaments', badge: 'OPEN' },
  leaderboard: { title: 'Leaderboard', badge: 'SEASON' },
  friends: { title: 'Friends', badge: 'SOCIAL' },
  communities: { title: 'Communities', badge: 'SERVERS' },
  clans: { title: 'Clans', badge: 'CREW' },
  shop: { title: 'Cosmetics Shop', badge: 'FORGE' },
  profile: { title: 'My Profile', badge: 'MY ACCOUNT' },
  analytics: { title: 'Analytics', badge: 'STATS' },
  squad: { title: 'Squad Finder', badge: 'FIND TEAM' },
};

const SCREEN_COMPONENTS = {
  dashboard: Dashboard,
  matchmaking: Matchmaking,
  tournaments: Tournaments,
  leaderboard: Leaderboard,
  friends: Friends,
  communities: Communities,
  clans: Clans,
  shop: Shop,
  profile: Profile,
  analytics: Analytics,
  squad: Squad,
};

function AppShell() {
  const { loading, user, guestMode, screen, cloudOffline, cloudReason, probeCloud, createAccount, appVersion } = useNexForge();

  if (loading) {
    return (
      <div className="loading-center">
        <div className="loading-logo">Nex<span>Forge</span></div>
      </div>
    );
  }

  if (!user && !guestMode) {
    return (
      <>
        <AuthScreen />
        <ToastStack />
      </>
    );
  }

  const meta = SCREEN_META[screen] || { title: screen, badge: '' };
  const ScreenComponent = SCREEN_COMPONENTS[screen] || Dashboard;

  return (
    <div id="app-screen" className="show">
      {guestMode && (
        <div className="guest-banner">
          <span><b>Guest Mode</b> — Stats not saved · Limited access</span>
          <button onClick={createAccount}>Create Account</button>
        </div>
      )}
      <div className={`offline-banner ${cloudOffline ? 'show' : ''}`}>
        <span>
          <b>Local-only mode</b> — Cloud sync unavailable.
          {cloudReason ? ` (${cloudReason})` : ' Duels/tournaments may not sync until Supabase is reachable.'}
        </span>
        <button
          style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #FF8C42', background: 'transparent', color: '#FF8C42', fontFamily: 'var(--font)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          onClick={probeCloud}
        >
          Retry
        </button>
      </div>
      <div className="app">
        <Sidebar />
        <div className="main">
          <div className="topbar">
            <div className="topbar-title">
              <span className="topbar-icon"><NavIcon id={screen} size={20} /></span>
              {meta.title}
            </div>
            <div className="topbar-right">
              {appVersion && (
                <span className="badge badge-muted" title="App version">v{appVersion}</span>
              )}
              <span className="badge badge-neon">{meta.badge}</span>
            </div>
          </div>
          <div className="content">
            <ScreenComponent />
          </div>
        </div>
      </div>
      <LockModal />
      <OnboardingModal />
      <WhatsNewModal />
      <ToastStack />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <NexForgeProvider>
        <VoiceCallProvider>
          <AppShell />
        </VoiceCallProvider>
      </NexForgeProvider>
    </ErrorBoundary>
  );
}
