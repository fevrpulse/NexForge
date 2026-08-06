import React from 'react';
import { useNexForge, GUEST_LOCKED_SCREENS } from '../context/NexForgeContext.jsx';
import { mmrToRank, mmrToSkillTag } from '../lib/ranks.js';
import SafeNavIcon from './SafeNavIcon.jsx';
import PlayerAvatar, { GamerTag, displayTag } from './PlayerAvatar.jsx';
import { COMPANION_URL } from '../lib/companion.js';

const PRIMARY_NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'matchmaking', label: 'Matchmaking' },
  { id: 'tournaments', label: 'Tournaments' },
  { id: 'leaderboard', label: 'Leaderboard' },
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

export default function Sidebar() {
  const {
    screen, setScreen, profile, guestMode, signOut, appVersion,
    checkForUpdates, unreadTotal, dndEnabled, setDndEnabled,
  } = useNexForge();
  const tag = displayTag(profile) || profile?.gamer_tag || 'Player';
  const skill = guestMode ? 'Guest' : mmrToSkillTag(profile?.mmr ?? 1200);
  const rank = guestMode ? 'No account' : `${skill} · ${mmrToRank(profile?.mmr ?? 1200)}`;

  function renderNavItem(item) {
    const locked = guestMode && GUEST_LOCKED_SCREENS.includes(item.id);
    return (
      <div
        key={item.id}
        className={`nav-item ${screen === item.id ? 'active' : ''} ${locked ? 'locked-nav' : ''}`}
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
        Nex<span>Forge</span>
        {appVersion && <div className="sb-version">v{appVersion}</div>}
      </div>
      <nav className="sb-nav">
        <div className="sb-section-label">Play</div>
        {PRIMARY_NAV.map(renderNavItem)}
        <div className="sb-section-label">Social &amp; more</div>
        {SECONDARY_NAV.map(renderNavItem)}
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
        {!guestMode && (
          <button
            type="button"
            className="sb-update-btn"
            onClick={() => {
              if (window.nexforge?.openExternalUrl) {
                window.nexforge.openExternalUrl(COMPANION_URL);
              } else {
                window.open(COMPANION_URL, '_blank', 'noopener,noreferrer');
              }
            }}
            title="Open the mobile/web companion for chat, party, lobby codes, and check-in"
          >
            Open Companion
          </button>
        )}
        {!guestMode && (
          <button
            type="button"
            className={`sb-update-btn ${dndEnabled ? 'dnd-on' : ''}`}
            onClick={() => setDndEnabled(!dndEnabled)}
            title="Mute message sounds and in-game overlay toasts"
          >
            {dndEnabled ? 'Do Not Disturb · On' : 'Do Not Disturb'}
          </button>
        )}
        <button type="button" className="sb-update-btn" onClick={checkForUpdates}>
          Check for updates
        </button>
      </div>
    </aside>
  );
}
