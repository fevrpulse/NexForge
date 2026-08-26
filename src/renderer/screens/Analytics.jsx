import React, { useEffect, useMemo, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { formatDuration } from '../lib/format.js';
import LiveSessionBanner from '../components/LiveSessionBanner.jsx';

const HW_SERIES = [
  { key: 'ramMb', avgKey: 'avg_ram_mb', label: 'RAM', unit: ' MB', color: '#3B7EFF', kind: 'ram' },
  { key: 'cpuPct', avgKey: 'avg_cpu_pct', label: 'CPU', unit: '%', color: '#C9FF00', kind: 'pct' },
  { key: 'gpuPct', avgKey: 'avg_gpu_pct', label: 'GPU', unit: '%', color: '#9B5CFF', kind: 'pct' },
  { key: 'diskPct', avgKey: 'avg_disk_pct', label: 'Disk', unit: '%', color: '#FF8C42', kind: 'pct' },
  { key: 'wifiPct', avgKey: 'avg_wifi_pct', label: 'Wi‑Fi', unit: '%', color: '#4ade80', kind: 'pct' },
];

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function fmtRam(v) {
  return v != null ? `${Math.round(v)} MB` : '—';
}

function fmtPct(v) {
  return v != null ? `${Number(v).toFixed(0)}%` : '—';
}

function polyline(values, w, h, pad, yMin, yMax) {
  const span = (yMax - yMin) || 1;
  const step = (w - pad * 2) / Math.max(values.length - 1, 1);
  return values
    .map((v, i) => {
      if (typeof v !== 'number') return null;
      const x = pad + i * step;
      const y = h - pad - ((v - yMin) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');
}

function HardwareChart({ title, series, height = 200, yMin, yMax, unit }) {
  const w = 640;
  const h = height;
  const pad = 18;
  const usable = series.filter((s) => s.values.filter((n) => typeof n === 'number').length >= 2);
  if (!usable.length) {
    return (
      <div className="card hw-chart-card">
        <div className="card-title">{title}</div>
        <div className="hw-chart-empty">Play a tracked session to plot {title.toLowerCase()}.</div>
      </div>
    );
  }
  const all = usable.flatMap((s) => s.values.filter((n) => typeof n === 'number'));
  const min = yMin != null ? yMin : Math.min(...all);
  const max = yMax != null ? yMax : Math.max(...all);
  const lo = yMin != null ? yMin : (min === max ? Math.max(0, min * 0.9) : min);
  const hi = yMax != null ? yMax : (min === max ? max * 1.1 || 1 : max);
  return (
    <div className="card hw-chart-card">
      <div className="card-title">{title}</div>
      <svg className="hw-chart-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={pad}
            x2={w - pad}
            y1={pad + t * (h - pad * 2)}
            y2={pad + t * (h - pad * 2)}
            stroke="rgba(255,255,255,.06)"
          />
        ))}
        {usable.map((s) => (
          <polyline
            key={s.key}
            points={polyline(s.values, w, h, pad, lo, hi)}
            fill="none"
            stroke={s.color}
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>
      <div className="hw-legend">
        {usable.map((s) => (
          <span className="hw-legend-item" key={s.key}>
            <span className="hw-swatch" style={{ background: s.color }} />
            {s.label}
            {' · avg '}
            {s.kind === 'ram' ? fmtRam(mean(s.values.filter((n) => typeof n === 'number'))) : fmtPct(mean(s.values.filter((n) => typeof n === 'number')))}
          </span>
        ))}
        {unit ? <span className="hw-legend-scale">{unit}</span> : null}
      </div>
    </div>
  );
}

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
  const avg = mean(values);
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
  const series = HW_SERIES
    .map((s) => ({ ...s, values: samples.map((x) => x?.[s.key]).filter((n) => typeof n === 'number') }))
    .filter((s) => s.values.length >= 2);
  if (!series.length) {
    return (
      <div className="session-charts session-charts-empty">
        No hardware timeline was recorded for this session.
      </div>
    );
  }
  return (
    <div className="session-charts">
      {series.map((s) => (
        <Sparkline
          key={s.key}
          label={s.label}
          unit={s.kind === 'ram' ? ' MB' : '%'}
          color={s.color}
          values={s.values}
        />
      ))}
    </div>
  );
}

export default function Analytics() {
  const { user, profile, appPlatform, sessionSaveTick } = useNexForge();
  const [sessions, setSessions] = useState([]);
  const [expandedSession, setExpandedSession] = useState(null);
  const isWindows = String(appPlatform || '').toLowerCase().includes('win');

  useEffect(() => {
    if (!user) return;
    let active = true;
    sb.from('game_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('ended_at', { ascending: true })
      .limit(40)
      .then(({ data, error }) => { if (active && !error) setSessions(data || []); })
      .catch(() => {});
    return () => { active = false; };
  }, [user, sessionSaveTick]);

  const chronological = sessions;
  const newestFirst = useMemo(() => [...sessions].reverse(), [sessions]);

  const pctSeries = HW_SERIES.filter((s) => s.kind === 'pct').map((s) => ({
    ...s,
    values: chronological.map((row) => {
      const n = Number(row[s.avgKey]);
      return Number.isFinite(n) ? n : null;
    }),
  }));
  const ramSeries = [{
    ...HW_SERIES[0],
    values: chronological.map((row) => {
      const n = Number(row.avg_ram_mb);
      return Number.isFinite(n) ? n : null;
    }),
  }];

  const lifetimeAvgs = HW_SERIES.map((s) => {
    const values = chronological.map((row) => Number(row[s.avgKey])).filter((n) => Number.isFinite(n));
    return { ...s, avg: mean(values) };
  });

  if (!profile) return null;

  return (
    <div>
      {!isWindows && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(255,140,66,.35)' }}>
          <div className="card-title">Session tracking</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted2)', lineHeight: 1.6 }}>
            Live RAM / CPU / GPU / disk / Wi‑Fi probes run on Windows builds.
          </div>
        </div>
      )}
      <LiveSessionBanner />

      <div className="stats-grid hw-avg-grid">
        {lifetimeAvgs.map((s) => (
          <div className="stat-card" key={s.key}>
            <div className="stat-label">Avg {s.label}</div>
            <div className="stat-val" style={{ color: s.color }}>
              {s.kind === 'ram' ? fmtRam(s.avg) : fmtPct(s.avg)}
            </div>
            <div className="stat-sub">across tracked sessions</div>
          </div>
        ))}
      </div>

      <div className="hw-dash-grid">
        <HardwareChart
          title="CPU · GPU · Disk · Wi‑Fi"
          series={pctSeries}
          yMin={0}
          yMax={100}
          unit="0–100%"
        />
        <HardwareChart
          title="Average RAM"
          series={ramSeries}
          unit="MB"
        />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Sessions</div>
        {newestFirst.length === 0 ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '16px 0', textAlign: 'center' }}>
            Play a tracked game to see RAM, CPU, GPU, disk, and Wi‑Fi here
          </div>
        ) : (
          <div className="session-list">
            {newestFirst.slice(0, 16).map((s) => {
              const when = s.ended_at ? new Date(s.ended_at).toLocaleString() : '—';
              const expanded = expandedSession === s.id;
              return (
                <div className="session-list-item" key={s.id}>
                  <div
                    className={`session-row session-row-clickable ${expanded ? 'expanded' : ''}`}
                    onClick={() => setExpandedSession((cur) => (cur === s.id ? null : s.id))}
                    title={expanded ? 'Hide graphs' : 'Show graphs'}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="session-row-game">{s.game || 'Unknown'}</div>
                      <div className="session-row-meta">{formatDuration(s.duration_sec)} · {when}</div>
                    </div>
                    <div className="session-row-stats">
                      RAM {fmtRam(s.avg_ram_mb)}<br />
                      CPU {fmtPct(s.avg_cpu_pct)} · GPU {fmtPct(s.avg_gpu_pct)}<br />
                      Disk {fmtPct(s.avg_disk_pct)} · Wi‑Fi {fmtPct(s.avg_wifi_pct)}
                    </div>
                    <span className={`session-row-caret ${expanded ? 'open' : ''}`}>▾</span>
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
