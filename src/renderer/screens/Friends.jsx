import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { mmrToRank, mmrToSkillTag, skillTagClass } from '../lib/ranks.js';
import { bannerStyleKey } from '../lib/cosmetics.js';
import PlayerAvatar, { GamerTag } from '../components/PlayerAvatar.jsx';
import { formatDuration } from '../lib/format.js';

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

const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '😮', '😢'];

function isOnline(p) {
  if (!p?.last_seen_at) return false;
  return Date.now() - new Date(p.last_seen_at).getTime() < ONLINE_WINDOW_MS;
}

function presenceLine(p) {
  if (!p) return '—';
  if (isOnline(p) && p.playing_game) return `Playing ${p.playing_game}`;
  if (isOnline(p)) return 'Online';
  return `${p.main_game || '—'} · ${mmrToRank(p.mmr)}`;
}

function PresenceBlock({ p, offlineDetail }) {
  if (!p) return <div className="player-game">—</div>;
  const online = isOnline(p);
  return (
    <>
      <div className={`player-game ${online ? 'presence-online' : ''}`}>
        {online ? presenceLine(p) : offlineDetail}
      </div>
      {p.custom_status && <div className="player-custom-status">{p.custom_status}</div>}
    </>
  );
}

function SkillTagBadge({ mmr, small = false }) {
  const tag = mmrToSkillTag(mmr);
  return (
    <span
      className={`badge ${skillTagClass(tag)}`}
      style={small ? { fontSize: 10, padding: '2px 6px' } : undefined}
    >
      {tag}
    </span>
  );
}

function FriendProfileModal({ data, loading, onClose, onMessage, showToast, myId, onBlock, onReport }) {
  const p = data?.profile;
  const matches = data?.matches || [];
  const sessions = data?.sessions || [];
  const duels = data?.duels || [];
  const badges = data?.badges || [];
  const historyHidden = !!data?.history_hidden;
  const total = (p?.wins || 0) + (p?.losses || 0);
  const wr = total > 0 ? Math.round(((p.wins || 0) / total) * 100) : null;

  async function copyTag() {
    if (!p?.gamer_tag) return;
    try {
      await navigator.clipboard.writeText(p.gamer_tag);
      showToast?.('Tag copied', 'success');
    } catch {
      showToast?.('Could not copy tag', 'error');
    }
  }

  function handleReport() {
    if (!p?.id || !onReport) return;
    const reason = window.prompt('Why are you reporting this player?');
    if (reason?.trim()) onReport(p.id, reason.trim());
  }

  function duelWinnerLabel(d) {
    if (!d.winner_id) return 'Draw';
    if (d.winner_id === myId) return 'You won';
    if (d.winner_id === p?.id) return `${p.gamer_tag} won`;
    return 'Completed';
  }

  return (
    <div className="friend-profile-overlay" onClick={onClose}>
      <div className="friend-profile-modal card" onClick={(e) => e.stopPropagation()}>
        <button className="friend-profile-x" onClick={onClose} aria-label="Close">×</button>
        {loading || !p ? (
          <div className="friends-empty" style={{ padding: '40px 0' }}>Loading profile…</div>
        ) : (
          <>
            <div className={`friend-profile-head banner-${bannerStyleKey(p.equipped_banner)}`}>
              <PlayerAvatar
                profile={p}
                size={52}
                className="friend-profile-av"
                showPresence
                online={isOnline(p)}
              />
              <div className="player-info">
                <div style={{ fontSize: 18, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <GamerTag profile={p} />
                  <SkillTagBadge mmr={p.mmr} small />
                </div>
                <PresenceBlock
                  p={p}
                  offlineDetail={`${p.main_game || '—'} · ${p.platform || 'PC'} · ${mmrToRank(p.mmr)}`}
                />
              </div>
              <div className="friend-profile-actions">
                <button className="action-btn ghost friend-mini-btn" onClick={copyTag} title="Copy gamer tag">
                  Copy tag
                </button>
                {onMessage && (
                  <button className="action-btn primary friend-mini-btn" onClick={onMessage}>
                    Message
                  </button>
                )}
              </div>
            </div>

            {badges.length > 0 && (
              <div className="friend-badge-row">
                {badges.map((b) => (
                  <span key={b.id} className="friend-badge" title={b.desc}>{b.label}</span>
                ))}
              </div>
            )}

            <div className="friend-profile-stats">
              <div className="friend-profile-stat">
                <div className="stat-label">MMR</div>
                <div className="stat-val neon">{(p.mmr || 1200).toLocaleString()}</div>
              </div>
              <div className="friend-profile-stat">
                <div className="stat-label">Wins</div>
                <div className="stat-val" style={{ color: '#4ade80' }}>{p.wins || 0}</div>
              </div>
              <div className="friend-profile-stat">
                <div className="stat-label">Losses</div>
                <div className="stat-val" style={{ color: 'var(--red)' }}>{p.losses || 0}</div>
              </div>
              <div className="friend-profile-stat">
                <div className="stat-label">Win Rate</div>
                <div className="stat-val">{wr != null ? `${wr}%` : '—'}</div>
              </div>
            </div>

            {(p.total_kills || p.total_deaths || p.total_assists) ? (
              <div className="friend-profile-kda">
                Career K/D/A · {p.total_kills || 0}/{p.total_deaths || 0}/{p.total_assists || 0}
              </div>
            ) : null}

            <div className="card-title" style={{ marginTop: 18 }}>Recent Matches</div>
            {historyHidden ? (
              <div className="friends-empty" style={{ padding: '8px 0 12px' }}>
                This player hides match history
              </div>
            ) : matches.length === 0 ? (
              <div className="friends-empty">No ranked matches yet</div>
            ) : (
              matches.map((m) => (
                <div className="row" key={m.id}>
                  <div>
                    <div className="row-title">
                      {m.game}
                      {m.source === 'self_report' && <span className="match-source-badge">logged</span>}
                    </div>
                    <div className="row-sub">
                      {m.mode || 'Match'}
                      {m.played_at ? ` · ${new Date(m.played_at).toLocaleString()}` : ''}
                    </div>
                  </div>
                  <div className={`result ${m.result === 'win' ? 'win' : 'loss'}`}>
                    {m.source === 'self_report'
                      ? (m.result === 'win' ? 'WIN' : 'LOSS')
                      : (m.result === 'win' ? `WIN +${m.mmr_change || 0}` : `LOSS ${m.mmr_change || 0}`)}
                  </div>
                </div>
              ))
            )}

            <div className="card-title" style={{ marginTop: 16 }}>Shared Duels</div>
            {duels.length === 0 ? (
              <div className="friends-empty">No completed duels together yet</div>
            ) : (
              duels.map((d) => (
                <div className="row" key={d.id}>
                  <div>
                    <div className="row-title">{d.game}</div>
                    <div className="row-sub">
                      {d.mode || 'Duel'}
                      {d.created_at ? ` · ${new Date(d.created_at).toLocaleString()}` : ''}
                      {d.host_tag && d.challenger_tag ? ` · ${d.host_tag} vs ${d.challenger_tag}` : ''}
                    </div>
                  </div>
                  <div className={`result ${d.winner_id === myId ? 'win' : d.winner_id === p?.id ? 'loss' : ''}`}>
                    {duelWinnerLabel(d)}
                  </div>
                </div>
              ))
            )}

            <div className="card-title" style={{ marginTop: 16 }}>Recent Sessions</div>
            {sessions.length === 0 ? (
              <div className="friends-empty">No tracked sessions yet</div>
            ) : (
              sessions.map((s) => (
                <div className="row" key={s.id}>
                  <div>
                    <div className="row-title">{s.game}</div>
                    <div className="row-sub">
                      {formatDuration(s.duration_sec)}
                      {s.ended_at ? ` · ${new Date(s.ended_at).toLocaleString()}` : ''}
                      {s.kills != null ? ` · ${s.kills}/${s.deaths ?? 0}/${s.assists ?? 0}` : ''}
                    </div>
                  </div>
                  <div className="row-sub" style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {s.avg_ping_ms != null ? `${Math.round(s.avg_ping_ms)} ms` : '—'}
                    {s.avg_gpu_pct != null ? ` · GPU ${Number(s.avg_gpu_pct).toFixed(0)}%` : ''}
                  </div>
                </div>
              ))
            )}

            {(onBlock || onReport) && (
              <div className="friend-profile-actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
                {onReport && (
                  <button className="action-btn ghost friend-mini-btn" onClick={handleReport}>
                    Report
                  </button>
                )}
                {onBlock && (
                  <button
                    className="action-btn ghost friend-mini-btn"
                    style={{ color: 'var(--red)' }}
                    onClick={() => onBlock(p.id)}
                  >
                    Block
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Friends() {
  const {
    user,
    profile,
    showToast,
    reportCloudError,
    unreadBySender,
    refreshUnread,
    refreshProfile,
    pendingFriendChatId,
    clearPendingFriendChat,
  } = useNexForge();
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
  const [replyTo, setReplyTo] = useState(null);
  const [attachFile, setAttachFile] = useState(null);
  const [attachPreview, setAttachPreview] = useState(null);
  const [imageUrls, setImageUrls] = useState({});
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [reactions, setReactions] = useState({});
  const [pickerFor, setPickerFor] = useState(null);
  const [challenging, setChallenging] = useState(false);
  const [profileView, setProfileView] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [pinnedIds, setPinnedIds] = useState(() => new Set());
  const [statusDraft, setStatusDraft] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [msgSearch, setMsgSearch] = useState('');
  const [friendTyping, setFriendTyping] = useState(false);

  const scrollRef = useRef(null);
  const typingTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const selectedRef = useRef(null);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  const imageUrlsRef = useRef(imageUrls);
  useEffect(() => { imageUrlsRef.current = imageUrls; }, [imageUrls]);

  const loadFriendships = useCallback(async () => {
    if (!myId) return;
    try {
      const [{ data, error }, { data: pins, error: pinErr }] = await Promise.all([
        sb
          .from('friendships')
          .select('id,requester_id,addressee_id,status,created_at')
          .order('created_at', { ascending: false }),
        sb.from('friend_pins').select('friend_id').eq('user_id', myId),
      ]);
      if (error) throw error;
      if (pinErr) throw pinErr;
      const list = data || [];
      setRows(list);
      setPinnedIds(new Set((pins || []).map((p) => p.friend_id)));
      const otherIds = [...new Set(list.map((r) => (r.requester_id === myId ? r.addressee_id : r.requester_id)))];
      if (otherIds.length) {
        const { data: profs, error: pErr } = await sb
          .from('profiles')
          .select('id,gamer_tag,mmr,main_game,platform,last_seen_at,playing_game,custom_status,avatar_path,equipped_frame,equipped_banner,equipped_nameplate')
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

  const clearTyping = useCallback(async (peerId) => {
    if (!myId || !peerId) return;
    try {
      await sb.from('typing_signals').delete().eq('user_id', myId).eq('peer_id', peerId);
    } catch {
      /* best-effort */
    }
  }, [myId]);

  const loadConversation = useCallback(async (friendId, { markRead = false } = {}) => {
    if (!myId || !friendId) return;
    try {
      const { data, error } = await sb
        .from('messages')
        .select('id,sender_id,recipient_id,body,reply_to_id,image_path,created_at')
        .or(`and(sender_id.eq.${myId},recipient_id.eq.${friendId}),and(sender_id.eq.${friendId},recipient_id.eq.${myId})`)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      // Ignore responses that arrive after switching to another chat.
      if (selectedRef.current !== friendId) return;
      setMessages(data || []);
      const ids = (data || []).map((m) => m.id);
      if (ids.length) {
        const { data: reacts } = await sb
          .from('message_reactions')
          .select('message_id,user_id,emoji')
          .in('message_id', ids);
        if (selectedRef.current === friendId) {
          const grouped = {};
          for (const r of reacts || []) {
            (grouped[r.message_id] = grouped[r.message_id] || []).push(r);
          }
          setReactions(grouped);
        }
      } else {
        setReactions({});
      }
      // Private bucket — photos are shown through short-lived signed URLs.
      const missing = [...new Set((data || []).map((m) => m.image_path).filter((p) => p && !imageUrlsRef.current[p]))];
      if (missing.length) {
        const { data: signed } = await sb.storage.from('chat-images').createSignedUrls(missing, 3600);
        if (signed?.length) {
          setImageUrls((prev) => {
            const next = { ...prev };
            for (const s of signed) {
              if (s.signedUrl && s.path) next[s.path] = s.signedUrl;
            }
            return next;
          });
        }
      }
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

  useEffect(() => {
    if (!pendingFriendChatId) return;
    setSelectedId(pendingFriendChatId);
    clearPendingFriendChat();
  }, [pendingFriendChatId, clearPendingFriendChat]);

  // Ref mirror so the poll interval sees fresh unread counts without re-subscribing.
  const unreadBySenderRef = useRef(unreadBySender);
  useEffect(() => { unreadBySenderRef.current = unreadBySender; }, [unreadBySender]);

  useEffect(() => {
    setReplyTo(null);
    setPickerFor(null);
    setReactions({});
    setMsgSearch('');
    setFriendTyping(false);
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
    return () => {
      clearInterval(id);
      clearTyping(selectedId);
    };
  }, [selectedId, loadConversation, clearTyping]);

  useEffect(() => {
    setStatusDraft(profile?.custom_status || '');
  }, [profile?.custom_status]);

  useEffect(() => {
    if (!selectedId || !myId) return undefined;
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (!draft.trim()) {
      clearTyping(selectedId);
      return undefined;
    }
    typingTimerRef.current = setTimeout(async () => {
      try {
        const { error } = await sb.from('typing_signals').upsert(
          { user_id: myId, peer_id: selectedId, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,peer_id' },
        );
        if (error) throw error;
      } catch (err) {
        await reportCloudError(err);
      }
    }, 400);
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, [draft, selectedId, myId, clearTyping, reportCloudError]);

  useEffect(() => {
    if (!selectedId || !myId) {
      setFriendTyping(false);
      return undefined;
    }
    async function pollTyping() {
      try {
        const { data, error } = await sb
          .from('typing_signals')
          .select('updated_at')
          .eq('user_id', selectedId)
          .eq('peer_id', myId)
          .maybeSingle();
        if (error) throw error;
        if (data?.updated_at) {
          setFriendTyping(Date.now() - new Date(data.updated_at).getTime() < 3000);
        } else {
          setFriendTyping(false);
        }
      } catch {
        setFriendTyping(false);
      }
    }
    pollTyping();
    const id = setInterval(pollTyping, 2000);
    return () => {
      clearInterval(id);
      setFriendTyping(false);
    };
  }, [selectedId, myId]);

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
    f.sort((a, b) => {
      const aPin = pinnedIds.has(a.otherId) ? 0 : 1;
      const bPin = pinnedIds.has(b.otherId) ? 0 : 1;
      return aPin - bPin;
    });
    return { friends: f, incoming: inc, outgoing: out };
  }, [rows, profiles, myId, pinnedIds]);

  const relatedIds = useMemo(() => new Set(rows.map((r) => (r.requester_id === myId ? r.addressee_id : r.requester_id))), [rows, myId]);

  async function saveStatus() {
    const val = statusDraft.trim();
    setSavingStatus(true);
    try {
      const { error } = await sb
        .from('profiles')
        .update({ custom_status: val || null })
        .eq('id', myId);
      if (error) throw error;
      await refreshProfile();
      showToast('Status updated', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not update status.', 'error');
      await reportCloudError(err);
    } finally {
      setSavingStatus(false);
    }
  }

  async function togglePin(friendId, e) {
    e.stopPropagation();
    const pinned = pinnedIds.has(friendId);
    try {
      if (pinned) {
        const { error } = await sb
          .from('friend_pins')
          .delete()
          .eq('user_id', myId)
          .eq('friend_id', friendId);
        if (error) throw error;
        setPinnedIds((prev) => {
          const next = new Set(prev);
          next.delete(friendId);
          return next;
        });
      } else {
        const { error } = await sb
          .from('friend_pins')
          .insert({ user_id: myId, friend_id: friendId });
        if (error) throw error;
        setPinnedIds((prev) => new Set(prev).add(friendId));
      }
    } catch (err) {
      showToast(err?.message || 'Pin update failed.', 'error');
      await reportCloudError(err);
    }
  }

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

  function clearAttachment() {
    if (attachPreview) URL.revokeObjectURL(attachPreview);
    setAttachFile(null);
    setAttachPreview(null);
  }

  function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
      showToast('Only PNG, JPEG, WebP, or GIF images can be sent.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Images must be 5 MB or smaller.', 'error');
      return;
    }
    if (attachPreview) URL.revokeObjectURL(attachPreview);
    setAttachFile(file);
    setAttachPreview(URL.createObjectURL(file));
  }

  async function sendMessage() {
    const body = draft.trim();
    if ((!body && !attachFile) || !selectedId || sending) return;
    setSending(true);
    try {
      let imagePath = null;
      if (attachFile) {
        const ext = (attachFile.name.split('.').pop() || 'png').toLowerCase();
        imagePath = `${myId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await sb.storage
          .from('chat-images')
          .upload(imagePath, attachFile, { contentType: attachFile.type });
        if (upErr) throw upErr;
      }
      const { data, error } = await sb
        .from('messages')
        .insert({
          sender_id: myId,
          recipient_id: selectedId,
          body,
          reply_to_id: replyTo?.id ?? null,
          image_path: imagePath,
        })
        .select('id,sender_id,recipient_id,body,reply_to_id,image_path,created_at')
        .single();
      if (error) throw error;
      // Reuse the local preview as this message's display URL (skip a signed-URL round trip).
      if (imagePath && attachPreview) {
        setImageUrls((prev) => ({ ...prev, [imagePath]: attachPreview }));
      }
      setDraft('');
      setReplyTo(null);
      setAttachFile(null);
      setAttachPreview(null);
      clearTyping(selectedId);
      setMessages((prev) => [...(prev || []), data]);
    } catch (err) {
      showToast(err?.message || 'Message failed to send.', 'error');
      await reportCloudError(err);
    } finally {
      setSending(false);
    }
  }

  async function toggleReaction(messageId, emoji) {
    setPickerFor(null);
    const mine = (reactions[messageId] || []).some((r) => r.user_id === myId && r.emoji === emoji);
    // Optimistic update; the next conversation poll reconciles.
    setReactions((prev) => {
      const list = prev[messageId] || [];
      const next = mine
        ? list.filter((r) => !(r.user_id === myId && r.emoji === emoji))
        : [...list, { message_id: messageId, user_id: myId, emoji }];
      return { ...prev, [messageId]: next };
    });
    try {
      if (mine) {
        const { error } = await sb
          .from('message_reactions')
          .delete()
          .eq('message_id', messageId)
          .eq('user_id', myId)
          .eq('emoji', emoji);
        if (error) throw error;
      } else {
        const { error } = await sb
          .from('message_reactions')
          .insert({ message_id: messageId, user_id: myId, emoji });
        if (error && error.code !== '23505') throw error;
      }
    } catch (err) {
      showToast(err?.message || 'Reaction failed.', 'error');
      await reportCloudError(err);
    }
  }

  async function deleteMessage(m) {
    try {
      const { error } = await sb.from('messages').delete().eq('id', m.id);
      if (error) throw error;
      if (m.image_path) {
        // Best-effort cleanup of the attachment in storage.
        sb.storage.from('chat-images').remove([m.image_path]).catch(() => {});
      }
      setMessages((prev) => (prev ? prev.filter((x) => x.id !== m.id) : prev));
      showToast('Message deleted', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not delete message.', 'error');
      await reportCloudError(err);
    }
  }

  async function blockPlayer(id) {
    try {
      const { error: blockErr } = await sb.from('player_blocks').insert({
        blocker_id: myId,
        blocked_id: id,
      });
      if (blockErr) throw blockErr;
      const friendship = rows.find(
        (r) => (r.requester_id === myId && r.addressee_id === id)
          || (r.addressee_id === myId && r.requester_id === id),
      );
      if (friendship) {
        const { error: delErr } = await sb.from('friendships').delete().eq('id', friendship.id);
        if (delErr) throw delErr;
      }
      if (id === selectedId) setSelectedId(null);
      setProfileView(null);
      setProfileLoading(false);
      showToast('Player blocked', 'success');
      loadFriendships();
    } catch (err) {
      showToast(err?.message || 'Could not block player.', 'error');
      await reportCloudError(err);
    }
  }

  async function reportPlayer(id, reason) {
    try {
      const { error } = await sb.from('player_reports').insert({
        reporter_id: myId,
        reported_id: id,
        reason,
      });
      if (error) throw error;
      showToast('Report submitted', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not submit report.', 'error');
      await reportCloudError(err);
    }
  }

  async function challengeFriend() {
    if (!selectedId || challenging) return;
    const target = profiles[selectedId];
    const game = target?.main_game || profile?.main_game || 'Valorant';
    setChallenging(true);
    try {
      const { error: duelErr } = await sb.from('duels').insert({
        host_id: myId,
        host_tag: profile?.gamer_tag || 'Player',
        host_mmr: profile?.mmr || 1200,
        game,
        mode: 'Friend Challenge',
        details: `Challenge for ${target?.gamer_tag || 'a friend'} — accept from Matchmaking!`,
        status: 'open',
      });
      if (duelErr) throw duelErr;
      const body = `⚔️ I challenged you to a ${game} duel! Open Matchmaking and accept my "Friend Challenge" queue.`;
      const { data, error } = await sb
        .from('messages')
        .insert({ sender_id: myId, recipient_id: selectedId, body })
        .select('id,sender_id,recipient_id,body,reply_to_id,image_path,created_at')
        .single();
      if (error) throw error;
      setMessages((prev) => [...(prev || []), data]);
      showToast(`Duel challenge sent to ${target?.gamer_tag || 'friend'}`, 'success');
    } catch (err) {
      showToast(err?.message || 'Could not create the challenge.', 'error');
      await reportCloudError(err);
    } finally {
      setChallenging(false);
    }
  }

  const selectedProfile = selectedId ? profiles[selectedId] : null;
  const friendTag = selectedProfile?.gamer_tag || 'Friend';

  const messagesById = useMemo(() => {
    const map = {};
    for (const m of messages || []) map[m.id] = m;
    return map;
  }, [messages]);

  const displayedMessages = useMemo(() => {
    if (!messages) return null;
    const q = msgSearch.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => {
      if (m.body?.toLowerCase().includes(q)) return true;
      if (m.image_path && 'photo'.includes(q)) return true;
      return false;
    });
  }, [messages, msgSearch]);

  async function openFriendProfile(friendId) {
    if (!friendId) return;
    setProfileView({ profile: profiles[friendId] || null, matches: [], sessions: [] });
    setProfileLoading(true);
    try {
      const { data, error } = await sb.rpc('get_friend_profile', { p_friend_id: friendId });
      if (error) throw error;
      const local = profiles[friendId];
      if (data?.profile && local) {
        data.profile = {
          ...data.profile,
          avatar_path: local.avatar_path,
          equipped_frame: local.equipped_frame,
          equipped_banner: local.equipped_banner,
          equipped_nameplate: local.equipped_nameplate,
        };
      }
      setProfileView(data || null);
    } catch (err) {
      showToast(err?.message || 'Could not load friend profile.', 'error');
      setProfileView(null);
      await reportCloudError(err);
    } finally {
      setProfileLoading(false);
    }
  }

  function quoteLabel(m) {
    return m.sender_id === myId ? 'You' : friendTag;
  }

  function quoteSnippet(m) {
    if (!m) return '';
    if (m.body) return m.body.length > 80 ? `${m.body.slice(0, 80)}…` : m.body;
    return m.image_path ? 'Photo' : '';
  }

  function renderPersonRow(item, actions, { showPin = false } = {}) {
    const p = item.profile;
    const unread = unreadBySender[item.otherId] || 0;
    const isPinned = pinnedIds.has(item.otherId);
    return (
      <div
        key={item.id}
        className={`friend-row ${item.otherId === selectedId ? 'active' : ''} ${actions ? '' : 'clickable'}`}
        onClick={actions ? undefined : () => setSelectedId(item.otherId)}
      >
        <PlayerAvatar
          profile={p}
          size={40}
          className="friend-av"
          showPresence
          online={isOnline(p)}
          title="View profile"
          onClick={(e) => {
            e.stopPropagation();
            if (item.status === 'accepted' || !actions) openFriendProfile(item.otherId);
          }}
        />
        <div className="player-info">
          <div
            className="player-tag friend-tag-link"
            title="View profile"
            onClick={(e) => {
              if (actions) return;
              e.stopPropagation();
              openFriendProfile(item.otherId);
            }}
          >
            <GamerTag profile={p} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <PresenceBlock p={p} offlineDetail={presenceLine(p)} />
            {p && <SkillTagBadge mmr={p.mmr} small />}
          </div>
        </div>
        {showPin && (
          <button
            className={`friend-pin-btn ${isPinned ? 'pinned' : ''}`}
            title={isPinned ? 'Unpin' : 'Pin'}
            onClick={(e) => togglePin(item.otherId, e)}
          >
            📌
          </button>
        )}
        {unread > 0 && !actions && <span className="unread-pill">{unread}</span>}
        {actions}
      </div>
    );
  }

  return (
    <div className="friends-layout">
      <div className="card friends-list">
        <div className="status-edit-row">
          <input
            type="text"
            placeholder="Set a custom status…"
            value={statusDraft}
            maxLength={60}
            onChange={(e) => setStatusDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveStatus(); }}
          />
          <button className="action-btn ghost" onClick={saveStatus} disabled={savingStatus}>
            {savingStatus ? '…' : 'Save'}
          </button>
        </div>
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
          friends.map((item) => renderPersonRow(item, null, { showPin: true }))
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
              <PlayerAvatar
                profile={selectedProfile}
                size={40}
                className="friend-av"
                showPresence
                online={isOnline(selectedProfile)}
              />
              <div className="player-info">
                <div className="player-tag"><GamerTag profile={selectedProfile} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <PresenceBlock
                    p={selectedProfile}
                    offlineDetail={selectedProfile
                      ? `${selectedProfile.main_game || '—'} · ${selectedProfile.platform || 'PC'} · ${mmrToRank(selectedProfile.mmr)}`
                      : '—'}
                  />
                  {selectedProfile && <SkillTagBadge mmr={selectedProfile.mmr} small />}
                </div>
              </div>
              <button
                className="action-btn ghost friend-mini-btn"
                onClick={() => openFriendProfile(selectedId)}
                title="View wins, recent matches, and sessions"
              >
                Profile
              </button>
              <button
                className="action-btn primary friend-mini-btn"
                onClick={challengeFriend}
                disabled={challenging}
                title="Post a duel queue and invite this friend"
              >
                {challenging ? '…' : '⚔ Challenge'}
              </button>
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
            <div className="chat-search">
              <input
                type="text"
                placeholder="Search messages…"
                value={msgSearch}
                onChange={(e) => setMsgSearch(e.target.value)}
              />
            </div>
            <div className="chat-messages" ref={scrollRef}>
              {messages === null ? (
                <div className="friends-empty">Loading…</div>
              ) : displayedMessages.length === 0 ? (
                <div className="friends-empty">
                  {msgSearch.trim() ? 'No messages match your search.' : 'No messages yet — say hi!'}
                </div>
              ) : (
                displayedMessages.map((m) => {
                  const quoted = m.reply_to_id ? messagesById[m.reply_to_id] : null;
                  const imgUrl = m.image_path ? imageUrls[m.image_path] : null;
                  const mine = m.sender_id === myId;
                  const reacts = reactions[m.id] || [];
                  const byEmoji = {};
                  for (const r of reacts) {
                    (byEmoji[r.emoji] = byEmoji[r.emoji] || []).push(r.user_id);
                  }
                  return (
                    <div key={m.id} className={`chat-bubble-row ${mine ? 'mine' : ''}`}>
                      <div className="chat-bubble-stack">
                        <div className="chat-bubble">
                          {m.reply_to_id && (
                            <div className="chat-quote">
                              <span className="chat-quote-author">{quoted ? quoteLabel(quoted) : 'Earlier message'}</span>
                              {quoted && <span className="chat-quote-body">{quoteSnippet(quoted)}</span>}
                            </div>
                          )}
                          {m.image_path && (
                            imgUrl ? (
                              <img
                                className="chat-image"
                                src={imgUrl}
                                alt="Shared photo"
                                onClick={() => setLightboxUrl(imgUrl)}
                              />
                            ) : (
                              <div className="chat-image-loading">Loading photo…</div>
                            )
                          )}
                          {m.body && <div className="chat-body">{m.body}</div>}
                          <div className="chat-time">{timeLabel(m.created_at)}</div>
                        </div>
                        {Object.keys(byEmoji).length > 0 && (
                          <div className="chat-reactions">
                            {Object.entries(byEmoji).map(([emoji, userIds]) => (
                              <button
                                key={emoji}
                                className={`reaction-chip ${userIds.includes(myId) ? 'mine' : ''}`}
                                onClick={() => toggleReaction(m.id, emoji)}
                              >
                                {emoji}{userIds.length > 1 ? ` ${userIds.length}` : ''}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="chat-msg-actions">
                        <button
                          className="chat-reply-btn"
                          title="React"
                          onClick={() => setPickerFor((prev) => (prev === m.id ? null : m.id))}
                        >
                          ☺
                        </button>
                        <button className="chat-reply-btn" title="Reply" onClick={() => setReplyTo(m)}>
                          ↩
                        </button>
                        {mine && (
                          <button className="chat-reply-btn chat-delete-btn" title="Delete message" onClick={() => deleteMessage(m)}>
                            🗑
                          </button>
                        )}
                        {pickerFor === m.id && (
                          <div className="reaction-picker">
                            {REACTION_EMOJIS.map((emoji) => (
                              <button key={emoji} onClick={() => toggleReaction(m.id, emoji)}>{emoji}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {(replyTo || attachPreview) && (
              <div className="chat-compose-chips">
                {replyTo && (
                  <div className="compose-chip">
                    <span className="compose-chip-label">
                      ↩ Replying to <b>{quoteLabel(replyTo)}</b>{quoteSnippet(replyTo) ? `: ${quoteSnippet(replyTo)}` : ''}
                    </span>
                    <button className="compose-chip-x" onClick={() => setReplyTo(null)}>×</button>
                  </div>
                )}
                {attachPreview && (
                  <div className="compose-chip compose-chip-img">
                    <img src={attachPreview} alt="Attachment preview" />
                    <span className="compose-chip-label">{attachFile?.name}</span>
                    <button className="compose-chip-x" onClick={clearAttachment}>×</button>
                  </div>
                )}
              </div>
            )}
            {friendTyping && (
              <div className="chat-typing">{friendTag} is typing…</div>
            )}
            <div className="chat-input-row">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: 'none' }}
                onChange={pickImage}
              />
              <button
                className="action-btn ghost chat-attach-btn"
                title="Attach a photo"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2.5" />
                  <circle cx="8.7" cy="8.7" r="1.8" />
                  <path d="M21 15.5l-5-5L5 21" />
                </svg>
              </button>
              <input
                type="text"
                placeholder={`Message ${selectedProfile?.gamer_tag || ''}…`}
                value={draft}
                maxLength={2000}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
              />
              <button
                className="action-btn primary"
                onClick={sendMessage}
                disabled={sending || (!draft.trim() && !attachFile)}
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
      {lightboxUrl && (
        <div className="chat-lightbox" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Shared photo" onClick={(e) => e.stopPropagation()} />
          <button className="chat-lightbox-x" onClick={() => setLightboxUrl(null)}>×</button>
        </div>
      )}
      {(profileView || profileLoading) && (
        <FriendProfileModal
          data={profileView}
          loading={profileLoading}
          onClose={() => { setProfileView(null); setProfileLoading(false); }}
          onMessage={profileView?.profile?.id ? () => {
            setSelectedId(profileView.profile.id);
            setProfileView(null);
            setProfileLoading(false);
          } : undefined}
          showToast={showToast}
          myId={myId}
          onBlock={blockPlayer}
          onReport={reportPlayer}
        />
      )}
    </div>
  );
}
