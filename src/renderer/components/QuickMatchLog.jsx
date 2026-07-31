import React, { useMemo, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';

/** Two-tap casual W/L log for games that were not auto-tracked. */
export default function QuickMatchLog({ onLogged }) {
  const {
    profile,
    knownGames,
    guestMode,
    refreshProfile,
    showToast,
    reportCloudError,
  } = useNexForge();
  const [game, setGame] = useState(profile?.main_game || knownGames[0] || 'Valorant');
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => {
    const list = [...(knownGames || [])];
    if (profile?.main_game && !list.includes(profile.main_game)) {
      list.unshift(profile.main_game);
    }
    return list;
  }, [knownGames, profile?.main_game]);

  if (guestMode) return null;

  async function logResult(result) {
    if (busy || !game) return;
    setBusy(true);
    try {
      const { error } = await sb.rpc('log_match_result', {
        p_result: result,
        p_game: game,
        p_mode: 'Quick log',
        p_session_id: null,
      });
      if (error) throw error;
      await refreshProfile();
      showToast(result === 'win' ? `${game} win logged` : `${game} loss logged`, 'success');
      onLogged?.();
    } catch (err) {
      showToast(err?.message || 'Could not log result.', 'error');
      await reportCloudError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card quick-match-log">
      <div className="card-title">Quick Match Log</div>
      <div className="quick-match-log-sub">
        Log a win or loss instantly — no opponent confirm, no MMR change.
      </div>
      <label className="quick-match-log-label">
        Game
        <select
          value={game}
          onChange={(e) => setGame(e.target.value)}
          disabled={busy}
        >
          {options.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </label>
      <div className="quick-match-log-actions">
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
      </div>
    </div>
  );
}
