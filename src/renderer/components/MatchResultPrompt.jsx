import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { formatDuration } from '../lib/format.js';

/** Post-session one-tap W/L prompt. */
export default function MatchResultPrompt() {
  const {
    pendingMatchLog,
    clearPendingMatchLog,
    refreshProfile,
    showToast,
    reportCloudError,
  } = useNexForge();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pendingMatchLog) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || busy) return;
      e.preventDefault();
      clearPendingMatchLog();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingMatchLog, busy, clearPendingMatchLog]);

  if (!pendingMatchLog) return null;

  async function logResult(result) {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await sb.rpc('log_match_result', {
        p_result: result,
        p_game: pendingMatchLog.game,
        p_mode: pendingMatchLog.mode || null,
        p_session_id: pendingMatchLog.sessionId || null,
      });
      if (error) throw error;
      await refreshProfile();
      showToast(result === 'win' ? 'Win logged' : 'Loss logged', 'success');
      clearPendingMatchLog();
    } catch (err) {
      const msg = String(err?.message || '');
      showToast(
        /function.*log_match_result|could not find the function|404|not found/i.test(msg)
          ? 'Win/loss logging is not live on the server yet.'
          : (err?.message || 'Could not log result.'),
        'error',
      );
      await reportCloudError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card match-result-prompt">
      <div className="match-result-prompt-copy">
        <div className="card-title" style={{ marginBottom: 4 }}>How did it go?</div>
        <div className="match-result-prompt-sub">
          {pendingMatchLog.game}
          {pendingMatchLog.durationSec != null ? ` · ${formatDuration(pendingMatchLog.durationSec)}` : ''}
          {pendingMatchLog.avgCpuPct != null ? ` · CPU ${Number(pendingMatchLog.avgCpuPct).toFixed(0)}%` : ''}
          {pendingMatchLog.avgGpuPct != null ? ` · GPU ${Number(pendingMatchLog.avgGpuPct).toFixed(0)}%` : ''}
        </div>
        {pendingMatchLog.tip ? (
          <div className="match-result-prompt-tip">{pendingMatchLog.tip}</div>
        ) : null}
      </div>
      <div className="match-result-prompt-actions">
        <button
          type="button"
          className="action-btn primary"
          disabled={busy}
          onClick={() => logResult('win')}
        >
          Won
        </button>
        <button
          type="button"
          className="action-btn danger"
          disabled={busy}
          onClick={() => logResult('loss')}
        >
          Lost
        </button>
        <button
          type="button"
          className="action-btn ghost"
          disabled={busy}
          onClick={clearPendingMatchLog}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
