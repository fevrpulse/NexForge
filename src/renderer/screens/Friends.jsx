import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { mmrToRank } from '../lib/ranks.js';

const AV_COLORS = ['#3B7EFF', '#9B5CFF', '#4ade80', '#FF8C42', '#C9FF00'];

function avatarColor(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AV_COLORS[hash % AV_COLORS.length];
}

function timeLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export default function Friends() {
  const { user, showToast, reportCloudError, unreadBySender, refreshUnread } = useNexForge();
  const myId = user?.id;

  const [rows, setRows] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const scrollRef = useRef(null);
  const selectedRef = useRef(null);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  const loadFriendships = useCallback(async () => {
    if (!myId) return;
    try {
      const { data, error } = await sb
        .from('friendships')
        .select('id,requester_id,addressee_id,status,created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const list = data || [];
      setRows(list);
      const otherIds = [...new Set(list.map((r) => (r.requester_id === myId ? r.addressee_id : r.requester_id)))];
      if (otherIds.length) {
        const { data: profs, error: pErr } = await sb
          .from('profiles')
          .select('id,gamer_tag,mmr,main_game,platform')
          .in('id', otherIds);
        if (pErr) throw pErr;
        setProfiles((prev) => {
          const next = { ...prev };
          for (const p of profs || []) next[p.id] = p;
          return next;
        });
      }
    } catch (err) {
      await reportCloudError(err);
    }
  }, [myId, reportCloudError]);

  const loadConversation = useCallback(async (friendId, { markRead = false } = {}) => {
    if (!myId || !friendId) return;
    try {
      const { data, error } = await sb
        .from('messages')
        .select('id,sender_id,recipient_id,body,created_at')
        .or(`and(sender_id.eq.${myId},recipient_id.eq.${friendId}),and(sender_id.eq.${friendId},recipient_id.eq.${myId})`)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      // Ignore responses that arrive after switching to another chat.
      if (selectedRef.current !== friendId) return;
      setMessages(data || []);
      if (markRead) {
        await sb
          .from('messages')
          .update({ read_at: new Date().toISOString() })
          .eq('recipient_id', myId)
          .eq('sender_id', friendId)
          .is('read_at', null);
        refreshUnread();
      }
    } catch (err) {
      await reportCloudError(err);
    }
  }, [myId, refreshUnread, reportCloudError]);

  useEffect(() => {
    loadFriendships();
    const id = setInterval(loadFriendships, 8000);
    return () => clearInterval(id);
  }, [loadFriendships]);

  // Ref mirror so the poll interval sees fresh unread counts without re-subscribing.
  const unreadBySenderRef = useRef(unreadBySender);
  useEffect(() => { unreadBySenderRef.current = unreadBySender; }, [unreadBySender]);

  useEffect(() => {
    if (!selectedId) {
      setMessages(null);
      return undefined;
    }
    setMessages(null);
    loadConversation(selectedId, { markRead: true });
    const id = setInterval(() => {
      const hasUnread = (unreadBySenderRef.current[selectedRef.current] || 0) > 0;
      loadConversation(selectedRef.current, { markRead: hasUnread });
    }, 3000);
    return () => clearInterval(id);
  }, [selectedId, loadConversation]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length, selectedId]);

  const { friends, incoming, outgoing } = useMemo(() => {
    const f = [];
    const inc = [];
    const out = [];
    for (const r of rows) {
      const otherId = r.requester_id === myId ? r.addressee_id : r.requester_id;
      const item = { ...r, otherId, profile: profiles[otherId] };
      if (r.status === 'accepted') f.push(item);
      else if (r.addressee_id === myId) inc.push(item);
      else out.push(item);
    }
    return { friends: f, incoming: inc, outgoing: out };
  }, [rows, profiles, myId]);

  const relatedIds = useMemo(() => new Set(rows.map((r) => (r.requester_id === myId ? r.addressee_id : r.requester_id))), [rows, myId]);

  async function searchPlayers() {
    const q = query.trim();
    if (q.length < 2) {
      showToast('Type at least 2 characters to search.', 'error');
      return;
    }
    setSearching(true);
    try {
      const { data, error } = await sb
        .from('profiles')
        .select('id,gamer_tag,mmr,main_game')
        .ilike('gamer_tag', `%${q}%`)
        .neq('id', myId)
        .limit(6);
      if (error) throw error;
      setResults(data || []);
    } catch (err) {
      showToast(err?.message || 'Search failed.', 'error');
      await reportCloudError(err);
    } finally {
      setSearching(false);
    }
  }

  async function sendRequest(p) {
    try {
      const { error } = await sb.from('friendships').insert({
        requester_id: myId,
        addressee_id: p.id,
      });
      if (error) {
        if (error.code === '23505') {
          showToast(`Already friends or pending with ${p.gamer_tag}`, 'error');
          return;
        }
        throw error;
      }
      showToast(`Friend request sent to ${p.gamer_tag}`, 'success');
      setResults((prev) => (prev ? prev.filter((r) => r.id !== p.id) : prev));
      loadFriendships();
    } catch (err) {
      showToast(err?.message || 'Could not send request.', 'error');
      await reportCloudError(err);
    }
  }

  async function acceptRequest(item) {
    try {
      const { error } = await sb
        .from('friendships')
        .update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('id', item.id);
      if (error) throw error;
      showToast(`You are now friends with ${item.profile?.gamer_tag || 'player'}`, 'success');
      loadFriendships();
    } catch (err) {
      showToast(err?.message || 'Could not accept request.', 'error');
      await reportCloudError(err);
    }
  }

  async function removeFriendship(item, label) {
    try {
      const { error } = await sb.from('friendships').delete().eq('id', item.id);
      if (error) throw error;
      showToast(label, 'success');
      if (item.otherId === selectedId) setSelectedId(null);
      loadFriendships();
    } catch (err) {
      showToast(err?.message || 'Action failed.', 'error');
      await reportCloudError(err);
    }
  }

  async function sendMessage() {
    const body = draft.trim();
    if (!body || !selectedId || sending) return;
    setSending(true);
    try {
      const { data, error } = await sb
        .from('messages')
        .insert({ sender_id: myId, recipient_id: selectedId, body })
        .select('id,sender_id,recipient_id,body,created_at')
        .single();
      if (error) throw error;
      setDraft('');
      setMessages((prev) => [...(prev || []), data]);
    } catch (err) {
      showToast(err?.message || 'Message failed to send.', 'error');
      await reportCloudError(err);
    } finally {
      setSending(false);
    }
  }

  const selectedProfile = selectedId ? profiles[selectedId] : null;

  function renderPersonRow(item, actions) {
    const p = item.profile;
    const tag = p?.gamer_tag || 'Player';
    const col = avatarColor(item.otherId);
    const unread = unreadBySender[item.otherId] || 0;
    return (
      <div
        key={item.id}
        className={`friend-row ${item.otherId === selectedId ? 'active' : ''} ${actions ? '' : 'clickable'}`}
        onClick={actions ? undefined : () => setSelectedId(item.otherId)}
      >
        <div className="player-av" style={{ background: `${col}22`, color: col }}>
          {tag.slice(0, 2).toUpperCase()}
        </div>
        <div className="player-info">
          <div className="player-tag">{tag}</div>
          <div className="player-game">{p ? `${p.main_game || '—'} · ${mmrToRank(p.mmr)}` : '—'}</div>
        </div>
        {unread > 0 && !actions && <span className="unread-pill">{unread}</span>}
        {actions}
      </div>
    );
  }

  return (
    <div className="friends-layout">
      <div className="card friends-list">
        <div className="card-title">Add Friends</div>
        <div className="friend-search">
          <input
            type="text"
            placeholder="Search gamer tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') searchPlayers(); }}
          />
          <button className="action-btn ghost" onClick={searchPlayers} disabled={searching}>
            {searching ? '…' : 'Search'}
          </button>
        </div>
        {results !== null && (
          <div className="friend-results">
            {results.length === 0 ? (
              <div className="friends-empty">No players found</div>
            ) : (
              results.map((p) => (
                <div key={p.id} className="friend-row">
                  <div className="player-av" style={{ background: `${avatarColor(p.id)}22`, color: avatarColor(p.id) }}>
                    {(p.gamer_tag || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="player-info">
                    <div className="player-tag">{p.gamer_tag}</div>
                    <div className="player-game">{p.main_game || '—'} · {mmrToRank(p.mmr)}</div>
                  </div>
                  {relatedIds.has(p.id) ? (
                    <span className="friend-hint">Added</span>
                  ) : (
                    <button className="action-btn ghost friend-mini-btn" onClick={() => sendRequest(p)}>
                      Add
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {incoming.length > 0 && (
          <>
            <div className="card-title friends-section">Requests</div>
            {incoming.map((item) => renderPersonRow(item, (
              <div className="friend-actions">
                <button className="action-btn primary friend-mini-btn" onClick={() => acceptRequest(item)}>Accept</button>
                <button className="action-btn ghost friend-mini-btn" onClick={() => removeFriendship(item, 'Request declined')}>Decline</button>
              </div>
            )))}
          </>
        )}

        {outgoing.length > 0 && (
          <>
            <div className="card-title friends-section">Sent</div>
            {outgoing.map((item) => renderPersonRow(item, (
              <button className="action-btn ghost friend-mini-btn" onClick={() => removeFriendship(item, 'Request cancelled')}>
                Cancel
              </button>
            )))}
          </>
        )}

        <div className="card-title friends-section">Friends {friends.length > 0 && `(${friends.length})`}</div>
        {friends.length === 0 ? (
          <div className="friends-empty">No friends yet — search a gamer tag above to send a request.</div>
        ) : (
          friends.map((item) => renderPersonRow(item))
        )}
      </div>

      <div className="card chat-panel">
        {!selectedId ? (
          <div className="chat-placeholder">
            <div className="chat-placeholder-mark">✉</div>
            Select a friend to start chatting
          </div>
        ) : (
          <>
            <div className="chat-header">
              <div className="player-av" style={{ background: `${avatarColor(selectedId)}22`, color: avatarColor(selectedId) }}>
                {(selectedProfile?.gamer_tag || '?').slice(0, 2).toUpperCase()}
              </div>
              <div className="player-info">
                <div className="player-tag">{selectedProfile?.gamer_tag || 'Player'}</div>
                <div className="player-game">
                  {selectedProfile ? `${selectedProfile.main_game || '—'} · ${selectedProfile.platform || 'PC'} · ${mmrToRank(selectedProfile.mmr)}` : '—'}
                </div>
              </div>
              <button
                className="action-btn ghost friend-mini-btn"
                onClick={() => {
                  const item = friends.find((f) => f.otherId === selectedId);
                  if (item) removeFriendship(item, 'Friend removed');
                }}
              >
                Remove
              </button>
            </div>
            <div className="chat-messages" ref={scrollRef}>
              {messages === null ? (
                <div className="friends-empty">Loading…</div>
              ) : messages.length === 0 ? (
                <div className="friends-empty">No messages yet — say hi!</div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`chat-bubble-row ${m.sender_id === myId ? 'mine' : ''}`}>
                    <div className="chat-bubble">
                      <div className="chat-body">{m.body}</div>
                      <div className="chat-time">{timeLabel(m.created_at)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="chat-input-row">
              <input
                type="text"
                placeholder={`Message ${selectedProfile?.gamer_tag || ''}…`}
                value={draft}
                maxLength={2000}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
              />
              <button className="action-btn primary" onClick={sendMessage} disabled={sending || !draft.trim()}>
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
