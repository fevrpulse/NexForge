import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { formatDuration } from '../lib/format.js';
import LiveSessionBanner from '../components/LiveSessionBanner.jsx';

export default function Analytics() {
  const { user, profile, refreshProfile, appPlatform, sessionSaveTick } = useNexForge();
  const [matches, setMatches] = useState([]);
  const [sessions, setSessions] = useState([]);
  const isWindows = String(appPlatform || '').toLowerCase().includes('win');

  useEffect(() => {
    if (!user) return;
    let active = true;
    sb.from('matches')
      .select('*')
      .eq('user_id', user.id)
      .order('played_at', { ascending: false })
      .limit(20)
      .then(({ data }) => { if (active) setMatches(data || []); })
      .catch(() => { if (active) setMatches([]); });
    return () => { active = false; };
  }, [user]);

  // sessionSaveTick bumps when a session finishes saving (handled in context),
  // so history refreshes even if it ended while another screen was open.
  useEffect(() => {
    if (!user) return;
    let active = true;
    sb.from('game_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('ended_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => { if (active && !error) setSessions(data || []); })
      .catch(() => {});
    return () => { active = false; };
  }, [user, sessionSaveTick]);

  if (!profile) return null;

  const total = (profile.wins || 0) + (profile.losses || 0);
  const wr = total > 0 ? `${Math.round((profile.wins / total) * 100)}%` : '—';

  let totalK = profile.total_kills || 0;
  let totalD = profile.total_deaths || 0;
  let totalA = profile.total_assists || 0;
  let totalDmg = 0;
  let kdaMatches = 0;
  matches.forEach((m) => {
    const st = m.stats || {};
    if (st.kills !== undefined) kdaMatches += 1;
    if (st.damage) totalDmg += st.damage;
  });
  if (!totalK && !totalD && !totalA) {
    matches.forEach((m) => {
      const st = m.stats || {};
      if (st.kills !== undefined) {
        totalK += st.kills || 0;
        totalD += st.deaths || 0;
        totalA += st.assists || 0;
      }
    });
  }
  const kda = (totalK || totalD || totalA) ? ((totalK + totalA) / Math.max(totalD, 1)).toFixed(2) : '—';
  const avgDmg = kdaMatches > 0 ? Math.round(totalDmg / kdaMatches).toLocaleString() : '—';

  const last7 = matches.slice(0, 7).reverse();
  const maxMMR = Math.max(1, ...last7.map((m) => Math.abs(m.mmr_change || 1)));

  return (
    <div>
      {!isWindows && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(255,140,66,.35)' }}>
          <div className="card-title">Session tracking</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted2)', lineHeight: 1.6 }}>
            Live RAM / CPU / GPU / ping session probes run on Windows builds. Match history and career stats still work on this platform.
          </div>
        </div>
      )}
      <LiveSessionBanner />

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Avg KDA</div>
          <div className="stat-val neon">{kda}</div>
          <div className="stat-sub">kills/deaths/assists</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Win Rate</div>
          <div className="stat-val">{wr}</div>
          <div className="stat-sub">ranked matches</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Matches</div>
          <div className="stat-val">{total}</div>
          <div className="stat-sub">career total</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">MMR</div>
          <div className="stat-val neon">{(profile.mmr || 1200).toLocaleString()}</div>
          <div className="stat-sub">matchmaking rating</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-title">Match Results — Last 7</div>
          <div className="chart-bars">
            {last7.length === 0 ? (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', alignSelf: 'center', flex: 1, textAlign: 'center' }}>
                Play matches to see your chart
              </div>
            ) : (
              last7.map((m) => {
                const h = Math.max(12, Math.round((Math.abs(m.mmr_change || 10) / maxMMR) * 80));
                const st = m.stats || {};
                const tip = [m.game, m.result.toUpperCase(), st.kills !== undefined ? `${st.kills}K/${st.deaths || 0}D` : '', st.placement || '']
                  .filter(Boolean).join(' · ');
                return (
                  <div className="bar-wrap" key={m.id}>
                    <div
                      className="bar"
                      style={{ height: h, background: m.result === 'win' ? 'var(--neon)' : 'var(--red)' }}
                      title={tip}
                    />
                    <div className="bar-lbl">{new Date(m.played_at).toLocaleDateString('en-US', { weekday: 'narrow' })}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Profile Info</div>
          <div className="row"><span>Main Game</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--neon)' }}>{profile.main_game || '—'}</span></div>
          <div className="row"><span>Total Kills</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--neon)' }}>{totalK.toLocaleString()}</span></div>
          <div className="row"><span>Total Deaths</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--red)' }}>{totalD.toLocaleString()}</span></div>
          <div className="row"><span>Total Assists</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{totalA.toLocaleString()}</span></div>
          <div className="row"><span>Avg Damage</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{avgDmg}</span></div>
          <div className="row"><span>Wins</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#4ade80' }}>{profile.wins || 0}</span></div>
          <div className="row"><span>Losses</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--red)' }}>{profile.losses || 0}</span></div>
          <div className="row"><span>Platform</span><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{profile.platform || 'PC'}</span></div>
          <button className="action-btn ghost full" style={{ marginTop: 12, padding: 8 }} onClick={refreshProfile}>
            Refresh Stats
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Performance Sessions</div>
        {sessions.length === 0 ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '16px 0', textAlign: 'center' }}>
            Play a tracked game to see RAM, CPU, GPU, and ping summaries here
          </div>
        ) : (
          sessions.slice(0, 12).map((s) => {
            const when = s.ended_at ? new Date(s.ended_at).toLocaleString() : '—';
            const ping = s.avg_ping_ms != null ? `${Math.round(s.avg_ping_ms)} ms` : '—';
            const ram = s.avg_ram_mb != null ? `${Math.round(s.avg_ram_mb)} MB` : '—';
            const cpu = s.avg_cpu_pct != null ? `${Number(s.avg_cpu_pct).toFixed(0)}%` : '—';
            const gpu = s.avg_gpu_pct != null ? `${Number(s.avg_gpu_pct).toFixed(0)}%` : '—';
            const kdaLine = s.kills != null ? `${s.kills}/${s.deaths ?? 0}/${s.assists ?? 0}` : null;
            const peaks = [
              s.max_ping_ms != null ? `Ping ${Math.round(s.max_ping_ms)} ms` : null,
              s.max_ram_mb != null ? `RAM ${Math.round(s.max_ram_mb)} MB` : null,
              s.max_cpu_pct != null ? `CPU ${Number(s.max_cpu_pct).toFixed(0)}%` : null,
              s.max_gpu_pct != null ? `GPU ${Number(s.max_gpu_pct).toFixed(0)}%` : null,
            ].filter(Boolean).join(' · ');
            const tips = Array.isArray(s.tips) ? s.tips.slice(0, 2) : [];
            return (
              <div className="session-row" key={s.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="session-row-game">{s.game || 'Unknown'}</div>
                  <div className="session-row-meta">
                    {formatDuration(s.duration_sec)} · {when}{kdaLine ? ` · ${kdaLine} K/D/A` : ''}
                  </div>
                  {tips.length > 0 && (
                    <div className="session-row-tips">
                      {tips.map((tip) => <div key={tip}>· {tip}</div>)}
                    </div>
                  )}
                </div>
                <div className="session-row-stats" title={peaks ? `Peaks — ${peaks}` : undefined}>
                  Ping {ping}<br />RAM {ram}<br />CPU {cpu}<br />GPU {gpu}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
