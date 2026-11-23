import React, { useCallback, useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { mmrToRank, mmrToSkillTag, skillTagClass } from '../lib/ranks.js';
import PlayerAvatar, { GamerTag } from '../components/PlayerAvatar.jsx';

const COLORS = ['#C9FF00', '#3B7EFF', '#FF8C42', '#4ade80', '#9B5CFF'];

const PROFILE_COLS = 'id,gamer_tag,display_name,mmr,main_game,platform,avatar_path,avatar_preset,equipped_frame,equipped_banner,equipped_nameplate';

export default function Leaderboard() {
  const { user, profile, guestMode, setCloudOffline, reportCloudError, activeSeason } = useNexForge();
  const [mode, setMode] = useState('season'); // 'season' | 'lifetime' | 'friends'
  const [players, setPlayers] = useState(null);

  const load = useCallback(async () => {
    try {
      if (mode === 'friends') {
        if (!user || guestMode) {
          setCloudOffline(false);
          setPlayers([]);
          return;
        }
        const { data: rows, error: fErr } = await sb
          .from('friendships')
          .select('requester_id,addressee_id,status')
          .eq('status', 'accepted');
        if (fErr) throw fErr;
        const ids = [...new Set((rows || []).map((r) => (
          r.requester_id === user.id ? r.addressee_id : r.requester_id
        )).filter(Boolean))];
        if (!ids.length) {
          setCloudOffline(false);
          setPlayers([]);
          return;
        }
        ids.push(user.id);
        const { data, error } = await sb
          .from('profiles')
          .select(PROFILE_COLS)
          .in('id', ids);
        if (error) throw error;
        setCloudOffline(false);
        setPlayers(
          [...(data || [])].sort((a, b) => (b.mmr ?? 1200) - (a.mmr ?? 1200)),
        );
        return;
      }
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
        .select(PROFILE_COLS)
        .order('mmr', { ascending: false })
        .limit(10);
      if (error) throw error;
      setCloudOffline(false);
      setPlayers(data || []);
    } catch (err) {
      await reportCloudError(err);
      setPlayers([]);
    }
  }, [mode, user, guestMode, setCloudOffline, reportCloudError]);

  useEffect(() => {
    setPlayers(null);
    load();
  }, [load]);

  const seasonName = activeSeason?.name || 'Season';

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          {mode === 'friends'
            ? 'Friends'
            : mode === 'season'
              ? `Top Players — ${seasonName}`
              : 'Top Players — Lifetime'}
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
            <button
              type="button"
              className={`lb-mode-btn ${mode === 'friends' ? 'active' : ''}`}
              onClick={() => setMode('friends')}
            >
              Friends
            </button>
          </div>
          <button className="mm-back" style={{ marginBottom: 0 }} onClick={load}>↻ Refresh</button>
        </div>
      </div>
      {mode === 'season' && (
        <div className="lb-season-hint">
          Ranked duel wins and losses this season.
        </div>
      )}
      {mode === 'friends' && (
        <div className="lb-season-hint">
          You and your accepted friends.
        </div>
      )}
      {players === null ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '20px 0', textAlign: 'center' }}>
          Loading leaderboard...
        </div>
      ) : players.length === 0 ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '20px 0', textAlign: 'center' }}>
          {mode === 'friends'
            ? (!user || guestMode
              ? 'Sign in to see how you rank against friends.'
              : 'No friends yet — add people from the Friends tab.')
            : mode === 'season'
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
