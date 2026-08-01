import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { formatDuration } from '../lib/format.js';
import LiveSessionBanner from '../components/LiveSessionBanner.jsx';
import MatchResultPrompt from '../components/MatchResultPrompt.jsx';
import CoachPanel from '../components/CoachPanel.jsx';

const SESSION_SERIES = [
  { key: 'ramMb', label: 'RAM', unit: 'MB', color: '#3B7EFF' },
  { key: 'cpuPct', label: 'CPU', unit: '%', color: '#C9FF00' },
  { key: 'gpuPct', label: 'GPU', unit: '%', color: '#9B5CFF' },
  { key: 'pingMs', label: 'Ping', unit: 'ms', color: '#FF8C42' },
];

function Sparkline({ label, unit, color, values }) {
  const w = 220;
  const h = 54;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (w - pad * 2) / Math.max(values.length - 1, 1);
  const pts = values
    .map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`)
    .join(' ');
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return (
    <div className="session-spark">
      <div className="session-spark-head">
        <span className="session-spark-label" style={{ color }}>{label}</span>
        <span className="session-spark-stats">
          avg {Math.round(avg)}{unit} · peak {Math.round(max)}{unit}
        </span>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function SessionCharts({ session }) {
  const samples = Array.isArray(session.samples) ? session.samples : [];
  const series = SESSION_SERIES
    .map((s) => ({ ...s, values: samples.map((x) => x?.[s.key]).filter((n) => typeof n === 'number') }))
    .filter((s) => s.values.length >= 2);
  if (!series.length) {
    return (
      <div className="session-charts session-charts-empty">
        No performance timeline was recorded for this session.
      </div>
    );
  }
  return (
    <div className="session-charts">
      {series.map((s) => (
        <Sparkline key={s.key} label={s.label} unit={s.unit} color={s.color} values={s.values} />
      ))}
    </div>
  );
}

function fmtPing(v) {
  return v != null ? `${Math.round(v)} ms` : '—';
}

function fmtRam(v) {
  return v != null ? `${Math.round(v)} MB` : '—';
}

function fmtPct(v) {
  return v != null ? `${Number(v).toFixed(0)}%` : '—';
}

function SessionComparePanel({ sessions, onClear }) {
  return (
    <div className="session-compare-wrap">
      <div className="session-compare-head">
        <span className="session-compare-label">Comparing {sessions.length} sessions</span>
        <button type="button" className="action-btn ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="session-compare">
        {sessions.map((s) => {
          const when = s.ended_at ? new Date(s.ended_at).toLocaleString() : '—';
          return (
            <div className="session-compare-col" key={s.id}>
              <div className="session-compare-game">{s.game || 'Unknown'}</div>
              <div className="session-compare-meta">{formatDuration(s.duration_sec)} · {when}</div>
              <div className="session-compare-metrics">
                <div className="session-compare-metric">
                  <span>Ping</span>
                  <span>avg {fmtPing(s.avg_ping_ms)} · max {fmtPing(s.max_ping_ms)}</span>
                </div>
                <div className="session-compare-metric">
                  <span>RAM</span>
                  <span>avg {fmtRam(s.avg_ram_mb)} · max {fmtRam(s.max_ram_mb)}</span>
                </div>
                <div className="session-compare-metric">
                  <span>CPU</span>
                  <span>avg {fmtPct(s.avg_cpu_pct)} · max {fmtPct(s.max_cpu_pct)}</span>
                </div>
                <div className="session-compare-metric">
                  <span>GPU</span>
                  <span>avg {fmtPct(s.avg_gpu_pct)} · max {fmtPct(s.max_gpu_pct)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Analytics() {
  const { user, profile, refreshProfile, appPlatform, sessionSaveTick, activeSeason, seasonRating } = useNexForge();
  const [matches, setMatches] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [expandedSession, setExpandedSession] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
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
  }, [user, profile?.wins, profile?.losses]);

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

  const wins = profile.wins || 0;
  const losses = profile.losses || 0;
  const total = wins + losses;
  const wr = total > 0 ? `${Math.round((wins / total) * 100)}%` : '—';

  const last7 = matches.slice(0, 7).reverse();
  const maxBar = Math.max(
    1,
    ...last7.map((m) => {
      const delta = Math.abs(m.mmr_change || 0);
      return delta > 0 ? delta : 10;
    }),
  );

  const compareSessions = compareIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter(Boolean);

  const toggleCompareMode = () => {
    setCompareMode((on) => {
      if (on) {
        setCompareIds([]);
      } else {
        setExpandedSession(null);
      }
      return !on;
    });
  };

  const toggleCompareSelection = (id) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const handleSessionRowClick = (s) => {
    if (compareMode) {
      toggleCompareSelection(s.id);
      return;
    }
    setExpandedSession((cur) => (cur === s.id ? null : s.id));
  };

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
      <MatchResultPrompt />
      <CoachPanel />

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Wins</div>
          <div className="stat-val" style={{ color: '#4ade80' }}>{wins}</div>
          <div className="stat-sub">career wins</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Losses</div>
          <div className="stat-val" style={{ color: 'var(--red)' }}>{losses}</div>
          <div className="stat-sub">career losses</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Win Rate</div>
          <div className="stat-val">{wr}</div>
          <div className="stat-sub">{total > 0 ? `${total} matches` : 'no matches yet'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">MMR</div>
          <div className="stat-val neon">{(profile.mmr || 1200).toLocaleString()}</div>
          <div className="stat-sub">
            {seasonRating?.mmr != null
              ? `${activeSeason?.name || 'Season'} · ${seasonRating.mmr}`
              : (profile.main_game || 'lifetime MMR')}
          </div>
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
                const delta = Math.abs(m.mmr_change || 0);
                const h = Math.max(12, Math.round(((delta > 0 ? delta : 10) / maxBar) * 80));
                const st = m.stats || {};
                const tip = [
                  m.game,
                  String(m.result || '').toUpperCase(),
                  m.source === 'self_report' ? 'logged' : '',
                  st.kills !== undefined ? `${st.kills}K/${st.deaths || 0}D` : '',
                  st.placement || '',
                ].filter(Boolean).join(' · ');
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
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Recent Matches</span>
            <button type="button" className="action-btn ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={refreshProfile}>
              Refresh
            </button>
          </div>
          {matches.length === 0 ? (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '20px 0', textAlign: 'center' }}>
              No matches yet — log a result after a session or finish a duel
            </div>
          ) : (
            matches.slice(0, 8).map((m) => {
              const logged = m.source === 'self_report';
              const st = m.stats || {};
              const bits = [];
              if (m.mode) bits.push(m.mode);
              if (st.kills !== undefined) bits.push(`${st.kills}/${st.deaths || 0}/${st.assists || 0}`);
              if (logged) bits.push('no MMR');
              else if (m.mmr_change != null) bits.push(`${m.mmr_change > 0 ? '+' : ''}${m.mmr_change} MMR`);
              return (
                <div className="row" key={m.id}>
                  <div>
                    <div className="row-title">
                      {m.game || 'Match'}
                      {logged && <span className="match-source-badge">logged</span>}
                    </div>
                    <div className="row-sub">{bits.join(' · ') || new Date(m.played_at).toLocaleString()}</div>
                  </div>
                  <div className={`result ${m.result === 'win' ? 'win' : 'loss'}`}>
                    {m.result === 'win' ? 'WIN' : 'LOSS'}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="session-card-head">
          <div className="card-title" style={{ marginBottom: 0 }}>Performance Sessions</div>
          {sessions.length > 0 && (
            <button
              type="button"
              className={`action-btn ghost ${compareMode ? 'primary' : ''}`}
              style={{ padding: '6px 12px', fontSize: 11 }}
              onClick={toggleCompareMode}
            >
              {compareMode ? 'Exit Compare' : 'Compare'}
            </button>
          )}
        </div>
        {compareMode && compareSessions.length === 2 && (
          <SessionComparePanel
            sessions={compareSessions}
            onClear={() => setCompareIds([])}
          />
        )}
        {compareMode && compareSessions.length < 2 && (
          <div className="session-compare-hint">
            Select {2 - compareSessions.length} more session{compareSessions.length === 1 ? '' : 's'} to compare
          </div>
        )}
        {sessions.length === 0 ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '16px 0', textAlign: 'center' }}>
            Play a tracked game to see RAM, CPU, GPU, and ping summaries here
          </div>
        ) : (
          <div className="session-list">
            {sessions.slice(0, 12).map((s) => {
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
              const expanded = !compareMode && expandedSession === s.id;
              const selected = compareMode && compareIds.includes(s.id);
              return (
                <div className="session-list-item" key={s.id}>
                  <div
                    className={`session-row session-row-clickable ${expanded ? 'expanded' : ''} ${selected ? 'session-row-selected' : ''}`}
                    onClick={() => handleSessionRowClick(s)}
                    title={compareMode ? (selected ? 'Deselect session' : 'Select session to compare') : (expanded ? 'Hide performance graphs' : 'Show performance graphs')}
                  >
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
                    {!compareMode && (
                      <span className={`session-row-caret ${expanded ? 'open' : ''}`}>▾</span>
                    )}
                  </div>
                  {expanded && <SessionCharts session={s} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
