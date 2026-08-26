import React from 'react';
import { NexForgeProvider, useNexForge } from './context/NexForgeContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ToastStack from './components/ToastStack.jsx';
import Sidebar from './components/Sidebar.jsx';
import SafeNavIcon from './components/SafeNavIcon.jsx';
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
import NexPanionDock from './components/NexPanionDock.jsx';
import ClickBurst from './components/ClickBurst.jsx';
import MatchResultPrompt from './components/MatchResultPrompt.jsx';

const SCREEN_META = {
  dashboard: { title: 'Dashboard', badge: 'LIVE' },
  matchmaking: { title: 'Matchmaking', badge: 'FIND MATCH' },
  tournaments: { title: 'Tournaments', badge: 'OPEN' },
  leaderboard: { title: 'Leaderboard', badge: 'SEASON' },
  friends: { title: 'Friends', badge: 'SOCIAL' },
  communities: { title: 'Communities', badge: 'LOUNGES' },
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
        <div className="loading-ring" aria-hidden="true" />
        <div className="loading-logo">Nex<span>Forge</span></div>
        <div className="loading-bar"><div className="loading-fill" /></div>
        <div className="loading-boot">Igniting forge systems</div>
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
        <button type="button" className="offline-retry-btn" onClick={probeCloud}>
          Retry
        </button>
      </div>
      <div className="app">
        <Sidebar />
        <div className="main">
          <div className="topbar">
            <div className="topbar-title">
              <span className="topbar-icon"><SafeNavIcon id={screen} size={20} /></span>
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
            <ErrorBoundary key={screen}>
              <ScreenComponent />
            </ErrorBoundary>
          </div>
        </div>
      </div>
      <LockModal />
      <OnboardingModal />
      <WhatsNewModal />
      <MatchResultPrompt />
      <NexPanionDock />
      <ToastStack />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <NexForgeProvider>
        <VoiceCallProvider>
          <div className="ui-atmosphere" aria-hidden="true" />
          <div className="ui-grain" aria-hidden="true" />
          <div className="hud-frame" aria-hidden="true">
            <span className="hud-c hud-tl" />
            <span className="hud-c hud-tr" />
            <span className="hud-c hud-bl" />
            <span className="hud-c hud-br" />
          </div>
          <ClickBurst />
          <AppShell />
        </VoiceCallProvider>
      </NexForgeProvider>
    </ErrorBoundary>
  );
}
