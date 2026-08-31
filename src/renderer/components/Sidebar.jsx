import React from 'react';
import { useNexForge, GUEST_LOCKED_SCREENS } from '../context/NexForgeContext.jsx';
import SafeNavIcon from './SafeNavIcon.jsx';
import PlayerAvatar, { GamerTag, displayTag } from './PlayerAvatar.jsx';

const PRIMARY_NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'matchmaking', label: 'Matchmaking' },
  { id: 'tournaments', label: 'Tournaments' },
];

const SECONDARY_NAV = [
  { id: 'friends', label: 'Friends' },
  { id: 'communities', label: 'Communities' },
  { id: 'clans', label: 'Clans' },
  { id: 'shop', label: 'Shop' },
  { id: 'profile', label: 'My Profile' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'squad', label: 'Squad Finder' },
];

const SYSTEM_NAV = [
  { id: 'settings', label: 'Settings' },
];

export default function Sidebar() {
  const {
    screen, setScreen, profile, guestMode, signOut, appVersion,
    unreadTotal,
  } = useNexForge();
  const tag = displayTag(profile) || profile?.gamer_tag || 'Player';
  const rank = guestMode ? 'No account' : (profile?.main_game || profile?.platform || 'PC');

  function renderNavItem(item) {
    const locked = guestMode && GUEST_LOCKED_SCREENS.includes(item.id);
    return (
      <div
        key={item.id}
        className={`nav-item nav-${item.id} ${screen === item.id ? 'active' : ''} ${locked ? 'locked-nav' : ''}`}
        onClick={() => setScreen(item.id)}
      >
        <span className="nav-icon"><SafeNavIcon id={item.id} /></span>
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
        <div className="sb-brand">
          <span className="sb-mark" aria-hidden="true">N</span>
          <div>
            Nex<span>Forge</span>
            {appVersion && <div className="sb-version">v{appVersion}</div>}
          </div>
          <span className="sb-live-pip" title="Online" />
        </div>
      </div>
      <nav className="sb-nav">
        <div className="sb-section-label">Play</div>
        {PRIMARY_NAV.map(renderNavItem)}
        <div className="sb-section-label">Social &amp; more</div>
        {SECONDARY_NAV.map(renderNavItem)}
        <div className="sb-section-label">System</div>
        {SYSTEM_NAV.map(renderNavItem)}
      </nav>
      <div className="sb-bottom">
        <div className="user-pill">
          {guestMode ? (
            <div className="avatar guest-av">—</div>
          ) : (
            <PlayerAvatar profile={profile} size={36} className="sb-avatar" />
          )}
          <div className="user-pill-meta">
            <div className="user-name">{guestMode ? tag : <GamerTag profile={profile} />}</div>
            <div className="user-rank">{rank}</div>
          </div>
        </div>
        <button type="button" className="signout-btn" onClick={signOut}>
          {guestMode ? 'Exit Guest' : 'Sign out'}
        </button>
      </div>
    </aside>
  );
}
