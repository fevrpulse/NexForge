import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import PlayerAvatar, { GamerTag } from '../components/PlayerAvatar.jsx';

export default function Clans() {
  const {
    user,
    profile,
    clan,
    createClan,
    inviteToClan,
    respondClanInvite,
    leaveClan,
    disbandClan,
    joinClan,
    updateClanSettings,
    claimClanReward,
    refreshProfile,
    showToast,
    reportCloudError,
    guestMode,
    setLockMessage,
  } = useNexForge();
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [minMmr, setMinMmr] = useState(0);
  const [isOpen, setIsOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [friends, setFriends] = useState([]);
  const [openClans, setOpenClans] = useState([]);
  const [tab, setTab] = useState('browse'); // browse | create
  const [settingsMmr, setSettingsMmr] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(true);

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
  const myMmr = profile?.mmr ?? 1200;

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
        .select('id,gamer_tag,display_name,mmr,clan_tag')
        .in('id', otherIds);
      if (pErr) throw pErr;
      setFriends((profs || []).map((p) => ({
        id: p.id,
        gamer_tag: p.gamer_tag || 'Player',
        display_name: p.display_name || null,
        mmr: p.mmr ?? 1200,
        clan_tag: p.clan_tag,
      })));
    } catch (err) {
      setFriends([]);
      await reportCloudError(err);
    }
  }, [user, guestMode, reportCloudError]);

  const loadOpenClans = useCallback(async () => {
    if (!user || guestMode) {
      setOpenClans([]);
      return;
    }
    try {
      const { data, error } = await sb.rpc('list_joinable_clans', { p_limit: 40 });
      if (error) throw error;
      setOpenClans(Array.isArray(data?.clans) ? data.clans : []);
    } catch (err) {
      console.warn('list_joinable_clans failed', err);
      setOpenClans([]);
      await reportCloudError(err);
    }
  }, [user, guestMode, reportCloudError]);

  useEffect(() => {
    if (inClan && isOwner) loadFriends();
  }, [inClan, isOwner, loadFriends]);

  useEffect(() => {
    if (!inClan && !pendingInvite) loadOpenClans();
  }, [inClan, pendingInvite, loadOpenClans]);

  useEffect(() => {
    if (inClan && clan) {
      setSettingsMmr(clan.min_mmr ?? 0);
      setSettingsOpen(clan.is_open !== false);
    }
  }, [inClan, clan?.id, clan?.min_mmr, clan?.is_open]);

  async function run(action) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refreshProfile?.();
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
          {clan.min_mmr > 0 ? ' · requirements to join' : ''}
        </div>
        <div className="party-panel-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="action-btn primary"
            disabled={busy || myMmr < (clan.min_mmr || 0)}
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
        {myMmr < (clan.min_mmr || 0) && (
          <div className="clan-sub" style={{ marginTop: 10, color: 'var(--red)' }}>
            You don't meet this clan's join requirements.
          </div>
        )}
      </div>
    );
  }

  if (!inClan) {
    return (
      <div>
        <div className="clan-tabs">
          <button
            type="button"
            className={`shop-tab ${tab === 'browse' ? 'active' : ''}`}
            onClick={() => setTab('browse')}
          >
            Join a Clan
          </button>
          <button
            type="button"
            className={`shop-tab ${tab === 'create' ? 'active' : ''}`}
            onClick={() => setTab('create')}
          >
            Create
          </button>
        </div>

        {tab === 'browse' ? (
          <div className="card clan-panel">
            <div className="card-title">Open clans</div>
            <div className="clan-sub" style={{ marginBottom: 12 }}>
              Your MMR: {myMmr}. First clan join grants +75 Forge Coins; members get weekly rewards.
            </div>
            {openClans.length === 0 ? (
              <div className="clan-sub">No open clans yet — create one and set it to open.</div>
            ) : (
              <div className="clan-browse-list">
                {openClans.map((c) => {
                  const locked = myMmr < (c.min_mmr || 0);
                  return (
                    <div className="clan-browse-row" key={c.id}>
                      <div>
                        <div className="clan-browse-name">
                          <span className="clan-tag-prefix">[{c.tag}]</span> {c.name}
                        </div>
                        <div className="clan-sub">
          {c.member_count || 0} members
                          {(c.min_mmr || 0) > 0 ? ' · requirements' : ' · open to all'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="action-btn primary"
                        style={{ padding: '6px 12px', fontSize: 11 }}
                        disabled={busy || locked}
                        onClick={() => run(() => joinClan(c.id))}
                      >
                        {locked ? `Need ${c.min_mmr}` : 'Join'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              className="action-btn ghost"
              style={{ marginTop: 12, padding: '6px 10px', fontSize: 11 }}
              disabled={busy}
              onClick={() => loadOpenClans()}
            >
              Refresh list
            </button>
          </div>
        ) : (
          <div className="card clan-panel">
            <div className="card-title">Create a Clan</div>
            <div className="clan-sub" style={{ marginBottom: 14 }}>
              Unique tag shows as [TAG] before every member&apos;s name.
            </div>
            <div className="field">
              <label>Clan name</label>
              <input
                type="text"
                maxLength={32}
                placeholder="e.g. Neon Forge"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Unique tag (2–5)</label>
              <input
                type="text"
                maxLength={5}
                placeholder="POG"
                value={tag}
                onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </div>
            <div className="field">
              <label>Minimum MMR to join</label>
              <input
                type="number"
                min={0}
                max={5000}
                step={50}
                value={minMmr}
                onChange={(e) => setMinMmr(Number(e.target.value) || 0)}
              />
            </div>
            <label className="clan-check">
              <input
                type="checkbox"
                checked={isOpen}
                onChange={(e) => setIsOpen(e.target.checked)}
              />
              Open clan (anyone who meets MMR can join)
            </label>
            <button
              type="button"
              className="action-btn primary"
              style={{ marginTop: 12 }}
              disabled={busy || !name.trim() || tag.trim().length < 2}
              onClick={() => run(() => createClan(name.trim(), tag.trim(), minMmr, isOpen))}
            >
              Create Clan
            </button>
          </div>
        )}
      </div>
    );
  }

  const memberIds = new Set((clan.members || []).map((m) => m.user_id));
  const inviteTargets = friends.filter((f) => f.id && !memberIds.has(f.id));
  const reward = clan.reward || {};

  return (
    <div>
      <div className="card clan-panel">
        <div className="party-panel-head">
          <div>
            <div className="card-title" style={{ marginBottom: 4 }}>
              <span className="clan-tag-prefix">[{clan.tag}]</span> {clan.name}
            </div>
            <div className="clan-sub">
              {joined.length} member{joined.length === 1 ? '' : 's'}
              {clan.leaderboard_rank ? ` · #${clan.leaderboard_rank} clans` : ''}
              {clan.is_open === false ? ' · invite-only' : ' · open'}
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

        <div className="clan-reward-box">
          <div>
            <div className="clan-reward-title">Weekly clan reward</div>
            <div className="clan-sub">
              {reward.claimed
                ? 'Claimed for this week'
                : `${reward.coins || 0} Forge Coins available (rank + clan MMR bonus)`}
            </div>
          </div>
          <button
            type="button"
            className="action-btn primary"
            style={{ padding: '6px 12px', fontSize: 11 }}
            disabled={busy || !reward.available}
            onClick={() => run(() => claimClanReward())}
          >
            {reward.claimed ? 'Claimed' : 'Claim'}
          </button>
        </div>

        <div className="party-member-list">
          {joined.map((m) => (
            <div className="party-member-row" key={m.user_id}>
              <PlayerAvatar profile={{ gamer_tag: m.gamer_tag, clan_tag: clan.tag }} size={36} />
              <div className="party-member-info">
                <div className="party-member-tag">
                  <GamerTag profile={{ gamer_tag: m.gamer_tag, clan_tag: clan.tag }} />
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
          <div className="card-title">Clan settings</div>
          <div className="field">
            <label>Minimum MMR</label>
            <input
              type="number"
              min={0}
              max={5000}
              step={50}
              value={settingsMmr}
              onChange={(e) => setSettingsMmr(Number(e.target.value) || 0)}
            />
          </div>
          <label className="clan-check">
            <input
              type="checkbox"
              checked={settingsOpen}
              onChange={(e) => setSettingsOpen(e.target.checked)}
            />
            Open clan (players can join without invite)
          </label>
          <button
            type="button"
            className="action-btn ghost"
            style={{ marginTop: 10, padding: '6px 12px', fontSize: 11 }}
            disabled={busy}
            onClick={() => run(() => updateClanSettings({
              minMmr: settingsMmr,
              isOpen: settingsOpen,
            }))}
          >
            Save settings
          </button>
        </div>
      )}

      {isOwner && (
        <div className="card clan-panel">
          <div className="card-title">Invite friends</div>
          {inviteTargets.length === 0 ? (
            <div className="clan-sub">No eligible friends to invite right now.</div>
          ) : (
            <div className="clan-invite-list">
              {inviteTargets.map((f) => (
                <div className="clan-invite-row" key={f.id}>
                  <span>
                    <GamerTag profile={f} />
                  </span>
                  <button
                    type="button"
                    className="action-btn ghost"
                    style={{ padding: '4px 10px', fontSize: 11 }}
                    disabled={busy || f.mmr < (clan.min_mmr || 0)}
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
