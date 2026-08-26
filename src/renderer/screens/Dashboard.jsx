import React from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { bannerStyleKey } from '../lib/cosmetics.js';
import PlayerAvatar, { GamerTag } from '../components/PlayerAvatar.jsx';
import LiveSessionBanner from '../components/LiveSessionBanner.jsx';
import { COMPANION_URL } from '../lib/companion.js';

function shortCosmeticId(id) {
  if (!id) return '—';
  return String(id).replace(/^(frame_|banner_|plate_)/, '');
}

export default function Dashboard() {
  const { profile, guestMode, setScreen } = useNexForge();

  if (!profile) return null;

  const since = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—';
  const coins = profile.forge_coins ?? 0;

  return (
    <div>
      <LiveSessionBanner />
      <div className={`dash-hero ${guestMode ? 'guest' : ''}`}>
        <div className="dash-hero-copy">
          <p className="dash-kicker">Command deck</p>
          <h2 className="dash-welcome">{guestMode ? 'Drop in as guest.' : 'Welcome back.'}</h2>
          <p className="dash-lede">
            {guestMode
              ? 'Browse the forge. Create an account to keep chat and cosmetics.'
              : 'Crew and hardware on one floor. Queue up or jump into a lounge.'}
          </p>
        </div>
        {!guestMode && (
          <div className={`loadout-showcase banner-${bannerStyleKey(profile.equipped_banner)}`}>
            <PlayerAvatar profile={profile} size={88} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 800 }}><GamerTag profile={profile} /></div>
              <div className="loadout-showcase-meta">
                {profile.main_game || '—'} · {coins.toLocaleString()} coins ·{' '}
                {shortCosmeticId(profile.equipped_frame)} / {shortCosmeticId(profile.equipped_banner)} / {shortCosmeticId(profile.equipped_nameplate)}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="action-btn ghost" style={{ padding: '6px 12px' }} onClick={() => setScreen('shop')}>
                  Customize
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="stats-grid stats-grid-3">
        <div className="stat-card">
          <div className="stat-label">Forge Coins</div>
          <div className="stat-val neon" style={guestMode ? { filter: 'blur(4px)' } : undefined}>
            {guestMode ? '???' : coins.toLocaleString()}
          </div>
          <div className="stat-sub">{guestMode ? 'Sign up to earn coins' : 'Spend in the shop'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Main Game</div>
          <div className="stat-val" style={{ fontSize: 16 }}>{guestMode ? '—' : (profile.main_game || '—')}</div>
          <div className="stat-sub">{profile.platform || 'PC'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Member Since</div>
          <div className="stat-val" style={{ fontSize: 16 }}>{guestMode ? 'Guest' : since}</div>
          <div className="stat-sub">NexForge player</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Your Profile</div>
        {guestMode ? (
          <>
            <div className="row"><span>Mode</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--red)' }}>Guest</span></div>
            <div className="row"><span>Stats</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted2)' }}>Not saved</span></div>
          </>
        ) : (
          <>
            <div className="row"><span>Gamer Tag</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--neon)' }}>{profile.gamer_tag}</span></div>
            <div className="row"><span>Platform</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{profile.platform || 'PC'}</span></div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span>Main Game</span>
              <span style={{ textAlign: 'right' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{profile.main_game || '—'}</span>
                {profile.main_game_description && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted2)', marginTop: 4, lineHeight: 1.4 }}>
                    {profile.main_game_description}
                  </div>
                )}
              </span>
            </div>
            <button className="action-btn ghost full" style={{ marginTop: 10, padding: 8 }} onClick={() => setScreen('profile')}>
              Change Main Game
            </button>
          </>
        )}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Quick Actions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <button className="action-btn primary full" onClick={() => setScreen('matchmaking')}>Find a Match</button>
            <button className="action-btn ghost full" style={{ padding: 9 }} onClick={() => setScreen('analytics')}>
              Open Analytics
            </button>
            <button className="action-btn ghost full" style={{ padding: 9 }} onClick={() => setScreen('tournaments')}>
              Browse Tournaments
            </button>
            {!guestMode && (
              <button
                className="action-btn ghost full"
                style={{ padding: 9 }}
                onClick={() => {
                  if (window.nexforge?.openExternalUrl) {
                    window.nexforge.openExternalUrl(COMPANION_URL);
                  } else {
                    window.open(COMPANION_URL, '_blank', 'noopener,noreferrer');
                  }
                }}
              >
                Open Companion
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
