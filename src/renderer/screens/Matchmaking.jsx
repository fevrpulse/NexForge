import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import {
  modeMark, modesForGame,
  honestServerLabel,
} from '../lib/games.js';
import GameCatalogGrid from '../components/GameCatalogGrid.jsx';
import PartyPanel from '../components/PartyPanel.jsx';
import LobbyPanel from '../components/LobbyPanel.jsx';
import { friendQueueTarget, isVisibleOpenQueue, publicServerLabel } from '../lib/duels.js';

const STEP_LABELS = ['1 · Game', '2 · Queue', '3 · Details'];

export default function Matchmaking() {
  const { user, profile, showToast, setCloudOffline, reportCloudError, gameCatalog } = useNexForge();

  const [step, setStep] = useState(1);
  const [selectedGame, setSelectedGame] = useState(profile?.main_game || 'Valorant');
  const [gameQuery, setGameQuery] = useState('');

  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [server, setServer] = useState('');
  const [serverPlaceholder, setServerPlaceholder] = useState('Your lobby code, IP, or Discord voice channel');

  const [openQueues, setOpenQueues] = useState([]);
  const [myOpenDuel, setMyOpenDuel] = useState(null);
  const [myActiveDuel, setMyActiveDuel] = useState(null);
  const [posting, setPosting] = useState(false);
  const [finishingDuel, setFinishingDuel] = useState(false);

  const [duoOpen, setDuoOpen] = useState(false);
  const [duoResults, setDuoResults] = useState(null);
  const [duoSearching, setDuoSearching] = useState(false);
  const [duoStyle, setDuoStyle] = useState('Any');
  const [duoPlat, setDuoPlat] = useState('Any');
  const [queueLoadError, setQueueLoadError] = useState(null);
  const gameTouchedRef = useRef(false);

  const pollRef = useRef(null);
  const queueErrRef = useRef(null);

  const refreshDuels = useCallback(async () => {
    try {
      // Prefer RPC that auto-cancels open queues older than 5 minutes.
      let all = null;
      const { data: rpcData, error: rpcErr } = await sb.rpc('list_open_duels', { p_limit: 40 });
      if (!rpcErr && Array.isArray(rpcData)) {
        all = rpcData;
      } else {
        const { data, error } = await sb
          .from('duels')
          .select('*')
          .in('status', ['open', 'active'])
          .order('created_at', { ascending: false })
          .limit(40);
        if (error) throw error;
        const cutoff = Date.now() - 5 * 60 * 1000;
        all = (data || []).filter((d) => {
          if (d.status !== 'open') return true;
          const t = d.created_at ? new Date(d.created_at).getTime() : 0;
          return t >= cutoff;
        });
        // Best-effort: cancel my own stale open queue.
        if (user) {
          const staleMine = (data || []).find((d) => (
            d.status === 'open'
            && d.host_id === user.id
            && d.created_at
            && new Date(d.created_at).getTime() < cutoff
          ));
          if (staleMine) {
            await sb.rpc('cancel_duel', { p_duel_id: staleMine.id }).catch(() => {});
          }
        }
      }
      setCloudOffline(false);
      setQueueLoadError(null);
      queueErrRef.current = null;
      setOpenQueues(all.filter((d) => d.status === 'open' && isVisibleOpenQueue(d, user?.id)));
      if (user) {
        const { data: mine } = await sb.rpc('get_my_duel');
        if (mine && typeof mine === 'object') {
          setMyOpenDuel(mine.open || null);
          setMyActiveDuel(mine.active || null);
        } else {
          const mineOpen = all.find((d) => d.status === 'open' && d.host_id === user.id);
          const mineActive = all.find((d) => d.status === 'active' && (d.host_id === user.id || d.challenger_id === user.id));
          setMyOpenDuel(mineOpen || null);
          setMyActiveDuel(mineActive || null);
        }
      }
    } catch (err) {
      setQueueLoadError(err?.message || 'Could not refresh queues');
      if (!queueErrRef.current) {
        showToast(err?.message || 'Could not refresh open queues.', 'error');
      }
      queueErrRef.current = err?.message || 'error';
      await reportCloudError(err);
    }
  }, [user, setCloudOffline, reportCloudError, showToast]);

  useEffect(() => {
    if (gameTouchedRef.current) return;
    if (profile?.main_game) setSelectedGame(profile.main_game);
  }, [profile?.main_game]);

  useEffect(() => {
    refreshDuels();
    pollRef.current = setInterval(refreshDuels, 4000);
    return () => clearInterval(pollRef.current);
  }, [refreshDuels]);

  function selectGame(game) {
    gameTouchedRef.current = true;
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
    const duel = openQueues.find((d) => d.id === duelId);
    const intended = friendQueueTarget(duel?.server);
    if (intended && intended !== user.id) {
      showToast('That Friend Challenge is for someone else.', 'error');
      return;
    }
    try {
      const { data, error } = await sb.rpc('accept_duel', { p_duel_id: duelId });
      if (error) throw error;
      setMyActiveDuel(data);
      showToast(`Duel accepted vs ${data.host_tag}. Play, then close the duel when you are done.`, 'success');
      refreshDuels();
    } catch (err) {
      showToast(err?.message || 'Could not accept duel.', 'error');
    }
  }

  async function finishDuel() {
    if (!user || !myActiveDuel || finishingDuel) return;
    setFinishingDuel(true);
    try {
      const { error } = await sb.rpc('finish_duel', { p_duel_id: myActiveDuel.id });
      if (error) throw error;
      setMyActiveDuel(null);
      showToast('Duel closed', 'success');
      refreshDuels();
    } catch (err) {
      const msg = String(err?.message || '');
      showToast(
        /could not find the function|schema cache|404|not found|finish_duel/i.test(msg)
          ? 'Run v161-duel-close-tournament-proof.sql in Supabase to close duels without a winner.'
          : (err?.message || 'Could not close duel.'),
        'error',
      );
    } finally {
      setFinishingDuel(false);
    }
  }

  async function searchFnDuo() {
    setDuoSearching(true);
    setDuoResults(null);
    try {
      let query = sb.from('profiles')
        .select('id,gamer_tag,platform,main_game,custom_status,main_game_description')
        .eq('main_game', 'Fortnite')
        .neq('id', user?.id || '00000000-0000-0000-0000-000000000000')
        .limit(40);
      if (duoPlat !== 'Any') query = query.eq('platform', duoPlat);
      const { data, error } = await query;
      if (error) throw error;
      setCloudOffline(false);
      const style = duoStyle;
      const matchesStyle = (p) => {
        if (style === 'Any') return true;
        const blob = `${p.custom_status || ''} ${p.main_game_description || ''}`.toLowerCase();
        if (blob.includes(style.toLowerCase())) return true;
        if (style === 'Aggressive') return /aggro|w-?key|push/.test(blob);
        if (style === 'Passive') return /passive|rat|stealth/.test(blob);
        if (style === 'Builder') return /build|box|edit/.test(blob);
        return false;
      };
      const rows = (data || []).map((p) => ({ ...p, styleMatch: matchesStyle(p) }));
      const preferred = rows.filter((p) => p.styleMatch);
      const rest = rows.filter((p) => !p.styleMatch);
      setDuoResults({
        hint: style !== 'Any' && !preferred.length
          ? 'Nobody listed that play style yet — showing Fortnite players.'
          : null,
        players: [...preferred, ...rest].slice(0, 8),
      });
    } catch (err) {
      await reportCloudError(err);
      setDuoResults({ hint: err?.message || 'Could not search for duos.', players: [] });
    } finally {
      setDuoSearching(false);
    }
  }

  const modes = modesForGame(selectedGame);
  const colors = ['#C9FF00', '#3B7EFF', '#9B5CFF', '#4ade80', '#FF8C42', '#FF3D1F'];

  return (
    <div>
      <PartyPanel compact />
      <LobbyPanel game={selectedGame} mode={title} details={details} />
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
          <GameCatalogGrid
            catalog={gameCatalog}
            selected={selectedGame}
            onSelect={selectGame}
            query={gameQuery}
            onQueryChange={setGameQuery}
          />
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
              <div className="field-hint">Add your lobby code, IP, or Discord link so challengers can join.</div>
            </div>

            <div className="mm-details-meta" style={{ marginBottom: 18 }}>
              <span>Game · <b>{selectedGame}</b></span>
            </div>

            {duoOpen ? (
              <div id="fn-duo-finder">
                <div className="card-title" style={{ marginBottom: 10 }}>Find a duo partner</div>
                <div className="filter-row" style={{ marginBottom: 12 }}>
                  <select value={duoStyle} onChange={(e) => setDuoStyle(e.target.value)}>
                    <option>Any</option><option>Aggressive</option><option>Passive</option><option>Builder</option>
                  </select>
                  <select value={duoPlat} onChange={(e) => setDuoPlat(e.target.value)}>
                    <option>Any</option><option>PC</option><option>PS5</option><option>Xbox</option>
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
                  ) : duoResults && duoResults.players?.length === 0 ? (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted2)', textAlign: 'center', padding: '20px 0', lineHeight: 1.5 }}>
                      {duoResults.hint || 'No real players found yet. Invite friends to NexForge or open a public duel queue.'}
                    </div>
                  ) : duoResults?.players ? (
                    <>
                      {duoResults.hint && (
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', marginBottom: 10, lineHeight: 1.45 }}>
                          {duoResults.hint}
                        </div>
                      )}
                    {duoResults.players.map((p, i) => {
                      const col = colors[i % colors.length];
                      const init = (p.gamer_tag || '?').slice(0, 2).toUpperCase();
                      return (
                        <div key={p.id || p.gamer_tag} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--panel)', borderRadius: 10, marginBottom: 8, border: '1px solid var(--border)' }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${col}22`, color: col, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                            {init}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                              <span style={{ fontSize: 13, fontWeight: 700 }}>{p.gamer_tag}</span>
                            </div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted2)' }}>
                              {p.platform || 'PC'}
                              {p.styleMatch && duoStyle !== 'Any' ? ` · ${duoStyle}` : ''}
                            </div>
                          </div>
                          <button className="action-btn ghost" style={{ padding: '5px 12px', fontSize: 11 }}
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(p.gamer_tag || '');
                                showToast(`Copied ${p.gamer_tag}`, 'success');
                              } catch {
                                showToast(p.gamer_tag || 'No tag', 'success');
                              }
                            }}>
                            Copy tag
                          </button>
                        </div>
                      );
                    })}
                    </>
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
                    <span className="mm-timer">
                      Waiting for challenger
                      {myOpenDuel.created_at ? (() => {
                        const left = Math.max(
                          0,
                          Math.ceil((new Date(myOpenDuel.created_at).getTime() + 5 * 60 * 1000 - Date.now()) / 1000),
                        );
                        const m = Math.floor(left / 60);
                        const s = String(left % 60).padStart(2, '0');
                        return ` · ${m}:${s} left`;
                      })() : '…'}
                    </span>
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
            {publicServerLabel(myActiveDuel.server) && <><br />Server {publicServerLabel(myActiveDuel.server)}</>}
            {myActiveDuel.details && <><br />{myActiveDuel.details}</>}
          </div>
          <div className="field-hint" style={{ margin: '0 0 12px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', lineHeight: 1.5 }}>
            No winner is recorded. Close this when you are done playing.
          </div>
          <button className="action-btn primary full" onClick={finishDuel} disabled={finishingDuel}>
            {finishingDuel ? 'Closing…' : 'Close duel'}
          </button>
        </div>
      )}

      <div className="card">
        <div className="card-title">Open Queues</div>
        {queueLoadError ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)', padding: '12px 0', textAlign: 'center' }}>
            Could not refresh queues. {queueLoadError}
          </div>
        ) : openQueues.length === 0 ? (
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
                    Host {d.host_tag || 'Player'}<br />
                    {d.details && <>{d.details}<br /></>}
                    {publicServerLabel(d.server) && <>Server {publicServerLabel(d.server)} · </>}{when}
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
