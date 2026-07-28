import React from 'react';
import { useNexForge, GUEST_LOCKED_SCREENS } from '../context/NexForgeContext.jsx';
import { mmrToRank } from '../lib/ranks.js';
import { NavIcon } from './icons.jsx';

const PRIMARY_NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'matchmaking', label: 'Matchmaking' },
  { id: 'tournaments', label: 'Tournaments' },
  { id: 'leaderboard', label: 'Leaderboard' },
];

const SECONDARY_NAV = [
  { id: 'friends', label: 'Friends' },
  { id: 'profile', label: 'My Profile' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'squad', label: 'Squad Finder' },
];

export default function Sidebar() {
  const { screen, setScreen, profile, guestMode, signOut, appVersion, checkForUpdates, unreadTotal } = useNexForge();
  const tag = profile?.gamer_tag || 'Player';
  const initials = tag.slice(0, 2).toUpperCase();
  const rank = guestMode ? 'No account' : mmrToRank(profile?.mmr ?? 1200);

  function renderNavItem(item) {
    const locked = guestMode && GUEST_LOCKED_SCREENS.includes(item.id);
    return (
      <div
        key={item.id}
        className={`nav-item ${screen === item.id ? 'active' : ''} ${locked ? 'locked-nav' : ''}`}
        onClick={() => setScreen(item.id)}
      >
        <span className="nav-icon"><NavIcon id={item.id} /></span>
        <span className="nav-label">{item.label}</span>
        {item.id === 'friends' && unreadTotal > 0 && (
          <span className="nav-unread">{unreadTotal > 99 ? '99+' : unreadTotal}</span>
        )}
      </div>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sb-logo">
        Nex<span>Forge</span>
        {appVersion && <div className="sb-version">v{appVersion}</div>}
      </div>
      <nav>
        {PRIMARY_NAV.map(renderNavItem)}
        <div className="nav-div" />
        {SECONDARY_NAV.map(renderNavItem)}
      </nav>
      <div className="sb-bottom">
        <div className="user-pill">
          <div
            className="avatar"
            style={guestMode ? { background: 'var(--panel)', border: '1px solid var(--border2)' } : undefined}
          >
            {guestMode ? '—' : initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="user-name">{tag}</div>
            <div className="user-rank">{rank}</div>
          </div>
        </div>
        <button className="signout-btn" onClick={signOut}>
          {guestMode ? 'Exit Guest' : 'Sign out'}
        </button>
        <button className="sb-update-btn" onClick={checkForUpdates}>
          Check for updates
        </button>
      </div>
    </aside>
  );
}
