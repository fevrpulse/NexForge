import React, { useCallback, useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { mmrToRank, mmrToSkillTag, skillTagClass } from '../lib/ranks.js';
import PlayerAvatar, { GamerTag } from '../components/PlayerAvatar.jsx';

const COLORS = ['#C9FF00', '#3B7EFF', '#FF8C42', '#4ade80', '#9B5CFF'];

export default function Leaderboard() {
  const { user, profile, setCloudOffline, reportCloudError, activeSeason, clan } = useNexForge();
  const [mode, setMode] = useState('season'); // 'season' | 'lifetime' | 'clans'
  const [players, setPlayers] = useState(null);
  const [clans, setClans] = useState(null);

  const load = useCallback(async () => {
    try {
      if (mode === 'clans') {
        const { data, error } = await sb.rpc('get_clan_leaderboard', { p_limit: 20 });
        if (error) throw error;
        setCloudOffline(false);
        setClans(Array.isArray(data?.clans) ? data.clans : []);
        setPlayers([]);
        return;
      }
      setClans(null);
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
        .select('id,gamer_tag,mmr,main_game,platform,avatar_path,avatar_preset,equipped_frame,equipped_banner,equipped_nameplate,clan_tag')
        .order('mmr', { ascending: false })
        .limit(10);
      if (error) throw error;
      setCloudOffline(false);
      setPlayers(data || []);
    } catch (err) {
      await reportCloudError(err);
      setPlayers([]);
      setClans([]);
    }
  }, [mode, setCloudOffline, reportCloudError]);

  useEffect(() => {
    setPlayers(null);
    setClans(null);
    load();
  }, [load]);

  const seasonName = activeSeason?.name || 'Season';

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          {mode === 'clans'
            ? 'Top Clans — Total MMR'
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
              className={`lb-mode-btn ${mode === 'clans' ? 'active' : ''}`}
              onClick={() => setMode('clans')}
            >
              Clans
            </button>
          </div>
          <button className="mm-back" style={{ marginBottom: 0 }} onClick={load}>↻ Refresh</button>
        </div>
      </div>
      {mode === 'season' && (
        <div className="lb-season-hint">
          Ranked duel wins/losses this season (±15 MMR). Lifetime cosmetics unlocks still use career MMR.
        </div>
      )}
      {mode === 'clans' && (
        <div className="lb-season-hint">
          Clans ranked by sum of members&apos; career MMR. Higher clan rank boosts weekly Forge Coin rewards.
        </div>
      )}
      {mode === 'clans' ? (
        clans === null ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '20px 0', textAlign: 'center' }}>
            Loading clan leaderboard...
          </div>
        ) : clans.length === 0 ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '20px 0', textAlign: 'center' }}>
            No clans yet — create one from the Clans tab.
          </div>
        ) : (
          clans.map((c, i) => {
            const col = COLORS[i] || '#666';
            const isMine = clan?.id && c.id === clan.id;
            return (
              <div
                className="player-row"
                key={c.id}
                style={isMine ? { background: 'rgba(201,255,0,.04)', margin: '0 -16px', padding: '9px 16px' } : undefined}
              >
                <div className="player-num" style={{ color: i < 3 ? col : 'var(--muted2)', fontWeight: 700 }}>
                  {c.rank || i + 1}
                </div>
                <div className="player-av" style={{ background: 'rgba(201,255,0,.12)', color: 'var(--neon)', fontSize: 11 }}>
                  {String(c.tag || '??').slice(0, 3)}
                </div>
                <div className="player-info">
                  <div className="player-tag">
                    <span className="clan-tag-prefix">[{c.tag}]</span> {c.name}
                    {isMine ? ' (Yours)' : ''}
                  </div>
                  <div className="player-game">
                    {c.member_count || 0} members
                    {(c.min_mmr || 0) > 0 ? ` · ${c.min_mmr}+ MMR req` : ''}
                  </div>
                </div>
                <div className="player-mmr">{Number(c.total_mmr || 0).toLocaleString()}</div>
              </div>
            );
          })
        )
      ) : players === null ? (
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
