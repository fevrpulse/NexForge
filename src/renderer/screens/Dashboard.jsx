import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { bannerStyleKey } from '../lib/cosmetics.js';
import PlayerAvatar, { GamerTag } from '../components/PlayerAvatar.jsx';
import LiveSessionBanner from '../components/LiveSessionBanner.jsx';
import { COMPANION_URL } from '../lib/companion.js';
import { formatDuration } from '../lib/format.js';

function shortCosmeticId(id) {
  if (!id) return '—';
  return String(id).replace(/^(frame_|banner_|plate_)/, '');
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleString();
}

export default function Dashboard() {
  const {
    profile, user, guestMode, setScreen, createAccount, openFriendChat,
    activeSeason, battlePassXp, sessionSaveTick,
  } = useNexForge();
  const [sessions, setSessions] = useState([]);
  const [friendActivity, setFriendActivity] = useState([]);

  useEffect(() => {
    if (!user || guestMode) {
      setSessions([]);
      return;
    }
    let active = true;
    sb.from('game_sessions')
      .select('id,game,duration_sec,ended_at,avg_ram_mb,avg_cpu_pct,avg_gpu_pct,avg_disk_pct,avg_wifi_pct')
      .eq('user_id', user.id)
      .order('ended_at', { ascending: false })
      .limit(5)
      .then(({ data, error }) => { if (active && !error) setSessions(data || []); })
      .catch(() => { if (active) setSessions([]); });
    return () => { active = false; };
  }, [user, guestMode, sessionSaveTick]);

  useEffect(() => {
    if (!user || guestMode) {
      setFriendActivity([]);
      return;
    }
    let active = true;
    sb.rpc('friend_activity_feed', { p_limit: 10 })
      .then(({ data, error }) => { if (active && !error) setFriendActivity(data || []); })
      .catch(() => { if (active) setFriendActivity([]); });
    return () => { active = false; };
  }, [user, guestMode]);

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
              ? 'Browse the forge. Create an account to keep chat, sessions, and cosmetics.'
              : 'Sessions, crew, and hardware on one floor. Queue up or jump into a lounge.'}
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
                {activeSeason?.name ? ` · ${activeSeason.name}` : ''}
                {battlePassXp != null ? ` · pass ${battlePassXp} XP` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {activeSeason?.name && (
                  <span className="badge season-badge">{activeSeason.name}</span>
                )}
                <button className="action-btn ghost" style={{ padding: '6px 12px' }} onClick={() => setScreen('shop')}>
                  Customize
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Forge Coins</div>
          <div className="stat-val neon" style={guestMode ? { filter: 'blur(4px)' } : undefined}>
            {guestMode ? '???' : coins.toLocaleString()}
          </div>
          <div className="stat-sub">{guestMode ? 'Sign up to earn coins' : 'Spend in the shop'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sessions</div>
          <div className="stat-val" style={guestMode ? { filter: 'blur(4px)' } : undefined}>
            {guestMode ? '—' : sessions.length}
          </div>
          <div className="stat-sub">{guestMode ? 'Hardware tracking locked' : 'recent tracked games'}</div>
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

      <div className="three-col">
        <div className="card">
          <div className="card-title">Recent Sessions</div>
          {guestMode ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Session history locked</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', marginBottom: 14 }}>
                Create an account to track RAM, CPU, GPU, disk, and Wi‑Fi
              </div>
              <button className="action-btn primary" onClick={createAccount}>
                Create Free Account →
              </button>
            </div>
          ) : sessions.length > 0 ? (
            sessions.map((s) => (
              <div className="row" key={s.id}>
                <div>
                  <div className="row-title">{s.game}</div>
                  <div className="row-sub">
                    {formatDuration(s.duration_sec)}
                    {s.ended_at ? ` · ${formatRelativeTime(s.ended_at)}` : ''}
                  </div>
                </div>
                <div className="row-sub" style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11 }}>
                  {s.avg_cpu_pct != null ? `CPU ${Number(s.avg_cpu_pct).toFixed(0)}%` : '—'}
                </div>
              </div>
            ))
          ) : (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '20px 0', textAlign: 'center' }}>
              No sessions yet — launch a tracked game
            </div>
          )}
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

        <div className="card">
          <div className="card-title">Friend Activity</div>
          {guestMode ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)' }}>
                Sign in to see what your friends are playing
              </div>
            </div>
          ) : friendActivity.length > 0 ? (
            friendActivity.map((a) => (
              <div
                className="row clickable"
                key={a.match_id}
                title="Open chat"
                onClick={() => { if (a.friend_id) openFriendChat(a.friend_id); }}
              >
                <div>
                  <div className="row-title">{a.gamer_tag} · {a.game}</div>
                  <div className="row-sub">{a.mode || 'Session'} · {formatRelativeTime(a.played_at)}</div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '20px 0', textAlign: 'center' }}>
              No friend activity yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
