import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import PlayerAvatar, { GamerTag } from '../components/PlayerAvatar.jsx';

export default function Clans() {
  const {
    user,
    clan,
    createClan,
    inviteToClan,
    respondClanInvite,
    leaveClan,
    disbandClan,
    showToast,
    reportCloudError,
    guestMode,
    setLockMessage,
  } = useNexForge();
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [friends, setFriends] = useState([]);

  const me = useMemo(() => {
    if (!clan?.members || !user) return null;
    return clan.members.find((m) => m.user_id === user.id) || null;
  }, [clan, user]);

  const isOwner = me?.role === 'owner' || clan?.owner_id === user?.id;
  const pendingInvite = clan?.my_status === 'invited';
  const inClan = clan?.my_status === 'joined';
  const joined = useMemo(
    () => (clan?.members || []).filter((m) => m.status === 'joined'),
    [clan],
  );
  const invited = useMemo(
    () => (clan?.members || []).filter((m) => m.status === 'invited'),
    [clan],
  );

  const loadFriends = useCallback(async () => {
    if (!user || guestMode) {
      setFriends([]);
      return;
    }
    try {
      const { data, error } = await sb
        .from('friendships')
        .select('id,requester_id,addressee_id,status')
        .eq('status', 'accepted');
      if (error) throw error;
      const otherIds = [...new Set((data || []).map((r) => (
        r.requester_id === user.id ? r.addressee_id : r.requester_id
      )).filter(Boolean))];
      if (!otherIds.length) {
        setFriends([]);
        return;
      }
      const { data: profs, error: pErr } = await sb
        .from('profiles')
        .select('id,gamer_tag')
        .in('id', otherIds);
      if (pErr) throw pErr;
      setFriends((profs || []).map((p) => ({ id: p.id, gamer_tag: p.gamer_tag || 'Player' })));
    } catch {
      setFriends([]);
    }
  }, [user, guestMode]);

  useEffect(() => {
    if (inClan && isOwner) loadFriends();
  }, [inClan, isOwner, loadFriends]);

  async function run(action) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (err) {
      showToast(err?.message || 'Clan action failed.', 'error');
      await reportCloudError(err);
    } finally {
      setBusy(false);
    }
  }

  if (guestMode || !user) {
    return (
      <div className="card">
        <div className="card-title">Clans</div>
        <div className="friends-empty">Sign in to create or join a clan.</div>
        <button
          type="button"
          className="action-btn primary"
          style={{ marginTop: 12 }}
          onClick={() => setLockMessage('Create a free NexForge account to use Clans')}
        >
          Create Account
        </button>
      </div>
    );
  }

  if (pendingInvite) {
    return (
      <div className="card clan-panel clan-invite">
        <div className="card-title">Clan invite</div>
        <div className="clan-sub">
          [{clan.tag}] {clan.name}
        </div>
        <div className="party-panel-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="action-btn primary"
            disabled={busy}
            onClick={() => run(() => respondClanInvite(clan.id, true))}
          >
            Accept
          </button>
          <button
            type="button"
            className="action-btn ghost"
            disabled={busy}
            onClick={() => run(() => respondClanInvite(clan.id, false))}
          >
            Decline
          </button>
        </div>
      </div>
    );
  }

  if (!inClan) {
    return (
      <div className="card clan-panel">
        <div className="card-title">Create a Clan</div>
        <div className="clan-sub" style={{ marginBottom: 14 }}>
          Pick a name and short tag. Invite friends after you found it.
        </div>
        <div className="field">
          <label>Clan name</label>
          <input
            type="text"
            maxLength={40}
            placeholder="e.g. Neon Forge"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Tag (2–5 letters)</label>
          <input
            type="text"
            maxLength={5}
            placeholder="NF"
            value={tag}
            onChange={(e) => setTag(e.target.value.toUpperCase())}
          />
        </div>
        <button
          type="button"
          className="action-btn primary"
          disabled={busy || !name.trim() || tag.trim().length < 2}
          onClick={() => run(() => createClan(name.trim(), tag.trim()))}
        >
          Create Clan
        </button>
      </div>
    );
  }

  const memberIds = new Set((clan.members || []).map((m) => m.user_id));
  const inviteTargets = friends.filter((f) => f.id && !memberIds.has(f.id));

  return (
    <div>
      <div className="card clan-panel">
        <div className="party-panel-head">
          <div>
            <div className="card-title" style={{ marginBottom: 4 }}>
              [{clan.tag}] {clan.name}
            </div>
            <div className="clan-sub">
              {joined.length} member{joined.length === 1 ? '' : 's'}
              {invited.length ? ` · ${invited.length} pending` : ''}
            </div>
          </div>
          <div className="party-panel-actions">
            {!isOwner && (
              <button
                type="button"
                className="action-btn ghost"
                disabled={busy}
                onClick={() => run(() => leaveClan())}
              >
                Leave
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                className="action-btn ghost"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Disband this clan for everyone?')) {
                    run(() => disbandClan());
                  }
                }}
              >
                Disband
              </button>
            )}
          </div>
        </div>

        <div className="party-member-list">
          {joined.map((m) => (
            <div className="party-member-row" key={m.user_id}>
              <PlayerAvatar profile={{ gamer_tag: m.gamer_tag }} size={36} />
              <div className="party-member-info">
                <div className="party-member-tag">
                  <GamerTag profile={{ gamer_tag: m.gamer_tag }} />
                  {m.role === 'owner' && <span className="party-role-badge">Owner</span>}
                </div>
              </div>
            </div>
          ))}
          {invited.map((m) => (
            <div className="party-member-row pending" key={m.user_id}>
              <PlayerAvatar profile={{ gamer_tag: m.gamer_tag }} size={36} />
              <div className="party-member-info">
                <div className="party-member-tag">{m.gamer_tag}</div>
                <div className="party-member-ready">Invite pending</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {isOwner && (
        <div className="card clan-panel">
          <div className="card-title">Invite friends</div>
          {inviteTargets.length === 0 ? (
            <div className="clan-sub">No eligible friends to invite right now.</div>
          ) : (
            <div className="clan-invite-list">
              {inviteTargets.map((f) => (
                <div className="clan-invite-row" key={f.id}>
                  <span>{f.gamer_tag || 'Player'}</span>
                  <button
                    type="button"
                    className="action-btn ghost"
                    style={{ padding: '4px 10px', fontSize: 11 }}
                    disabled={busy}
                    onClick={() => run(() => inviteToClan(f.id))}
                  >
                    Invite
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
