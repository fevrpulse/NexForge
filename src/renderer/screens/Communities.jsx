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
  const scrollRef = useRef(null);
  const voiceChannelRef = useRef(null);

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
      // Keep home visible until the user picks a community (or create/join).
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
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      setMessages(data || []);
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
    if (!activeChannel) return undefined;
    if (activeChannel.kind === 'text') {
      loadMessages(activeChannel.id);
    } else {
      loadVoiceHere(activeChannel.id);
    }
    return undefined;
  }, [activeChannel, loadMessages, loadVoiceHere]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Realtime messages + voice presence
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
      showToast(`#${data.name} created`, 'success');
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
      const { error } = await sb.rpc('join_community_voice', { p_channel_id: activeChannel.id });
      if (error) throw error;
      voiceChannelRef.current = activeChannel.id;
      await loadVoiceHere(activeChannel.id);
      const { data: others } = await sb
        .from('community_voice_members')
        .select('user_id')
        .eq('channel_id', activeChannel.id)
        .neq('user_id', myId);
      const peerIds = (others || []).map((o) => o.user_id);
      if (voice?.startChannelVoice) {
        await voice.startChannelVoice(activeChannel.id, peerIds);
      } else if (peerIds[0] && voice?.startCall) {
        await voice.startCall(peerIds[0]);
      }
      showToast(`Joined ${activeChannel.name}`, 'success');
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
      showToast('Left voice channel', 'success');
    });
  }

  useEffect(() => () => {
    if (voiceChannelRef.current) {
      sb.rpc('leave_community_voice', { p_channel_id: voiceChannelRef.current }).catch(() => {});
    }
  }, []);

  if (guestMode) {
    return (
      <div className="card">
        <div className="card-title">Communities</div>
        <p className="muted">Sign in to create or join Communities (Discord-style servers).</p>
      </div>
    );
  }

  const textChannels = channels.filter((c) => c.kind === 'text');
  const voiceChannels = channels.filter((c) => c.kind === 'voice');
  const inThisVoice = voiceHere.some((v) => v.user_id === myId) || voiceChannelRef.current === activeChannel?.id;

  return (
    <div className="communities-layout">
      <aside className="comm-rail">
        <button
          type="button"
          className={`comm-pill home ${!selectedId ? 'active' : ''}`}
          title="Discover — create or join"
          onClick={() => setSelectedId(null)}
        >
          ⌂
        </button>
        <div className="comm-rail-div" />
        {communities.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`comm-pill ${selectedId === c.id ? 'active' : ''}`}
            style={{ '--comm-color': c.icon_color || '#3B7EFF' }}
            title={c.name}
            onClick={() => setSelectedId(c.id)}
          >
            {initials(c.name)}
          </button>
        ))}
        <div className="comm-rail-div" />
        <button
          type="button"
          className="comm-pill add"
          title="Create or join a community"
          onClick={() => {
            setSelectedId(null);
            setTimeout(() => document.getElementById('comm-create-name')?.focus(), 50);
          }}
        >
          +
        </button>
      </aside>

      <aside className="comm-channels">
        {selected ? (
          <>
            <div className="comm-header">
              <button
                type="button"
                className="comm-back"
                onClick={() => setSelectedId(null)}
                title="Back to discover"
              >
                ← Discover
              </button>
              <div className="comm-title">{selected.name}</div>
              <div className="comm-invite" title="Invite code">
                #{selected.invite_code}
                <button
                  type="button"
                  className="action-btn ghost friend-mini-btn"
                  onClick={() => {
                    navigator.clipboard?.writeText(selected.invite_code);
                    showToast('Invite code copied', 'success');
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
            <div className="comm-section-label">Text channels</div>
            {textChannels.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`comm-chan ${channelId === c.id ? 'active' : ''}`}
                onClick={() => setChannelId(c.id)}
              >
                # {c.name}
              </button>
            ))}
            <div className="comm-section-label">Voice channels</div>
            {voiceChannels.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`comm-chan voice ${channelId === c.id ? 'active' : ''}`}
                onClick={() => setChannelId(c.id)}
              >
                Voice · {c.name}
              </button>
            ))}
            {canManage && (
              <div className="comm-new-chan">
                <input
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="new-channel"
                />
                <select value={newChannelKind} onChange={(e) => setNewChannelKind(e.target.value)}>
                  <option value="text">Text</option>
                  <option value="voice">Voice</option>
                </select>
                <button type="button" className="action-btn ghost friend-mini-btn" disabled={busy} onClick={handleAddChannel}>
                  Add
                </button>
              </div>
            )}
            <button type="button" className="action-btn ghost comm-leave" disabled={busy} onClick={handleLeave}>
              {selected.owner_id === myId ? 'Delete community' : 'Leave community'}
            </button>
          </>
        ) : (
          <div className="comm-empty-side">Select or create a community</div>
        )}
      </aside>

      <section className="comm-main">
        {!selected ? (
          <div className="comm-home">
            <div className="comm-home-hero">
              <div className="card-title">Communities</div>
              <p className="muted">Servers with text &amp; voice — create one or join with an invite.</p>
            </div>
            <div className="comm-forms">
              <div className="comm-form card">
                <label htmlFor="comm-create-name">Create</label>
                <input
                  id="comm-create-name"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Community name"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                />
                <button type="button" className="action-btn primary" disabled={busy || createName.trim().length < 2} onClick={handleCreate}>
                  Create community
                </button>
              </div>
              <div className="comm-form card">
                <label htmlFor="comm-join-code">Join with invite</label>
                <input
                  id="comm-join-code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Invite code"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
                />
                <button type="button" className="action-btn ghost" disabled={busy || !joinCode.trim()} onClick={handleJoin}>
                  Join community
                </button>
              </div>
            </div>
            {communities.length > 0 && (
              <div className="comm-home-list">
                <div className="comm-section-label">Your communities</div>
                {communities.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="comm-home-row"
                    onClick={() => setSelectedId(c.id)}
                  >
                    <span className="comm-home-av" style={{ background: `${c.icon_color || '#3B7EFF'}33`, color: c.icon_color || '#3B7EFF' }}>
                      {initials(c.name)}
                    </span>
                    <span className="comm-home-name">{c.name}</span>
                    <span className="comm-home-code">#{c.invite_code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : activeChannel?.kind === 'voice' ? (
          <div className="comm-voice-panel">
            <div className="card-title">{activeChannel.name}</div>
            <p className="muted">Voice channel — join to talk with members here.</p>
            <div className="comm-voice-people">
              {voiceHere.length === 0 ? (
                <div className="friends-empty">No one is here yet.</div>
              ) : (
                voiceHere.map((v) => (
                  <div key={v.user_id} className="comm-voice-person">
                    <PlayerAvatar profile={profiles[v.user_id]} size={40} />
                    <GamerTag profile={profiles[v.user_id] || { gamer_tag: 'Player' }} />
                  </div>
                ))
              )}
            </div>
            <div className="comm-voice-actions">
              {!inThisVoice ? (
                <button type="button" className="action-btn primary" disabled={busy} onClick={joinVoice}>
                  Join Voice
                </button>
              ) : (
                <button type="button" className="action-btn voice-hangup" disabled={busy} onClick={leaveVoice}>
                  Leave Voice
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="comm-chat-title"># {activeChannel?.name || 'channel'}</div>
            <div className="comm-messages" ref={scrollRef}>
              {messages.length === 0 ? (
                <div className="friends-empty">No messages yet — say hi!</div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`comm-msg ${m.sender_id === myId ? 'mine' : ''}`}>
                    <PlayerAvatar profile={profiles[m.sender_id]} size={32} />
                    <div>
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
            <div className="comm-input-row">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Message #${activeChannel?.name || ''}`}
                onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
              />
              <button type="button" className="action-btn primary" disabled={busy || !draft.trim()} onClick={sendMessage}>
                Send
              </button>
            </div>
          </>
        )}
      </section>

      <aside className="comm-members">
        <div className="comm-section-label">Members — {members.length}</div>
        {members.map((m) => (
          <div key={m.user_id} className="comm-member-row">
            <PlayerAvatar profile={profiles[m.user_id]} size={28} />
            <div className="comm-member-meta">
              <GamerTag profile={profiles[m.user_id] || { gamer_tag: 'Player' }} />
              <span className="comm-role">{m.role}</span>
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}
