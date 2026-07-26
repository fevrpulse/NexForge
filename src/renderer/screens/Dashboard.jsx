import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { mmrToRank } from '../lib/ranks.js';

export default function Dashboard() {
  const { profile, user, guestMode, setScreen, showToast } = useNexForge();
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    if (!user || guestMode) {
      setMatches([]);
      return;
    }
    let active = true;
    sb.from('matches')
      .select('*')
      .eq('user_id', user.id)
      .order('played_at', { ascending: false })
      .limit(5)
      .then(({ data }) => { if (active) setMatches(data || []); })
      .catch(() => { if (active) setMatches([]); });
    return () => { active = false; };
  }, [user, guestMode]);

  if (!profile) return null;

  const total = (profile.wins || 0) + (profile.losses || 0);
  const wr = total > 0 ? Math.round((profile.wins / total) * 100) : 0;
  const since = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—';

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">MMR Rating</div>
          <div className="stat-val neon" style={guestMode ? { filter: 'blur(4px)' } : undefined}>
            {guestMode ? '???' : (profile.mmr || 1200).toLocaleString()}
          </div>
          <div className="stat-sub up">Your rank score</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Win Rate</div>
          <div className="stat-val" style={guestMode ? { filter: 'blur(4px)' } : undefined}>
            {guestMode ? '??%' : (total > 0 ? `${wr}%` : '—')}
          </div>
          <div className="stat-sub">
            {guestMode
              ? 'Sign up to track stats'
              : total > 0 ? (wr >= 50 ? '↑ Above average' : '↓ Keep grinding') : 'No matches yet'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Matches Played</div>
          <div className="stat-val">{guestMode ? '—' : total}</div>
          <div className="stat-sub">{guestMode ? 'All games available' : (profile.main_game || 'Set your main game')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Member Since</div>
          <div className="stat-val" style={{ fontSize: 16 }}>{guestMode ? 'Guest' : since}</div>
          <div className="stat-sub">NexForge player</div>
        </div>
      </div>

      <div className="three-col">
        <div className="card">
          <div className="card-title">Recent Matches</div>
          {guestMode ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🔒</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Match history locked</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', marginBottom: 14 }}>
                Create an account to track every match you play
              </div>
              <button
                className="action-btn primary"
                onClick={() => showToast('Sign in from the auth screen to create your NexForge account.', 'success')}
              >
                Create Free Account →
              </button>
            </div>
          ) : matches.length > 0 ? (
            matches.map((m) => {
              const st = m.stats || {};
              const bits = [];
              if (st.kills !== undefined) bits.push(`${st.kills}/${st.deaths || 0}/${st.assists || 0}`);
              if (st.kda) bits.push(`KDA ${st.kda}`);
              if (st.placement) bits.push(st.placement);
              if (st.goals !== undefined) bits.push(`${st.goals} goals`);
              if (st.mvp) bits.push('MVP');
              if (st.ace) bits.push('ACE');
              return (
                <div className="row" key={m.id}>
                  <div>
                    <div className="row-title">{m.game}</div>
                    <div className="row-sub">{m.mode}{bits.length ? ` · ${bits.join(' · ')}` : ''}</div>
                  </div>
                  <div className={`result ${m.result === 'win' ? 'win' : 'loss'}`}>
                    {m.result === 'win' ? `WIN +${m.mmr_change}` : `LOSS ${m.mmr_change}`}
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '20px 0', textAlign: 'center' }}>
              No matches yet — find your first match!
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Your Profile</div>
          {guestMode ? (
            <>
              <div className="row"><span>Mode</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--red)' }}>Guest</span></div>
              <div className="row"><span>Stats</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted2)' }}>Not saved</span></div>
              <div className="row"><span>Rank</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted2)' }}>Unranked</span></div>
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
              <div className="row"><span>Rank</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--neon)' }}>{mmrToRank(profile.mmr)}</span></div>
              <button className="action-btn ghost full" style={{ marginTop: 10, padding: 8 }} onClick={() => setScreen('profile')}>
                Change Main Game
              </button>
            </>
          )}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div className="card-title" style={{ marginBottom: 8 }}>Quick Actions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <button className="action-btn primary full" onClick={() => setScreen('matchmaking')}>Find a Match</button>
              <button className="action-btn ghost full" style={{ padding: 9 }} onClick={() => setScreen('tournaments')}>
                Browse Tournaments
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
