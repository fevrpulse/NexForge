import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { mmrToRank } from '../lib/ranks.js';
import { isBuiltinGame } from '../lib/games.js';

function statBits(st) {
  const bits = [];
  if (st.kills !== undefined) bits.push(`${st.kills}K/${st.deaths || 0}D${st.assists !== undefined ? `/${st.assists}A` : ''}`);
  if (st.kda) bits.push(`KDA ${st.kda}`);
  if (st.placement) bits.push(st.placement);
  if (st.goals !== undefined) bits.push(`${st.goals} goals`);
  if (st.score !== undefined && st.kills === undefined) bits.push(`Score ${st.score}`);
  if (st.damage) bits.push(`${st.damage.toLocaleString()} dmg`);
  if (st.mvp) bits.push('MVP ⭐');
  if (st.ace) bits.push('ACE 🔥');
  if (st.victory_royale) bits.push('Victory Royale 👑');
  if (st.chicken_dinner) bits.push('Winner 🍗');
  if (st.champion) bits.push('Champion 🏆');
  return bits.join(' · ');
}

export default function Profile() {
  const { user, profile, refreshProfile, showToast, gameCatalog, knownGames, syncCommunityGames } = useNexForge();
  const [matches, setMatches] = useState([]);
  const [editing, setEditing] = useState(false);
  const [gameChoice, setGameChoice] = useState(profile?.main_game || 'Valorant');
  const [isOther, setIsOther] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    sb.from('matches')
      .select('*')
      .eq('user_id', user.id)
      .order('played_at', { ascending: false })
      .limit(20)
      .then(({ data }) => { if (active) setMatches(data || []); })
      .catch(() => { if (active) setMatches([]); });
    return () => { active = false; };
  }, [user]);

  if (!profile) return null;

  function openEdit() {
    const game = profile.main_game || 'Valorant';
    if (knownGames.includes(game)) {
      setGameChoice(game);
      setIsOther(false);
      setCustomName('');
      setCustomDesc('');
    } else {
      setGameChoice('__other__');
      setIsOther(true);
      setCustomName(game);
      setCustomDesc(profile.main_game_description || '');
    }
    setEditing(true);
  }

  function onGameSelect(value) {
    setGameChoice(value);
    setIsOther(value === '__other__');
  }

  async function saveMainGame() {
    const game = isOther ? customName.trim() : gameChoice;
    const description = isOther ? (customDesc.trim() || null) : null;
    if (!game) {
      showToast('Enter your game name for Other.', 'error');
      return;
    }
    setSaving(true);
    const { error } = await sb.from('profiles')
      .update({ main_game: game, main_game_description: description })
      .eq('id', user.id);
    setSaving(false);
    if (error) {
      showToast(error.message || 'Could not save main game.', 'error');
      return;
    }
    await refreshProfile();
    if (isOther || !isBuiltinGame(game)) {
      const live = await syncCommunityGames(game);
      const unlocked = (live || []).some(
        (g) => String(g.name || '').toLowerCase() === game.toLowerCase(),
      );
      showToast(
        unlocked
          ? `${game} is now in the Community catalog for everyone.`
          : `Main game set to ${game}. It joins matchmaking when enough players pick it (5+).`,
        'success',
      );
    } else {
      showToast(`Main game updated to ${game}`, 'success');
    }
    setEditing(false);
  }

  const tag = profile.gamer_tag || 'Player';
  const total = (profile.wins || 0) + (profile.losses || 0);
  const wr = total > 0 ? `${Math.round((profile.wins / total) * 100)}%` : '—';
  const since = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '—';

  return (
    <div>
      <div className="profile-hero">
        <div className="profile-av">{tag.slice(0, 2).toUpperCase()}</div>
        <div>
          <div className="profile-name">{tag}</div>
          <div className="profile-sub">Member since {since} · {profile.platform || 'PC'} · {profile.main_game || '—'}</div>
          <div className="profile-tags">
            <span className="badge badge-neon">{mmrToRank(profile.mmr)}</span>
            <span className="badge badge-blue">{total} Matches</span>
            <span className="badge badge-muted">{profile.platform || 'PC'}</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Main Game</div>
        {!editing ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{profile.main_game || '—'}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', marginTop: 6, lineHeight: 1.5 }}>
                {profile.main_game_description || 'No description'}
              </div>
            </div>
            <button className="action-btn ghost" style={{ padding: '8px 14px', flexShrink: 0 }} onClick={openEdit}>
              Change
            </button>
          </div>
        ) : (
          <div>
            <div className="field">
              <label>Main Game</label>
              <select value={gameChoice} onChange={(e) => onGameSelect(e.target.value)}>
                {gameCatalog.map((group) => (
                  <optgroup label={group.category} key={group.category}>
                    {group.games.map((g) => <option value={g} key={g}>{g}</option>)}
                  </optgroup>
                ))}
                <optgroup label="Not listed">
                  <option value="__other__">Other — type your own</option>
                </optgroup>
              </select>
            </div>
            {isOther && (
              <>
                <div className="field">
                  <label>Game name</label>
                  <input
                    type="text" maxLength={60} placeholder="e.g. Deadlock, Helldivers 2"
                    value={customName} onChange={(e) => setCustomName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Description (optional)</label>
                  <textarea
                    maxLength={280} placeholder="What do you usually play — ranked, casual, role, etc."
                    value={customDesc} onChange={(e) => setCustomDesc(e.target.value)}
                  />
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="action-btn ghost full" onClick={() => setEditing(false)}>Cancel</button>
              <button className="action-btn primary full" onClick={saveMainGame} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat-card">
          <div className="stat-label">Total Wins</div>
          <div className="stat-val neon">{profile.wins || 0}</div>
          <div className="stat-sub">{total > 0 ? `${wr} win rate` : 'No matches yet'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Matches Played</div>
          <div className="stat-val">{total}</div>
          <div className="stat-sub">career total</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Current MMR</div>
          <div className="stat-val">{(profile.mmr || 1200).toLocaleString()}</div>
          <div className="stat-sub">Starting rank</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Match History</div>
        {matches.length > 0 ? (
          matches.map((m) => {
            const line = statBits(m.stats || {});
            return (
              <div key={m.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {m.game} <span style={{ fontWeight: 400, color: 'var(--muted2)', fontSize: 11 }}>· {m.mode}</span>
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted2)', marginTop: 2 }}>
                      {new Date(m.played_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {m.duration || '—'}
                    </div>
                  </div>
                  <div className={`result ${m.result === 'win' ? 'win' : 'loss'}`} style={{ flexShrink: 0, marginLeft: 8 }}>
                    {m.result === 'win' ? `WIN +${m.mmr_change}` : `LOSS ${m.mmr_change}`}
                  </div>
                </div>
                {line && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', background: 'var(--panel)', padding: '6px 10px', borderRadius: 6 }}>
                    {line}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '16px 0', textAlign: 'center' }}>
            No matches yet. Find your first match!
          </div>
        )}
      </div>
    </div>
  );
}
