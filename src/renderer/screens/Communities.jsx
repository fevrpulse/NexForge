import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { useVoiceCall } from '../components/VoiceCallOverlay.jsx';
import { sb } from '../lib/supabase.js';
import PlayerAvatar, { GamerTag } from '../components/PlayerAvatar.jsx';

const COLORS = ['#3B7EFF', '#9B5CFF', '#4ade80', '#FF8C42', '#C9FF00', '#FF5C8A'];

function initials(name) {
  const parts = String(name || 'C').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || 'C';
}

function roomKindLabel(kind) {
  return kind === 'voice' ? 'Voice deck' : 'Chat room';
}

function mergeChannelMessages(prev, incoming, channelId) {
  const byId = new Map();
  for (const m of incoming || []) {
    if (m?.id != null) byId.set(m.id, m);
  }
  for (const m of prev || []) {
    if (m?.id != null && !byId.has(m.id) && m.channel_id === channelId) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
}

export default function Communities() {
  const { user, showToast, reportCloudError, guestMode, setLockMessage } = useNexForge();
  const voice = useVoiceCall();
  const myId = user?.id;

  const [communities, setCommunities] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [channels, setChannels] = useState([]);
  const [members, setMembers] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [channelId, setChannelId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [voiceHere, setVoiceHere] = useState([]);
  const [busy, setBusy] = useState(false);
  const [createName, setCreateName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelKind, setNewChannelKind] = useState('text');
  const [showAddRoom, setShowAddRoom] = useState(false);
  const scrollRef = useRef(null);
  const voiceChannelRef = useRef(null);
  const channelRef = useRef(null);

  const selected = useMemo(
    () => communities.find((c) => c.id === selectedId) || null,
    [communities, selectedId],
  );
  const activeChannel = useMemo(
    () => channels.find((c) => c.id === channelId) || null,
    [channels, channelId],
  );
  const myRole = useMemo(() => {
    const m = members.find((x) => x.user_id === myId);
    return m?.role || null;
  }, [members, myId]);
  const canManage = myRole === 'owner' || myRole === 'admin';

  const loadCommunities = useCallback(async () => {
    if (!myId || guestMode) {
      setCommunities([]);
      return;
    }
    try {
      const { data: memberships, error } = await sb
        .from('community_members')
        .select('community_id,role')
        .eq('user_id', myId);
      if (error) throw error;
      const ids = (memberships || []).map((m) => m.community_id);
      if (!ids.length) {
        setCommunities([]);
        return;
      }
      const { data, error: cErr } = await sb
        .from('communities')
        .select('id,name,icon_color,owner_id,invite_code,created_at')
        .in('id', ids)
        .order('created_at', { ascending: true });
      if (cErr) throw cErr;
      setCommunities(data || []);
    } catch (err) {
      await reportCloudError(err);
      showToast(err?.message || 'Could not load communities.', 'error');
    }
  }, [myId, guestMode, reportCloudError, showToast]);

  const loadCommunityDetail = useCallback(async (cid) => {
    if (!cid || !myId) return;
    try {
      const [{ data: chans, error: chErr }, { data: mems, error: mErr }] = await Promise.all([
        sb.from('community_channels').select('id,community_id,name,kind,position').eq('community_id', cid).order('position'),
        sb.from('community_members').select('community_id,user_id,role,joined_at').eq('community_id', cid),
      ]);
      if (chErr) throw chErr;
      if (mErr) throw mErr;
      setChannels(chans || []);
      setMembers(mems || []);
      const uids = [...new Set((mems || []).map((m) => m.user_id))];
      if (uids.length) {
        const { data: profs } = await sb
          .from('profiles')
          .select('id,gamer_tag,display_name,avatar_path,equipped_frame,clan_tag,mmr')
          .in('id', uids);
        const map = {};
        for (const p of profs || []) map[p.id] = p;
        setProfiles(map);
      }
      const firstText = (chans || []).find((c) => c.kind === 'text');
      setChannelId((prev) => {
        if (prev && (chans || []).some((c) => c.id === prev)) return prev;
        return firstText?.id || (chans || [])[0]?.id || null;
      });
    } catch (err) {
      await reportCloudError(err);
      showToast(err?.message || 'Could not load community.', 'error');
    }
  }, [myId, reportCloudError, showToast]);

  const loadMessages = useCallback(async (chid) => {
    if (!chid) {
      setMessages([]);
      return;
    }
    try {
      const { data, error } = await sb
        .from('community_messages')
        .select('id,channel_id,sender_id,body,created_at')
        .eq('channel_id', chid)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      if (channelRef.current !== chid) return;
      const incoming = (data || []).slice().reverse();
      setMessages((prev) => mergeChannelMessages(prev, incoming, chid));
    } catch (err) {
      await reportCloudError(err);
    }
  }, [reportCloudError]);

  const loadVoiceHere = useCallback(async (chid) => {
    if (!chid) {
      setVoiceHere([]);
      return;
    }
    try {
      const { data, error } = await sb
        .from('community_voice_members')
        .select('channel_id,user_id,joined_at')
        .eq('channel_id', chid);
      if (error) throw error;
      setVoiceHere(data || []);
    } catch {
      setVoiceHere([]);
    }
  }, []);

  useEffect(() => {
    if (guestMode) {
      setLockMessage('Communities require an account');
      return;
    }
    loadCommunities();
  }, [guestMode, loadCommunities, setLockMessage]);

  useEffect(() => {
    if (selectedId) loadCommunityDetail(selectedId);
  }, [selectedId, loadCommunityDetail]);

  useEffect(() => {
    channelRef.current = channelId;
    if (!channelId) {
      setMessages([]);
      return undefined;
    }
    setMessages([]);
    if (activeChannel?.kind === 'voice') {
      loadVoiceHere(channelId);
    } else if (activeChannel?.kind === 'text') {
      loadMessages(channelId);
    }
    return undefined;
  }, [channelId, activeChannel?.kind, loadMessages, loadVoiceHere]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!channelId || !myId) return undefined;
    const ch = sb
      .channel(`community-chan-${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'community_voice_members', filter: `channel_id=eq.${channelId}` },
        () => { loadVoiceHere(channelId); },
      );
    ch.subscribe();
    return () => { sb.removeChannel(ch); };
  }, [channelId, myId, loadVoiceHere]);

  useEffect(() => {
    if (!voiceChannelRef.current || !voice?.syncChannelPeers || !myId) return;
    if (voice?.call?.mode !== 'channel') return;
    if (voice?.call?.channelId && voice.call.channelId !== voiceChannelRef.current) return;
    const others = voiceHere
      .map((v) => v.user_id)
      .filter((id) => id && id !== myId);
    voice.syncChannelPeers(others).catch(() => {});
  }, [voiceHere, myId, voice]);

  const wasInChannelVoiceRef = useRef(false);
  useEffect(() => {
    if (voice?.call?.mode === 'channel' && voice?.call?.state !== 'idle') {
      wasInChannelVoiceRef.current = true;
      return;
    }
    if (voice?.call?.state !== 'idle' || !wasInChannelVoiceRef.current) return;
    wasInChannelVoiceRef.current = false;
    const chid = voiceChannelRef.current;
    if (!chid) return;
    voiceChannelRef.current = null;
    sb.rpc('leave_community_voice', { p_channel_id: chid }).catch(() => {});
    loadVoiceHere(chid);
  }, [voice?.call?.state, voice?.call?.mode, loadVoiceHere]);

  async function run(fn) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      showToast(err?.message || 'Community action failed.', 'error');
      await reportCloudError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    await run(async () => {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const { data, error } = await sb.rpc('create_community', {
        p_name: createName.trim(),
        p_icon_color: color,
      });
      if (error) throw error;
      if (!data?.id) throw new Error(data?.error || 'Could not create community.');
      setCreateName('');
      showToast(`Created ${data.name || 'community'}`, 'success');
      await loadCommunities();
      setSelectedId(data.id);
    });
  }

  async function handleJoin() {
    await run(async () => {
      const { data, error } = await sb.rpc('join_community', { p_invite_code: joinCode.trim() });
      if (error) throw error;
      setJoinCode('');
      showToast(`Joined ${data.name}`, 'success');
      await loadCommunities();
      setSelectedId(data.id);
    });
  }

  async function handleLeave() {
    if (!selectedId) return;
    await run(async () => {
      if (selected?.owner_id === myId) {
        const { error } = await sb.rpc('delete_community', { p_community_id: selectedId });
        if (error) throw error;
        showToast('Community deleted', 'success');
      } else {
        const { error } = await sb.rpc('leave_community', { p_community_id: selectedId });
        if (error) throw error;
        showToast('Left community', 'success');
      }
      if (voiceChannelRef.current) {
        await leaveVoice();
      }
      setSelectedId(null);
      setShowAddRoom(false);
      await loadCommunities();
    });
  }

  async function handleAddChannel() {
    if (!selectedId || !newChannelName.trim()) return;
    await run(async () => {
      const { data, error } = await sb.rpc('create_community_channel', {
        p_community_id: selectedId,
        p_name: newChannelName.trim(),
        p_kind: newChannelKind,
      });
      if (error) throw error;
      setNewChannelName('');
      setShowAddRoom(false);
      showToast(`${data.name} ready`, 'success');
      await loadCommunityDetail(selectedId);
      setChannelId(data.id);
    });
  }

  async function sendMessage() {
    const body = draft.trim();
    if (!body || !channelId || !myId || activeChannel?.kind !== 'text') return;
    await run(async () => {
      const { data, error } = await sb
        .from('community_messages')
        .insert({ channel_id: channelId, sender_id: myId, body })
        .select('id,channel_id,sender_id,body,created_at')
        .single();
      if (error) throw error;
      setDraft('');
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
    });
  }

  async function joinVoice() {
    if (!activeChannel || activeChannel.kind !== 'voice') return;
    await run(async () => {
      const chid = activeChannel.id;
      if (!voice?.startChannelVoice) {
        throw new Error('Voice is still starting up — wait a second and try again.');
      }

      try {
        await voice.startChannelVoice(chid, []);
      } catch (mediaErr) {
        throw mediaErr;
      }

      const { error } = await sb.rpc('join_community_voice', { p_channel_id: chid });
      if (error) {
        await voice.leaveChannelVoice?.().catch(() => {});
        throw error;
      }
      try {
        await loadVoiceHere(chid);
        const { data: others } = await sb
          .from('community_voice_members')
          .select('user_id')
          .eq('channel_id', chid)
          .neq('user_id', myId);
        const peerIds = (others || []).map((o) => o.user_id);
        if (peerIds.length && voice.syncChannelPeers) {
          await voice.syncChannelPeers(peerIds);
        }
        voiceChannelRef.current = chid;
        showToast(`Joined ${activeChannel.name}`, 'success');
      } catch (err) {
        await sb.rpc('leave_community_voice', { p_channel_id: chid }).catch(() => {});
        await voice.leaveChannelVoice?.().catch(() => {});
        voiceChannelRef.current = null;
        throw err;
      }
    });
  }

  async function leaveVoice() {
    const chid = voiceChannelRef.current || (activeChannel?.kind === 'voice' ? activeChannel.id : null);
    if (!chid) return;
    await run(async () => {
      await sb.rpc('leave_community_voice', { p_channel_id: chid });
      voiceChannelRef.current = null;
      if (voice?.hangup) await voice.hangup();
      if (voice?.leaveChannelVoice) await voice.leaveChannelVoice();
      await loadVoiceHere(chid);
      showToast('Left voice deck', 'success');
    });
  }

  useEffect(() => () => {
    if (voiceChannelRef.current) {
      sb.rpc('leave_community_voice', { p_channel_id: voiceChannelRef.current }).catch(() => {});
    }
  }, []);

  if (guestMode) {
    return (
      <div className="comm-guest">
        <div className="comm-guest-mark">NexForge</div>
        <h2 className="comm-guest-title">Communities</h2>
        <p className="muted">Sign in to open crew lounges — chat rooms and voice decks with your people.</p>
      </div>
    );
  }

  const inThisVoice = voiceHere.some((v) => v.user_id === myId) || voiceChannelRef.current === activeChannel?.id;
  const accent = selected?.icon_color || '#C9FF00';

  return (
    <div
      className={`communities-layout ${selected ? 'is-inside' : 'is-home'}`}
      style={selected ? { '--comm-color': accent } : undefined}
    >
      <div className="comm-atmosphere" aria-hidden />

      <header className="comm-topbar">
        <div className="comm-topbar-brand">
          <span className="comm-kicker">Crew lounges</span>
          <h2 className="comm-page-title">{selected ? selected.name : 'Communities'}</h2>
        </div>
        <div className="comm-switcher" role="tablist" aria-label="Your communities">
          <button
            type="button"
            className={`comm-switch lobby ${!selectedId ? 'active' : ''}`}
            onClick={() => { setSelectedId(null); setShowAddRoom(false); }}
          >
            Lobby
          </button>
          {communities.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`comm-switch ${selectedId === c.id ? 'active' : ''}`}
              style={{ '--comm-color': c.icon_color || '#3B7EFF' }}
              onClick={() => { setSelectedId(c.id); setShowAddRoom(false); }}
              title={c.name}
            >
              <span className="comm-switch-dot" aria-hidden />
              <span className="comm-switch-name">{c.name}</span>
            </button>
          ))}
        </div>
      </header>

      {!selected ? (
        <section className="comm-lobby">
          <div className="comm-lobby-hero">
            <div className="comm-lobby-copy">
              <p className="comm-lobby-eyebrow">Your people. Your rooms.</p>
              <h3 className="comm-lobby-title">Hang out without the server clutter.</h3>
              <p className="comm-lobby-lead">
                Spin up a lounge, invite the crew, then hop between chat rooms and voice decks.
              </p>
              <div className="comm-lobby-stats">
                <span className="comm-stat">
                  <b>{communities.length}</b>
                  lounge{communities.length === 1 ? '' : 's'}
                </span>
                <span className="comm-stat-sep" aria-hidden />
                <span className="comm-stat muted-stat">Invite codes · live voice</span>
              </div>
            </div>
            <div className="comm-lobby-art" aria-hidden>
              <span className="comm-orb o1" />
              <span className="comm-orb o2" />
              <span className="comm-orb o3" />
              <span className="comm-art-label">LIVE FLOOR</span>
            </div>
          </div>

          <div className="comm-lobby-actions">
            <div className="comm-panel create">
              <div className="comm-panel-head">
                <div className="comm-panel-label">Start a lounge</div>
                <div className="comm-panel-hint">Hosts get chat + voice rooms by default</div>
              </div>
              <input
                id="comm-create-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Name your community"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              />
              <button
                type="button"
                className="action-btn primary comm-panel-btn"
                disabled={busy || createName.trim().length < 2}
                onClick={handleCreate}
              >
                Create lounge
              </button>
            </div>
            <div className="comm-panel join">
              <div className="comm-panel-head">
                <div className="comm-panel-label">Enter with invite</div>
                <div className="comm-panel-hint">Paste a code from a friend</div>
              </div>
              <input
                id="comm-join-code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Invite code"
                onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
              />
              <button
                type="button"
                className="action-btn ghost comm-panel-btn"
                disabled={busy || !joinCode.trim()}
                onClick={handleJoin}
              >
                Join lounge
              </button>
            </div>
          </div>

          {communities.length > 0 ? (
            <div className="comm-roster">
              <div className="comm-roster-head">
                <div className="comm-roster-label">Your lounges</div>
                <div className="comm-roster-count">{communities.length}</div>
              </div>
              <div className="comm-roster-grid">
                {communities.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    className="comm-roster-card"
                    style={{ '--comm-color': c.icon_color || '#3B7EFF', '--stagger': `${i * 45}ms` }}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <span className="comm-roster-sheen" aria-hidden />
                    <span className="comm-roster-mark">{initials(c.name)}</span>
                    <span className="comm-roster-body">
                      <span className="comm-roster-name">{c.name}</span>
                      <span className="comm-roster-code">Invite {c.invite_code}</span>
                    </span>
                    <span className="comm-roster-go">Enter →</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="comm-empty-lobby">
              <div className="comm-empty-lobby-title">No lounges yet</div>
              <p>Create one above, or join with an invite code.</p>
            </div>
          )}
        </section>
      ) : (
        <section className="comm-stage">
          <div className="comm-stage-banner">
            <div className="comm-stage-identity">
              <span className="comm-stage-mark">{initials(selected.name)}</span>
              <div className="comm-stage-copy">
                <div className="comm-stage-meta">
                  <span className="comm-pill-soft">{members.length} in crew</span>
                  <button
                    type="button"
                    className="comm-invite-btn"
                    onClick={() => {
                      navigator.clipboard?.writeText(selected.invite_code);
                      showToast('Invite code copied', 'success');
                    }}
                  >
                    Copy invite · {selected.invite_code}
                  </button>
                </div>
                <div className="comm-crew-strip" aria-label="Members">
                  {members.slice(0, 8).map((m) => (
                    <div key={m.user_id} className="comm-crew-chip" title={m.role}>
                      <PlayerAvatar profile={profiles[m.user_id]} size={24} />
                      <span className="comm-crew-tag">
                        <GamerTag profile={profiles[m.user_id] || { gamer_tag: 'Player' }} />
                      </span>
                      {(m.role === 'owner' || m.role === 'admin') && (
                        <span className="comm-crew-role">{m.role === 'owner' ? 'host' : 'admin'}</span>
                      )}
                    </div>
                  ))}
                  {members.length > 8 && (
                    <span className="comm-crew-more">+{members.length - 8}</span>
                  )}
                </div>
              </div>
            </div>
            <button type="button" className="comm-leave-btn" disabled={busy} onClick={handleLeave}>
              {selected.owner_id === myId ? 'Delete lounge' : 'Leave lounge'}
            </button>
          </div>

          <div className="comm-workspace">
            <aside className="comm-room-rail">
              <div className="comm-room-rail-label">Rooms</div>
              <div className="comm-rooms" role="tablist" aria-label="Rooms">
                {channels.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`comm-room ${channelId === c.id ? 'active' : ''} kind-${c.kind}`}
                    onClick={() => setChannelId(c.id)}
                  >
                    <span className={`comm-room-ico kind-${c.kind}`} aria-hidden>
                      {c.kind === 'voice' ? '◎' : '✦'}
                    </span>
                    <span className="comm-room-text">
                      <span className="comm-room-kind">{c.kind === 'voice' ? 'Voice' : 'Chat'}</span>
                      <span className="comm-room-name">{c.name}</span>
                    </span>
                  </button>
                ))}
              </div>
              {canManage && (
                <button
                  type="button"
                  className={`comm-room add ${showAddRoom ? 'active' : ''}`}
                  onClick={() => setShowAddRoom((v) => !v)}
                >
                  + Add room
                </button>
              )}
              {showAddRoom && canManage && (
                <div className="comm-add-room">
                  <input
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    placeholder="Room name"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddChannel(); }}
                  />
                  <select value={newChannelKind} onChange={(e) => setNewChannelKind(e.target.value)}>
                    <option value="text">Chat room</option>
                    <option value="voice">Voice deck</option>
                  </select>
                  <button type="button" className="action-btn primary friend-mini-btn" disabled={busy} onClick={handleAddChannel}>
                    Add
                  </button>
                </div>
              )}
            </aside>

            <div className="comm-floor">
              {activeChannel?.kind === 'voice' ? (
                <div className="comm-voice-panel">
                  <div className="comm-floor-head">
                    <div>
                      <div className="comm-floor-label">{roomKindLabel('voice')}</div>
                      <h4 className="comm-floor-title">{activeChannel.name}</h4>
                    </div>
                    <span className={`comm-live-dot ${voiceHere.length ? 'on' : ''}`}>
                      {voiceHere.length ? `${voiceHere.length} live` : 'Quiet'}
                    </span>
                  </div>
                  <div className="comm-voice-stage">
                    <div className="comm-voice-rings" aria-hidden>
                      <span /><span /><span />
                    </div>
                    <div className="comm-voice-people">
                      {voiceHere.length === 0 ? (
                        <div className="comm-empty-note center">Deck is quiet. Be the first in.</div>
                      ) : (
                        voiceHere.map((v) => (
                          <div key={v.user_id} className="comm-voice-person">
                            <PlayerAvatar profile={profiles[v.user_id]} size={48} />
                            <GamerTag profile={profiles[v.user_id] || { gamer_tag: 'Player' }} />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="comm-voice-actions">
                    {!inThisVoice ? (
                      <button type="button" className="action-btn primary" disabled={busy} onClick={joinVoice}>
                        Join voice
                      </button>
                    ) : (
                      <button type="button" className="action-btn voice-hangup" disabled={busy} onClick={leaveVoice}>
                        Leave voice
                      </button>
                    )}
                    <p className="comm-voice-hint">Mute, deafen, and share from the call bar.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="comm-chat-head">
                    <div>
                      <div className="comm-floor-label">{roomKindLabel('text')}</div>
                      <h4 className="comm-floor-title">{activeChannel?.name || 'Room'}</h4>
                    </div>
                    <span className="comm-msg-count">{messages.length} msg{messages.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="comm-messages" ref={scrollRef}>
                    {messages.length === 0 ? (
                      <div className="comm-empty-chat">
                        <div className="comm-empty-chat-mark">✦</div>
                        <div className="comm-empty-lobby-title">Open the floor</div>
                        <p>Say something — this room is waiting.</p>
                      </div>
                    ) : (
                      messages.map((m) => (
                        <div key={m.id} className={`comm-msg ${m.sender_id === myId ? 'mine' : ''}`}>
                          <PlayerAvatar profile={profiles[m.sender_id]} size={34} />
                          <div className="comm-msg-stack">
                            <div className="comm-msg-meta">
                              <GamerTag profile={profiles[m.sender_id] || { gamer_tag: 'Player' }} />
                              <span>{new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                            </div>
                            <div className="comm-msg-body">{m.body}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="comm-composer">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={`Message ${activeChannel?.name || 'room'}…`}
                      onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
                    />
                    <button type="button" className="action-btn primary" disabled={busy || !draft.trim()} onClick={sendMessage}>
                      Send
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
