import React, { useEffect, useMemo, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';

function secondsLeft(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 1000));
}

/** My Lobby card — find/fill player-hosted lobbies (no game servers). */
export default function LobbyPanel({ game, mode, details }) {
  const { user, party, showToast, reportCloudError } = useNexForge();
  const [lobby, setLobby] = useState(null);
  const [busy, setBusy] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [tick, setTick] = useState(0);

  const me = useMemo(() => {
    if (!lobby?.members || !user) return null;
    return lobby.members.find((m) => m.user_id === user.id) || null;
  }, [lobby, user]);

  const isHost = lobby && user && lobby.host_id === user.id;
  const partyReady = party?.my_status === 'joined' && party?.status === 'ready';
  const isPartyHost = partyReady && party?.host_id === user?.id;

  async function refresh() {
    if (!user) {
      setLobby(null);
      return;
    }
    try {
      const { data, error } = await sb.rpc('get_my_lobby');
      if (error) throw error;
      setLobby(data || null);
      if (data?.lobby_code) setCodeDraft(data.lobby_code);
    } catch (err) {
      console.warn('get_my_lobby failed', err);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [user?.id]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  async function run(action, okMsg) {
    if (busy) return;
    setBusy(true);
    try {
      const data = await action();
      if (data && data.id) setLobby(data);
      else await refresh();
      if (okMsg) showToast(okMsg, 'success');
    } catch (err) {
      showToast(err?.message || 'Lobby action failed.', 'error');
      await reportCloudError(err);
    } finally {
      setBusy(false);
    }
  }

  function inferTargetSize() {
    const t = String(mode || '').toLowerCase();
    if (t.includes('5v5') || t.includes('5 v 5')) return 10;
    if (t.includes('3v3') || t.includes('trios')) return 6;
    if (t.includes('2v2') || t.includes('duo') || t.includes('doubles')) return 4;
    if (t.includes('1v1') || t.includes('duel')) return 2;
    return 2;
  }

  async function findLobby(asParty) {
    if (!game || !mode?.trim()) {
      showToast('Pick a game and queue title first.', 'error');
      return;
    }
    await run(async () => {
      const { data, error } = await sb.rpc('join_lobby_queue', {
        p_game: game,
        p_mode: mode.trim(),
        p_details: details?.trim() || null,
        p_target_size: inferTargetSize(),
        p_as_party: !!asParty,
      });
      if (error) throw error;
      return data;
    }, asParty ? 'Party queued for lobby' : 'Searching for lobby…');
  }

  if (!user) return null;

  const codeSec = secondsLeft(lobby?.code_deadline_at);
  const readySec = secondsLeft(lobby?.ready_deadline_at);
  void tick;

  return (
    <div className={`card lobby-panel ${lobby?.status === 'live' ? 'lobby-live' : ''}`}>
      <div className="lobby-panel-head">
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>Match Lobby</div>
          <div className="lobby-panel-sub">
            Auto-match by MMR · you host the in-game lobby code
          </div>
        </div>
      </div>

      {!lobby ? (
        <div className="lobby-panel-actions">
          <button
            type="button"
            className="action-btn primary"
            disabled={busy}
            onClick={() => findLobby(false)}
          >
            Find Lobby (Solo)
          </button>
          <button
            type="button"
            className="action-btn ghost"
            disabled={busy || !isPartyHost}
            title={
              !partyReady
                ? 'Party must be fully ready'
                : !isPartyHost
                  ? 'Only the party host can queue'
                  : 'Queue your ready party together'
            }
            onClick={() => findLobby(true)}
          >
            Find Lobby (Party)
          </button>
        </div>
      ) : (
        <>
          <div className="lobby-status-row">
            <span className={`lobby-status-pill status-${lobby.status}`}>{lobby.status}</span>
            <span className="lobby-panel-sub">
              {lobby.game} · {lobby.mode} · {lobby.member_count}/{lobby.target_size}
              {' · '}MMR {lobby.mmr_min}–{lobby.mmr_max}
            </span>
          </div>

          {(lobby.status === 'forming' || lobby.status === 'open') && codeSec != null && lobby.status === 'forming' && (
            <div className="lobby-timer">Host: paste lobby code · {codeSec}s</div>
          )}
          {lobby.status === 'ready' && readySec != null && (
            <div className="lobby-timer">Ready up · {readySec}s</div>
          )}

          {lobby.lobby_code && (
            <div className="lobby-code-display">
              Code · <b>{lobby.lobby_code}</b>
            </div>
          )}

          <div className="lobby-member-list">
            {(lobby.members || []).map((m) => (
              <div className="lobby-member-row" key={m.user_id}>
                <span className="lobby-member-tag">
                  {m.gamer_tag}
                  {m.user_id === lobby.host_id ? ' · host' : ''}
                </span>
                <span className={`lobby-member-ready ${m.ready ? 'on' : ''}`}>
                  {m.ready ? 'Ready' : 'Waiting'} · {m.mmr_snapshot}
                </span>
              </div>
            ))}
          </div>

          {isHost && (lobby.status === 'forming' || lobby.status === 'open' || lobby.status === 'ready') && (
            <div className="lobby-code-form">
              <input
                type="text"
                maxLength={120}
                placeholder="In-game lobby code / IP / Discord"
                value={codeDraft}
                onChange={(e) => setCodeDraft(e.target.value)}
              />
              <button
                type="button"
                className="action-btn primary"
                disabled={busy || !codeDraft.trim()}
                onClick={() => run(async () => {
                  const { data, error } = await sb.rpc('set_lobby_code', {
                    p_code: codeDraft.trim(),
                  });
                  if (error) throw error;
                  return data;
                }, 'Lobby code shared')}
              >
                Share Code
              </button>
            </div>
          )}

          <div className="lobby-panel-actions">
            {(lobby.status === 'ready' || lobby.status === 'live' || lobby.status === 'forming') && lobby.lobby_code && (
              <button
                type="button"
                className={`action-btn ${me?.ready ? 'ghost' : 'primary'}`}
                disabled={busy}
                onClick={() => run(async () => {
                  const { data, error } = await sb.rpc('set_lobby_ready', {
                    p_ready: !me?.ready,
                  });
                  if (error) throw error;
                  return data;
                })}
              >
                {me?.ready ? 'Unready' : 'Ready'}
              </button>
            )}
            {isHost ? (
              <button
                type="button"
                className="action-btn ghost"
                disabled={busy}
                onClick={() => run(async () => {
                  const { data, error } = await sb.rpc('cancel_lobby');
                  if (error) throw error;
                  setLobby(null);
                  return data;
                }, 'Lobby cancelled')}
              >
                Cancel Lobby
              </button>
            ) : (
              <button
                type="button"
                className="action-btn ghost"
                disabled={busy}
                onClick={() => run(async () => {
                  const { data, error } = await sb.rpc('leave_lobby');
                  if (error) throw error;
                  setLobby(null);
                  return data;
                }, 'Left lobby')}
              >
                Leave
              </button>
            )}
          </div>

          {lobby.status === 'live' && (
            <div className="lobby-live-hint">Everyone ready — join the code in-game and play.</div>
          )}
        </>
      )}
    </div>
  );
}
