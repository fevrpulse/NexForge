import React, { useMemo, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import PlayerAvatar, { GamerTag } from './PlayerAvatar.jsx';

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

function memberOnline(m) {
  if (!m?.last_seen_at) return false;
  return Date.now() - new Date(m.last_seen_at).getTime() < ONLINE_WINDOW_MS;
}

/** Shared party card for Friends + Matchmaking. */
export default function PartyPanel({ compact = false }) {
  const {
    user,
    party,
    setPartyReady,
    leaveParty,
    disbandParty,
    kickPartyMember,
    respondPartyInvite,
    createParty,
    reportCloudError,
    showToast,
  } = useNexForge();
  const [busy, setBusy] = useState(false);

  const me = useMemo(() => {
    if (!party?.members || !user) return null;
    return party.members.find((m) => m.user_id === user.id) || null;
  }, [party, user]);

  const joined = useMemo(
    () => (party?.members || []).filter((m) => m.status === 'joined'),
    [party],
  );
  const invited = useMemo(
    () => (party?.members || []).filter((m) => m.status === 'invited'),
    [party],
  );

  const isHost = me?.role === 'host';
  const pendingInvite = party?.my_status === 'invited';
  const inParty = party?.my_status === 'joined';

  async function run(action) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (err) {
      showToast(err?.message || 'Party action failed.', 'error');
      await reportCloudError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!party) {
    if (compact) return null;
    return (
      <div className="card party-panel">
        <div className="party-panel-head">
          <div className="card-title" style={{ marginBottom: 0 }}>Party</div>
          <button
            type="button"
            className="action-btn ghost"
            style={{ padding: '4px 10px', fontSize: 11 }}
            disabled={busy}
            onClick={() => run(() => createParty())}
          >
            Create
          </button>
        </div>
        <div className="party-panel-empty">
          Invite friends from chat, or create a party to ready up together.
        </div>
      </div>
    );
  }

  if (pendingInvite) {
    const host = (party.members || []).find((m) => m.role === 'host');
    return (
      <div className={`card party-panel party-panel-invite ${compact ? 'compact' : ''}`}>
        <div className="party-panel-head">
          <div>
            <div className="card-title" style={{ marginBottom: 4 }}>Party invite</div>
            <div className="party-panel-sub">
              from {host?.gamer_tag || 'a friend'}
              {party.game ? ` · ${party.game}` : ''}
            </div>
          </div>
        </div>
        <div className="party-panel-actions">
          <button
            type="button"
            className="action-btn primary"
            disabled={busy}
            onClick={() => run(() => respondPartyInvite(party.id, true))}
          >
            Accept
          </button>
          <button
            type="button"
            className="action-btn ghost"
            disabled={busy}
            onClick={() => run(() => respondPartyInvite(party.id, false))}
          >
            Decline
          </button>
        </div>
      </div>
    );
  }

  if (!inParty) return null;

  const readyCount = joined.filter((m) => m.ready).length;
  const allReady = party.status === 'ready';

  return (
    <div className={`card party-panel ${compact ? 'compact' : ''} ${allReady ? 'party-ready' : ''}`}>
      <div className="party-panel-head">
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>
            Party {joined.length}/{party.max_members || 5}
            {allReady ? ' · Ready' : ''}
          </div>
          <div className="party-panel-sub">
            {party.game || 'No game set'} · {readyCount}/{joined.length} ready
            {invited.length > 0 ? ` · ${invited.length} pending` : ''}
          </div>
        </div>
        <div className="party-panel-actions">
          <button
            type="button"
            className={`action-btn ${me?.ready ? 'ghost' : 'primary'}`}
            style={{ padding: '6px 12px', fontSize: 11 }}
            disabled={busy}
            onClick={() => run(() => setPartyReady(!me?.ready))}
          >
            {me?.ready ? 'Unready' : 'Ready'}
          </button>
          {isHost ? (
            <button
              type="button"
              className="action-btn ghost"
              style={{ padding: '6px 12px', fontSize: 11 }}
              disabled={busy}
              onClick={() => run(() => disbandParty())}
            >
              Disband
            </button>
          ) : (
            <button
              type="button"
              className="action-btn ghost"
              style={{ padding: '6px 12px', fontSize: 11 }}
              disabled={busy}
              onClick={() => run(() => leaveParty())}
            >
              Leave
            </button>
          )}
        </div>
      </div>

      <div className="party-member-list">
        {joined.map((m) => (
          <div className="party-member-row" key={m.user_id}>
            <PlayerAvatar
              profile={{
                gamer_tag: m.gamer_tag,
                avatar_url: m.avatar_url,
                equipped_frame: m.equipped_frame,
              }}
              size={compact ? 28 : 32}
              showPresence
              online={memberOnline(m)}
            />
            <div className="party-member-info">
              <div className="party-member-tag">
                <GamerTag profile={{ gamer_tag: m.gamer_tag, equipped_nameplate: null }} />
                {m.role === 'host' && <span className="party-role-badge">host</span>}
              </div>
              <div className={`party-member-ready ${m.ready ? 'on' : ''}`}>
                {m.ready ? 'Ready' : 'Not ready'}
              </div>
            </div>
            {isHost && m.user_id !== user.id && (
              <button
                type="button"
                className="action-btn ghost friend-mini-btn"
                disabled={busy}
                onClick={() => run(() => kickPartyMember(m.user_id))}
              >
                Kick
              </button>
            )}
          </div>
        ))}
        {!compact && invited.map((m) => (
          <div className="party-member-row pending" key={`inv-${m.user_id}`}>
            <PlayerAvatar
              profile={{ gamer_tag: m.gamer_tag, avatar_url: m.avatar_url, equipped_frame: m.equipped_frame }}
              size={32}
            />
            <div className="party-member-info">
              <div className="party-member-tag">{m.gamer_tag}</div>
              <div className="party-member-ready">Invite pending</div>
            </div>
            {isHost && (
              <button
                type="button"
                className="action-btn ghost friend-mini-btn"
                disabled={busy}
                onClick={() => run(() => kickPartyMember(m.user_id))}
              >
                Cancel
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
