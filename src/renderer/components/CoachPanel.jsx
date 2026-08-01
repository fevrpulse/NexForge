import React, { useCallback, useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';

function tiltClass(score) {
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/** Weekly coach insights from sessions + W/L (server-side rules). */
export default function CoachPanel({ compact = false }) {
  const { user, guestMode, showToast, reportCloudError, sessionSaveTick } = useNexForge();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (force = false) => {
    if (!user || guestMode) {
      setReport(null);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = force
        ? await sb.rpc('generate_coach_report', { p_force: true })
        : await sb.rpc('get_my_coach_report');
      if (error) throw error;
      setReport(data || null);
    } catch (err) {
      console.warn('coach report failed', err);
      if (force) {
        showToast(err?.message || 'Could not refresh coach.', 'error');
        await reportCloudError(err);
      }
    } finally {
      setLoading(false);
    }
  }, [user, guestMode, showToast, reportCloudError]);

  useEffect(() => {
    load(false);
  }, [load]);

  // Fresh tips after a session is saved (bypass 6h cache).
  useEffect(() => {
    if (!sessionSaveTick) return undefined;
    load(true);
    return undefined;
  }, [sessionSaveTick, load]);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      await load(true);
      showToast('Coach refreshed', 'success');
    } finally {
      setBusy(false);
    }
  }

  if (guestMode || !user) return null;

  const weekly = report?.weekly || {};
  const insights = Array.isArray(report?.insights) ? report.insights : [];
  const tilt = report?.tilt_score ?? 0;
  const shown = compact ? insights.slice(0, 2) : insights;

  return (
    <div className={`card coach-panel ${compact ? 'compact' : ''}`}>
      <div className="coach-panel-head">
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>AI Coach</div>
          <div className="coach-sub">
            {report?.summary || (loading ? 'Reading your last 7 days…' : 'Tips from sessions, ping, and W/L')}
          </div>
        </div>
        <div className="coach-panel-actions">
          <span className={`coach-tilt tilt-${tiltClass(tilt)}`} title="Tilt risk from loss streaks + conditions">
            Tilt {tilt}
          </span>
          <button
            type="button"
            className="action-btn ghost"
            style={{ padding: '4px 10px', fontSize: 11 }}
            disabled={busy || loading}
            onClick={refresh}
          >
            {busy ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      {report && (
        <div className="coach-weekly">
          <span>{weekly.sessions ?? 0} sessions</span>
          <span>{weekly.wins ?? 0}W–{weekly.losses ?? 0}L</span>
          {weekly.avg_ping_ms != null && <span>avg {weekly.avg_ping_ms} ms</span>}
          {weekly.streak_kind === 'win' && weekly.streak_len > 1 && (
            <span className="coach-streak win">{weekly.streak_len}W streak</span>
          )}
          {weekly.streak_kind === 'loss' && weekly.streak_len > 1 && (
            <span className="coach-streak loss">{weekly.streak_len}L streak</span>
          )}
        </div>
      )}

      {loading && !report ? (
        <div className="coach-empty">Loading coach…</div>
      ) : shown.length === 0 ? (
        <div className="coach-empty">No insights yet.</div>
      ) : (
        <div className="coach-insights">
          {shown.map((tip) => (
            <div key={tip.id || tip.title} className={`coach-insight sev-${tip.severity || 'low'}`}>
              <div className="coach-insight-title">{tip.title}</div>
              {!compact && <div className="coach-insight-body">{tip.body}</div>}
              {compact && tip.body && (
                <div className="coach-insight-body coach-insight-clip">{tip.body}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
