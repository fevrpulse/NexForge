import React, { useCallback, useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { mmrToRank, mmrToSkillTag, skillTagClass } from '../lib/ranks.js';
import PlayerAvatar, { GamerTag } from '../components/PlayerAvatar.jsx';

const COLORS = ['#C9FF00', '#3B7EFF', '#FF8C42', '#4ade80', '#9B5CFF'];

export default function Leaderboard() {
  const { user, profile, setCloudOffline, reportCloudError, activeSeason } = useNexForge();
  const [mode, setMode] = useState('season'); // 'season' | 'lifetime'
  const [players, setPlayers] = useState(null);

  const loadPlayers = useCallback(async () => {
    try {
      if (mode === 'season') {
        const { data, error } = await sb.rpc('get_season_leaderboard', {
          p_game: '_global',
          p_limit: 10,
        });
        if (error) throw error;
        setCloudOffline(false);
        setPlayers(Array.isArray(data) ? data : []);
        return;
      }
      const { data, error } = await sb.from('profiles')
        .select('id,gamer_tag,mmr,main_game,platform,avatar_path,avatar_preset,equipped_frame,equipped_banner,equipped_nameplate')
        .order('mmr', { ascending: false })
        .limit(10);
      if (error) throw error;
      setCloudOffline(false);
      setPlayers(data || []);
    } catch (err) {
      await reportCloudError(err);
      setPlayers([]);
    }
  }, [mode, setCloudOffline, reportCloudError]);

  useEffect(() => {
    setPlayers(null);
    loadPlayers();
  }, [loadPlayers]);

  const seasonName = activeSeason?.name || 'Season';

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          {mode === 'season' ? `Top Players — ${seasonName}` : 'Top Players — Lifetime'}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="lb-mode-toggle">
            <button
              type="button"
              className={`lb-mode-btn ${mode === 'season' ? 'active' : ''}`}
              onClick={() => setMode('season')}
            >
              Season
            </button>
            <button
              type="button"
              className={`lb-mode-btn ${mode === 'lifetime' ? 'active' : ''}`}
              onClick={() => setMode('lifetime')}
            >
              Lifetime
            </button>
          </div>
          <button className="mm-back" style={{ marginBottom: 0 }} onClick={loadPlayers}>↻ Refresh</button>
        </div>
      </div>
      {mode === 'season' && (
        <div className="lb-season-hint">
          Ranked duel wins/losses this season (±15 MMR). Lifetime cosmetics unlocks still use career MMR.
        </div>
      )}
      {players === null ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '20px 0', textAlign: 'center' }}>
          Loading leaderboard...
        </div>
      ) : players.length === 0 ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '20px 0', textAlign: 'center' }}>
          {mode === 'season'
            ? 'No season games yet — finish a ranked duel to appear here.'
            : 'No players yet — be the first!'}
        </div>
      ) : (
        players.map((p, i) => {
          const col = COLORS[i] || '#666';
          const skillTag = mmrToSkillTag(p.mmr);
          const isMe = user ? p.id === user.id : (profile && p.gamer_tag === profile.gamer_tag);
          return (
            <div
              className="player-row"
              key={p.id || `${p.gamer_tag}-${i}`}
              style={isMe ? { background: 'rgba(201,255,0,.04)', margin: '0 -16px', padding: '9px 16px' } : undefined}
            >
              <div className="player-num" style={{ color: i < 3 ? col : 'var(--muted2)', fontWeight: 700 }}>{i + 1}</div>
              <PlayerAvatar profile={p} size={36} />
              <div className="player-info">
                <div className="player-tag" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <GamerTag profile={p} />
                  {isMe ? ' (You)' : ''}
                  <span className={`badge ${skillTagClass(skillTag)}`} style={{ fontSize: 10, padding: '2px 6px' }}>{skillTag}</span>
                </div>
                <div className="player-game">
                  {skillTag} · {mmrToRank(p.mmr ?? 1200)} · {p.main_game || '—'} · {p.platform || 'PC'}
                  {mode === 'season' && p.peak_mmr != null ? ` · peak ${p.peak_mmr}` : ''}
                </div>
              </div>
              <div className="player-mmr">{(p.mmr || 1200).toLocaleString()}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
