import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import {
  gameMark, modeMark, modesForGame,
  honestServerLabel, isShooterGame,
} from '../lib/games.js';

const STEP_LABELS = ['1 · Game', '2 · Queue', '3 · Details'];

function CombatInputs({ values, onChange }) {
  return (
    <div className="field" style={{ marginBottom: 10 }}>
      <label>Your K / D / A</label>
      <div className="combat-stat-grid">
        <input type="number" min={0} step={1} placeholder="K" value={values.kills}
          onChange={(e) => onChange({ ...values, kills: e.target.value })} />
        <input type="number" min={0} step={1} placeholder="D" value={values.deaths}
          onChange={(e) => onChange({ ...values, deaths: e.target.value })} />
        <input type="number" min={0} step={1} placeholder="A" value={values.assists}
          onChange={(e) => onChange({ ...values, assists: e.target.value })} />
      </div>
      <div className="field-hint" style={{ marginTop: 8 }}>
        Optional — enter your scoreboard line so kills and assists count toward Analytics.
      </div>
    </div>
  );
}

function readCombat(values) {
  const rawK = (values.kills ?? '').toString().trim();
  const rawD = (values.deaths ?? '').toString().trim();
  const rawA = (values.assists ?? '').toString().trim();
  if (!rawK && !rawD && !rawA) return { ok: true, stats: null };
  if (!rawK || !rawD || !rawA) {
    return { ok: false, error: 'Enter kills, deaths, and assists together (or leave all blank).' };
  }
  const kills = parseInt(rawK, 10);
  const deaths = parseInt(rawD, 10);
  const assists = parseInt(rawA, 10);
  if (![kills, deaths, assists].every((n) => Number.isFinite(n) && n >= 0)) {
    return { ok: false, error: 'Combat stats must be non-negative numbers.' };
  }
  return { ok: true, stats: { kills, deaths, assists } };
}

export default function Matchmaking() {
  const { user, profile, showToast, setCloudOffline, gameCatalog } = useNexForge();

  const [step, setStep] = useState(1);
  const [selectedGame, setSelectedGame] = useState(profile?.main_game || 'Valorant');

  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [server, setServer] = useState('');
  const [serverPlaceholder, setServerPlaceholder] = useState('Your lobby code, IP, or Discord voice channel');

  const [openQueues, setOpenQueues] = useState([]);
  const [myOpenDuel, setMyOpenDuel] = useState(null);
  const [myActiveDuel, setMyActiveDuel] = useState(null);
  const [posting, setPosting] = useState(false);
  const [winnerPick, setWinnerPick] = useState('');
  const [combat, setCombat] = useState({ kills: '', deaths: '', assists: '' });
  const [submittingWinner, setSubmittingWinner] = useState(false);

  const [duoOpen, setDuoOpen] = useState(false);
  const [duoResults, setDuoResults] = useState(null);
  const [duoSearching, setDuoSearching] = useState(false);
  const [duoSkill, setDuoSkill] = useState('Any');
  const [duoStyle, setDuoStyle] = useState('Any');
  const [duoPlat, setDuoPlat] = useState('PC');

  const pollRef = useRef(null);

  const refreshDuels = useCallback(async () => {
    try {
      const { data, error } = await sb
        .from('duels')
        .select('*')
        .in('status', ['open', 'active'])
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) throw error;
      setCloudOffline(false);
      const all = data || [];
      setOpenQueues(all.filter((d) => d.status === 'open'));
      if (user) {
        const mineOpen = all.find((d) => d.status === 'open' && d.host_id === user.id);
        const mineActive = all.find((d) => d.status === 'active' && (d.host_id === user.id || d.challenger_id === user.id));
        setMyOpenDuel(mineOpen || null);
        setMyActiveDuel(mineActive || null);
      }
    } catch (err) {
      setCloudOffline(true, err?.message || err);
    }
  }, [user, setCloudOffline]);

  useEffect(() => {
    refreshDuels();
    pollRef.current = setInterval(refreshDuels, 4000);
    return () => clearInterval(pollRef.current);
  }, [refreshDuels]);

  useEffect(() => {
    if (myActiveDuel) {
      const mine = user && myActiveDuel.host_id === user.id ? myActiveDuel.host_winner_pick : myActiveDuel.challenger_winner_pick;
      setWinnerPick(mine || '');
    }
  }, [myActiveDuel, user]);

  function selectGame(game) {
    setSelectedGame(game);
    setStep(2);
  }

  function fillQueueForm(modeTitle, modeDetails, modeServer) {
    setTitle(modeTitle);
    setDetails(modeDetails || '');
    const hint = honestServerLabel(modeServer);
    if (hint.startsWith('Player-hosted')) {
      setServer('');
      setServerPlaceholder('Your lobby code, IP, or Discord link');
    } else {
      setServer(modeServer || '');
      setServerPlaceholder(modeServer || '');
    }
  }

  function selectQueueMode(mode) {
    fillQueueForm(mode.name, mode.details || mode.desc, mode.server);
    if (selectedGame === 'Fortnite' && mode.name === 'Tournament Duo') {
      setDuoOpen(true);
    } else {
      setDuoOpen(false);
    }
    setStep(3);
  }

  function selectCustomQueue() {
    setDuoOpen(false);
    setTitle('');
    setDetails('');
    setServer('');
    setServerPlaceholder('Your lobby code, IP, or Discord link');
    setStep(3);
  }

  async function postQueue() {
    if (!user || !profile) {
      showToast('Sign in to post a queue.', 'error');
      return;
    }
    if (myOpenDuel) {
      await cancelQueue();
      return;
    }
    if (myActiveDuel) {
      showToast('Finish or wait on your active duel before posting another queue.', 'error');
      return;
    }
    if (!title.trim()) {
      showToast('Enter a queue title before posting.', 'error');
      return;
    }

    setPosting(true);
    try {
      const { data, error } = await sb.from('duels').insert({
        host_id: user.id,
        host_tag: profile.gamer_tag || 'Player',
        host_mmr: profile.mmr || 1200,
        game: selectedGame,
        mode: title.trim(),
        details: details.trim() || null,
        server: server.trim() || null,
        status: 'open',
      }).select('*').single();
      if (error) throw error;
      setMyOpenDuel(data);
      showToast('Queue posted — waiting for someone to accept.', 'success');
      refreshDuels();
    } catch (err) {
      showToast(err?.message || 'Could not post queue. Run duels.sql in Supabase.', 'error');
    } finally {
      setPosting(false);
    }
  }

  async function cancelQueue() {
    if (!myOpenDuel) return;
    try {
      const { error } = await sb.rpc('cancel_duel', { p_duel_id: myOpenDuel.id });
      if (error) throw error;
      setMyOpenDuel(null);
      showToast('Queue cancelled.', 'success');
      refreshDuels();
    } catch (err) {
      showToast(err?.message || 'Could not cancel queue.', 'error');
    }
  }

  async function acceptDuel(duelId) {
    if (!user || !profile) return;
    if (myOpenDuel || myActiveDuel) {
      showToast('Cancel your open queue or finish your active duel first.', 'error');
      return;
    }
    try {
      const { data, error } = await sb.rpc('accept_duel', { p_duel_id: duelId });
      if (error) throw error;
      setMyActiveDuel(data);
      showToast(`Duel accepted vs ${data.host_tag}. Play, then both pick the winner.`, 'success');
      refreshDuels();
    } catch (err) {
      showToast(err?.message || 'Could not accept duel.', 'error');
    }
  }

  async function submitWinner() {
    if (!user || !myActiveDuel) return;
    if (!winnerPick) {
      showToast('Select who won.', 'error');
      return;
    }
    const combatResult = readCombat(combat);
    if (!combatResult.ok) {
      showToast(combatResult.error, 'error');
      return;
    }

    setSubmittingWinner(true);
    try {
      const rpcArgs = { p_duel_id: myActiveDuel.id, p_winner_id: winnerPick };
      if (combatResult.stats) {
        rpcArgs.p_kills = combatResult.stats.kills;
        rpcArgs.p_deaths = combatResult.stats.deaths;
        rpcArgs.p_assists = combatResult.stats.assists;
      }
      const { data, error } = await sb.rpc('submit_duel_winner', rpcArgs);
      if (error) throw error;

      if (data.status === 'completed') {
        setMyActiveDuel(null);
        setCombat({ kills: '', deaths: '', assists: '' });
        const iWon = data.winner_id === user.id;
        showToast(iWon ? `WIN +${data.mmr_change || 15} MMR` : `LOSS -${data.mmr_change || 15} MMR`, iWon ? 'success' : 'error');
      } else if (!data.host_winner_pick && !data.challenger_winner_pick) {
        setMyActiveDuel(data);
        showToast('Results do not match — both players must select the same winner.', 'error');
      } else {
        setMyActiveDuel(data);
        showToast('Result submitted — waiting for opponent to confirm the same winner.', 'success');
      }
      refreshDuels();
    } catch (err) {
      showToast(err?.message || 'Could not submit result.', 'error');
    } finally {
      setSubmittingWinner(false);
    }
  }

  async function searchFnDuo() {
    setDuoSearching(true);
    setDuoResults(null);
    try {
      const { data, error } = await sb.from('profiles')
        .select('gamer_tag,mmr,platform,main_game,wins')
        .neq('id', user?.id || '00000000-0000-0000-0000-000000000000')
        .limit(8);
      if (error) throw error;
      setCloudOffline(false);
      setDuoResults(data || []);
    } catch (err) {
      setCloudOffline(true, err?.message || err);
      setDuoResults([]);
    } finally {
      setDuoSearching(false);
    }
  }

  const modes = modesForGame(selectedGame);
  const shooter = isShooterGame(selectedGame);
  const colors = ['#C9FF00', '#3B7EFF', '#9B5CFF', '#4ade80', '#FF8C42', '#FF3D1F'];

  return (
    <div>
      <div className="mm-steps">
        {STEP_LABELS.map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 && <span className="mm-step-div">—</span>}
            <span className={`mm-step-label ${step === i + 1 ? 'active' : ''}`}>{label}</span>
            <span className={`mm-step-dot ${step === i + 1 ? 'active' : ''} ${step > i + 1 ? 'done' : ''}`} />
          </React.Fragment>
        ))}
      </div>

      {step === 1 && (
        <div className="mm-step active">
          <div className="card-title">Select a game to queue for</div>
          <div className="game-grid">
            {gameCatalog.flatMap((group) =>
              group.games.map((game) => (
                <div
                  key={game}
                  className={`game-card ${selectedGame === game ? 'selected' : ''}`}
                  onClick={() => selectGame(game)}
                >
                  <div className="game-icon">{gameMark(game)}</div>
                  <div className="game-name">{game}</div>
                  <div className="game-cat">{group.category}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mm-step active">
          <button className="mm-back" onClick={() => setStep(1)}>← Change game</button>
          <div className="card-title">Select a queue · <span style={{ color: 'var(--neon)' }}>{selectedGame}</span></div>
          <div className="mode-grid">
            {modes.map((m) => (
              <div className="mode-card" key={m.name} onClick={() => selectQueueMode(m)}>
                <div className="mode-icon">{modeMark(m.name)}</div>
                <div className="mode-name">{m.name}</div>
                <div className="mode-desc">{m.desc}</div>
              </div>
            ))}
            <div className="mode-card" onClick={selectCustomQueue}>
              <div className="mode-icon">EDIT</div>
              <div className="mode-name">Custom Queue</div>
              <div className="mode-desc">Type your own title, details, and server address.</div>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mm-step active">
          <button className="mm-back" onClick={() => setStep(2)}>← Change queue</button>
          <div className="mm-box mm-form">
            <div className="card-title" style={{ marginBottom: 16 }}>Configure your queue</div>

            <div className="field">
              <label>Queue Title</label>
              <input type="text" maxLength={60} placeholder="e.g. Ranked 5v5, Creative 1v1, Weekend Scrim"
                value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="field">
              <label>Details</label>
              <textarea placeholder="Describe the match format, rules, skill level, or anything players need to know before joining."
                value={details} onChange={(e) => setDetails(e.target.value)} />
            </div>

            <div className="field">
              <label>Server IP / Address (optional)</label>
              <input type="text" maxLength={120} placeholder={serverPlaceholder}
                value={server} onChange={(e) => setServer(e.target.value)} />
              <div className="field-hint">Queues are player-hosted / self-organized — NexForge does not run game servers.</div>
              <div className="field-hint">Leave blank if NexForge hosts the lobby for you.</div>
            </div>

            <div className="mm-details-meta" style={{ marginBottom: 18 }}>
              <span>Game · <b>{selectedGame}</b></span>
            </div>

            {duoOpen ? (
              <div id="fn-duo-finder">
                <div className="card-title" style={{ marginBottom: 10 }}>Find a duo partner</div>
                <div className="filter-row" style={{ marginBottom: 12 }}>
                  <select value={duoSkill} onChange={(e) => setDuoSkill(e.target.value)}>
                    <option>Any</option><option>Casual</option><option>Competitive</option><option>Pro</option>
                  </select>
                  <select value={duoStyle} onChange={(e) => setDuoStyle(e.target.value)}>
                    <option>Any</option><option>Aggressive</option><option>Passive</option><option>Builder</option>
                  </select>
                  <select value={duoPlat} onChange={(e) => setDuoPlat(e.target.value)}>
                    <option>PC</option><option>PS5</option><option>Xbox</option>
                  </select>
                </div>
                <button className="action-btn primary full" onClick={searchFnDuo} disabled={duoSearching}>
                  {duoSearching ? 'Searching…' : 'Search for Duo'}
                </button>
                <div style={{ marginTop: 12 }}>
                  {duoSearching ? (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', textAlign: 'center', padding: '12px 0' }}>
                      Searching for duo partners...
                    </div>
                  ) : duoResults && duoResults.length === 0 ? (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted2)', textAlign: 'center', padding: '20px 0', lineHeight: 1.5 }}>
                      No real players found yet. Invite friends to NexForge or open a public duel queue.
                    </div>
                  ) : duoResults ? (
                    duoResults.map((p, i) => {
                      const col = colors[i % colors.length];
                      const init = (p.gamer_tag || '?').slice(0, 2).toUpperCase();
                      return (
                        <div key={p.gamer_tag} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--panel)', borderRadius: 10, marginBottom: 8, border: '1px solid var(--border)' }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${col}22`, color: col, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                            {init}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                              <span style={{ fontSize: 13, fontWeight: 700 }}>{p.gamer_tag}</span>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--neon)22', color: 'var(--neon)' }}>
                                {p.mmr || 1200} MMR
                              </span>
                            </div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted2)' }}>{duoStyle} · {p.platform || 'PC'}</div>
                          </div>
                          <button className="action-btn primary" style={{ padding: '5px 12px', fontSize: 11 }}
                            onClick={() => showToast(`Duo request sent to ${p.gamer_tag}. They'll get notified.`, 'success')}>
                            Invite
                          </button>
                        </div>
                      );
                    })
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="mm-box-actions">
                <button className="action-btn primary" onClick={postQueue} disabled={posting}>
                  {myOpenDuel ? 'Cancel Queue' : posting ? 'Posting…' : 'Post Open Queue'}
                </button>
                {myOpenDuel && (
                  <div className="dots show">
                    <div className="dot" /><div className="dot" /><div className="dot" />
                    <span className="mm-timer">Waiting for challenger…</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {myActiveDuel && (
        <div className="duel-active-box">
          <div className="card-title" style={{ marginBottom: 8 }}>Active Duel</div>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{myActiveDuel.mode || 'Duel'} · {myActiveDuel.game}</div>
          <div className="duel-meta" style={{ marginBottom: 14 }}>
            {myActiveDuel.host_tag} vs {myActiveDuel.challenger_tag || '—'}
            {myActiveDuel.server && <><br />Server {myActiveDuel.server}</>}
            {myActiveDuel.details && <><br />{myActiveDuel.details}</>}
          </div>
          <div className="field">
            <label>Who won? (both players must pick the same winner)</label>
            <select value={winnerPick} onChange={(e) => setWinnerPick(e.target.value)}>
              <option value="">Select winner…</option>
              <option value={myActiveDuel.host_id}>{myActiveDuel.host_tag} ({myActiveDuel.host_mmr || 1200} MMR)</option>
              <option value={myActiveDuel.challenger_id}>{myActiveDuel.challenger_tag || 'Challenger'} ({myActiveDuel.challenger_mmr || 1200} MMR)</option>
            </select>
          </div>
          {shooter && <CombatInputs values={combat} onChange={setCombat} />}
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted2)', margin: '8px 0 12px', lineHeight: 1.5 }}>
            Only the two players in this duel can report the result.
          </div>
          <button className="action-btn primary full" onClick={submitWinner} disabled={submittingWinner}>
            {submittingWinner ? 'Submitting…' : 'Submit Result'}
          </button>
        </div>
      )}

      <div className="card">
        <div className="card-title">Open Queues</div>
        {openQueues.length === 0 ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', padding: '12px 0', textAlign: 'center' }}>
            No open queues right now — post one and wait for a challenger.
          </div>
        ) : (
          openQueues.map((d) => {
            const isMine = user && d.host_id === user.id;
            const when = d.created_at ? new Date(d.created_at).toLocaleTimeString() : '';
            return (
              <div className="duel-row" key={d.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="duel-title">{d.mode || 'Open Queue'} · {d.game}</div>
                  <div className="duel-meta">
                    Host {d.host_tag || 'Player'} · {d.host_mmr || 1200} MMR<br />
                    {d.details && <>{d.details}<br /></>}
                    {d.server && <>Server {d.server} · </>}{when}
                  </div>
                </div>
                <div className="duel-actions">
                  {isMine ? (
                    <button className="action-btn danger" style={{ padding: '8px 12px' }} onClick={cancelQueue}>Cancel</button>
                  ) : (
                    <button className="action-btn primary" style={{ padding: '8px 12px' }} onClick={() => acceptDuel(d.id)}>Accept Duel</button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
