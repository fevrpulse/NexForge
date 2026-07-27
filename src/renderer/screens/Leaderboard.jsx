import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';

const COLORS = ['#C9FF00', '#3B7EFF', '#FF8C42', '#4ade80', '#9B5CFF'];

export default function Leaderboard() {
  const { profile, setCloudOffline, reportCloudError } = useNexForge();
  const [players, setPlayers] = useState(null);

  useEffect(() => {
    let active = true;
    sb.from('profiles')
      .select('gamer_tag,mmr,main_game,platform')
      .order('mmr', { ascending: false })
      .limit(10)
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error) {
          await reportCloudError(error);
          setPlayers([]);
          return;
        }
        setCloudOffline(false);
        setPlayers(data || []);
      })
      .catch(async (err) => {
        if (!active) return;
        await reportCloudError(err);
        setPlayers([]);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card">
      <div className="card-title">Top Players — NexForge Global</div>
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
          const isMe = profile && p.gamer_tag === profile.gamer_tag;
          return (
            <div
              className="player-row"
              key={`${p.gamer_tag}-${i}`}
              style={isMe ? { background: 'rgba(201,255,0,.04)', margin: '0 -16px', padding: '9px 16px' } : undefined}
            >
              <div className="player-num" style={{ color: i < 3 ? col : 'var(--muted2)', fontWeight: 700 }}>{i + 1}</div>
              <div className="player-av" style={{ background: `${col}22`, color: col }}>{init}</div>
              <div className="player-info">
                <div className="player-tag">{p.gamer_tag}{isMe ? ' (You)' : ''}</div>
                <div className="player-game">{p.main_game || '—'} · {p.platform || 'PC'}</div>
              </div>
              <div className="player-mmr">{(p.mmr || 1200).toLocaleString()}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
