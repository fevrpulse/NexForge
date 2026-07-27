import React, { useCallback, useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { mmrToRank } from '../lib/ranks.js';

const COLORS = ['#C9FF00', '#3B7EFF', '#FF8C42', '#4ade80', '#9B5CFF'];

export default function Leaderboard() {
  const { user, profile, setCloudOffline, reportCloudError } = useNexForge();
  const [players, setPlayers] = useState(null);

  const loadPlayers = useCallback(async () => {
    try {
      const { data, error } = await sb.from('profiles')
        .select('id,gamer_tag,mmr,main_game,platform')
        .order('mmr', { ascending: false })
        .limit(10);
      if (error) throw error;
      setCloudOffline(false);
      setPlayers(data || []);
    } catch (err) {
      await reportCloudError(err);
      setPlayers([]);
    }
  }, [setCloudOffline, reportCloudError]);

  useEffect(() => {
    loadPlayers();
  }, [loadPlayers]);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <div className="card-title">Top Players — NexForge Global</div>
        <button className="mm-back" style={{ marginBottom: 0 }} onClick={loadPlayers}>↻ Refresh</button>
      </div>
      {players === null ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '20px 0', textAlign: 'center' }}>
          Loading leaderboard...
        </div>
      ) : players.length === 0 ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '20px 0', textAlign: 'center' }}>
          No players yet — be the first!
        </div>
      ) : (
        players.map((p, i) => {
          const col = COLORS[i] || '#666';
          const init = (p.gamer_tag || '?').slice(0, 2).toUpperCase();
          const isMe = user ? p.id === user.id : (profile && p.gamer_tag === profile.gamer_tag);
          return (
            <div
              className="player-row"
              key={p.id || `${p.gamer_tag}-${i}`}
              style={isMe ? { background: 'rgba(201,255,0,.04)', margin: '0 -16px', padding: '9px 16px' } : undefined}
            >
              <div className="player-num" style={{ color: i < 3 ? col : 'var(--muted2)', fontWeight: 700 }}>{i + 1}</div>
              <div className="player-av" style={{ background: `${col}22`, color: col }}>{init}</div>
              <div className="player-info">
                <div className="player-tag">{p.gamer_tag}{isMe ? ' (You)' : ''}</div>
                <div className="player-game">{p.main_game || '—'} · {p.platform || 'PC'} · {mmrToRank(p.mmr ?? 1200)}</div>
              </div>
              <div className="player-mmr">{(p.mmr || 1200).toLocaleString()}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
