import React, { useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { mmrToRank } from '../lib/ranks.js';
const RANKS = ['Any Rank', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
const PLATFORMS = ['Any Platform', 'PC', 'PS5', 'Xbox', 'Mobile'];
const COLORS = ['#3B7EFF', '#9B5CFF', '#4ade80', '#FF8C42', '#C9FF00'];

export default function Squad() {
  const { user, showToast, knownGames } = useNexForge();
  const [game, setGame] = useState('Any Game');
  const [rank, setRank] = useState('Any Rank');
  const [platform, setPlatform] = useState('Any Platform');
  const [players, setPlayers] = useState(null);
  const [searching, setSearching] = useState(false);

  async function searchSquad() {
    setSearching(true);
    setPlayers(null);
    try {
      let query = sb.from('profiles').select('gamer_tag,mmr,main_game,platform').limit(8);
      if (user?.id) query = query.neq('id', user.id);
      if (game !== 'Any Game') query = query.eq('main_game', game);
      if (platform !== 'Any Platform') query = query.eq('platform', platform);
      const { data, error } = await query;
      if (error) throw error;
      let results = data || [];
      if (rank !== 'Any Rank') {
        results = results.filter((p) => mmrToRank(p.mmr) === rank);
      }
      setPlayers(results);
    } catch (err) {
      showToast(err?.message || 'Could not search for squadmates.', 'error');
      setPlayers([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Find Squadmates</div>
        <div className="filter-row">
          <select value={game} onChange={(e) => setGame(e.target.value)}>
            <option>Any Game</option>
            {knownGames.map((g) => <option key={g}>{g}</option>)}
          </select>
          <select value={rank} onChange={(e) => setRank(e.target.value)}>
            {RANKS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <button className="action-btn primary full" onClick={searchSquad} disabled={searching}>
          {searching ? 'Searching…' : 'Search Players'}
        </button>
      </div>

      <div className="card">
        <div className="card-title">Players on NexForge</div>
        {players === null ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '16px 0', textAlign: 'center' }}>
            Search to find squadmates
          </div>
        ) : players.length === 0 ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '16px 0', textAlign: 'center' }}>
            No players found — invite friends to join NexForge!
          </div>
        ) : (
          players.map((p, i) => {
            const col = COLORS[i % COLORS.length];
            const init = (p.gamer_tag || '?').slice(0, 2).toUpperCase();
            return (
              <div className="player-row" key={`${p.gamer_tag}-${i}`}>
                <div className="player-av" style={{ background: `${col}22`, color: col }}>{init}</div>
                <div className="player-info">
                  <div className="player-tag">{p.gamer_tag}</div>
                  <div className="player-game">{p.main_game || '—'} · {p.platform || 'PC'} · {mmrToRank(p.mmr)}</div>
                </div>
                <button
                  className="action-btn ghost"
                  style={{ padding: '5px 12px', fontSize: 11 }}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(p.gamer_tag || '');
                      showToast(`Copied ${p.gamer_tag}`, 'success');
                    } catch {
                      showToast(p.gamer_tag || 'No tag', 'success');
                    }
                  }}
                >
                  Copy tag
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
