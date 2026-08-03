import { sb } from './supabase.js';

/** STUN + public TURN so calls work across NATs/firewalls (not just LAN). */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:openrelay.metered.ca:80' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turns:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const RING_TIMEOUT_MS = 45_000;
const CONNECT_TIMEOUT_MS = 25_000;

function callId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function inboxTopic(userId) {
  return `nf-call-${userId}`;
}

function roomTopic(a, b) {
  const ids = [String(a), String(b)].sort();
  return `nf-call-room-${ids[0]}_${ids[1]}`;
}

/**
 * 1:1 voice calls via WebRTC.
 * Ring on personal inbox; SDP/ICE on a shared room channel so both peers
 * stay subscribed for the whole negotiation.
 */
export function createVoiceCallController({ userId, onState, onError }) {
  let state = 'idle'; // idle | calling | ringing | connecting | connected
  let peerId = null;
  let activeCallId = null;
  let pc = null;
  let localStream = null;
  let remoteStream = null;
  let inbox = null;
  let room = null;
  let ringTimer = null;
  let connectTimer = null;
  let muted = false;
  let audioEl = null;
  let pendingOffer = null;
  let pendingIce = [];
  let remoteReady = false;
  let makingOffer = false;

  function emit(patch = {}) {
    onState?.({
      state,
      peerId,
      callId: activeCallId,
      muted,
      remoteStream,
      localStream,
      ...patch,
    });
  }

  function setState(next) {
    state = next;
    emit();
  }

  function clearTimers() {
    if (ringTimer) {
      clearTimeout(ringTimer);
      ringTimer = null;
    }
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  }

  function armConnectTimeout() {
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      if (state === 'connecting' || state === 'calling') {
        hangup({ notify: true }).catch(() => {});
        onError?.(new Error('Could not connect — try again (firewall/network).'));
      }
    }, CONNECT_TIMEOUT_MS);
  }

  function ensureAudioEl() {
    if (audioEl) return audioEl;
    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.setAttribute('playsinline', 'true');
    audioEl.volume = 1;
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
    return audioEl;
  }

  async function getMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    localStream = stream;
    return stream;
  }

  async function flushPendingIce() {
    if (!pc || !remoteReady || !pendingIce.length) return;
    const queued = pendingIce.splice(0, pendingIce.length);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate ? new RTCIceCandidate(candidate) : null);
      } catch {
        /* stale ok */
      }
    }
  }

  function markConnected() {
    clearTimers();
    setState('connected');
    const el = ensureAudioEl();
    if (remoteStream) {
      el.srcObject = remoteStream;
      el.play().catch(() => {});
    }
  }

  function createPc() {
    const conn = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 4,
    });
    remoteReady = false;

    conn.onicecandidate = (ev) => {
      // null candidate = end-of-candidates; still useful to forward
      if (!peerId || !activeCallId || !room) return;
      roomSend({
        type: 'ice',
        callId: activeCallId,
        from: userId,
        candidate: ev.candidate ? ev.candidate.toJSON() : null,
      }).catch(() => {});
    };

    conn.ontrack = (ev) => {
      remoteStream = ev.streams?.[0] || new MediaStream([ev.track]);
      const el = ensureAudioEl();
      el.srcObject = remoteStream;
      el.play().catch(() => {});
      emit();
      if (conn.connectionState === 'connected' || conn.iceConnectionState === 'connected') {
        markConnected();
      }
    };

    conn.onconnectionstatechange = () => {
      const cs = conn.connectionState;
      if (cs === 'connected') markConnected();
      if (cs === 'failed') {
        if (state !== 'idle') {
          hangup({ notify: true }).catch(() => {});
          onError?.(new Error('Call connection failed'));
        }
      }
    };

    conn.oniceconnectionstatechange = () => {
      const ice = conn.iceConnectionState;
      if (ice === 'connected' || ice === 'completed') markConnected();
      if (ice === 'failed') {
        if (state !== 'idle') {
          hangup({ notify: true }).catch(() => {});
          onError?.(new Error('Call connection failed'));
        }
      }
    };

    return conn;
  }

  async function subscribeChannel(topic, { onSignal } = {}) {
    // Drop a previous non-inbox channel with the same topic if any.
    const existing = sb.getChannels?.().find((c) => String(c.topic || '').endsWith(topic));
    if (existing) {
      try { await sb.removeChannel(existing); } catch { /* ignore */ }
    }

    const ch = sb.channel(topic, {
      config: { broadcast: { self: false, ack: false } },
    });
    if (onSignal) {
      ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
        onSignal(payload);
      });
    }
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Call channel timeout')), 12000);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(t);
          resolve();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(t);
          reject(new Error('Could not join call channel'));
        }
      });
    });
    return ch;
  }

  async function joinRoom(otherId) {
    if (room) {
      try { await sb.removeChannel(room); } catch { /* ignore */ }
      room = null;
    }
    const topic = roomTopic(userId, otherId);
    room = await subscribeChannel(topic, {
      onSignal: (payload) => {
        handleSignal(payload).catch((err) => onError?.(err));
      },
    });
    return room;
  }

  async function roomSend(payload) {
    if (!room || room.state !== 'joined') {
      throw new Error('Call room not ready');
    }
    const result = await room.send({ type: 'broadcast', event: 'signal', payload });
    if (result === 'timed out' || result === 'error') {
      throw new Error('Could not deliver call signal');
    }
  }

  async function inboxSend(targetId, payload) {
    const topic = inboxTopic(targetId);
    const ch = await subscribeChannel(topic);
    try {
      const result = await ch.send({ type: 'broadcast', event: 'signal', payload });
      if (result === 'timed out' || result === 'error') {
        throw new Error('Could not deliver call invite');
      }
    } finally {
      // Don't remove if this is somehow our own inbox.
      if (ch !== inbox) {
        try { await sb.removeChannel(ch); } catch { /* ignore */ }
      }
    }
  }

  async function handleSignal(payload) {
    if (!payload || payload.from === userId) return;
    if (payload.to && payload.to !== userId) return;

    if (payload.type === 'offer') {
      // Offers arrive on the personal inbox (ring).
      if (state !== 'idle') {
        try {
          await inboxSend(payload.from, {
            type: 'busy',
            callId: payload.callId,
            from: userId,
          });
        } catch { /* ignore */ }
        return;
      }
      peerId = payload.from;
      activeCallId = payload.callId;
      pendingOffer = payload.sdp;
      pendingIce = [];
      remoteReady = false;
      setState('ringing');
      // Join the room immediately so caller ICE is not dropped while we ring.
      try {
        await joinRoom(payload.from);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error('Could not join call room'));
      }
      return;
    }

    if (payload.type === 'answer') {
      if (!pc || payload.callId !== activeCallId) return;
      if (makingOffer) return;
      try {
        await pc.setRemoteDescription(payload.sdp);
        remoteReady = true;
        await flushPendingIce();
        setState('connecting');
        armConnectTimeout();
      } catch (err) {
        onError?.(err);
        await hangup({ notify: true });
      }
      return;
    }

    if (payload.type === 'ice') {
      if (payload.callId !== activeCallId) return;
      if (!pc || !remoteReady) {
        pendingIce.push(payload.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(
          payload.candidate ? new RTCIceCandidate(payload.candidate) : null,
        );
      } catch {
        /* ignore */
      }
      return;
    }

    if (payload.type === 'hangup' || payload.type === 'decline' || payload.type === 'busy') {
      if (payload.callId && activeCallId && payload.callId !== activeCallId) return;
      const reason = payload.type;
      await hangup({ notify: false });
      if (reason === 'busy') onError?.(new Error('Friend is busy on another call'));
      else if (reason === 'decline') onError?.(new Error('Call declined'));
      return;
    }
  }

  async function start(targetId) {
    if (!userId) throw new Error('Not signed in');
    if (!targetId) throw new Error('Pick a friend to call');
    if (state !== 'idle') throw new Error('Already in a call');

    peerId = targetId;
    activeCallId = callId();
    pendingIce = [];
    remoteReady = false;
    pendingOffer = null;
    setState('calling');

    try {
      await getMic();
      await joinRoom(targetId);

      pc = createPc();
      // Explicit sendrecv audio so the answer side always gets a track.
      for (const track of localStream.getAudioTracks()) {
        pc.addTrack(track, localStream);
      }
      if (!pc.getTransceivers().some((t) => t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio')) {
        pc.addTransceiver('audio', { direction: 'sendrecv' });
      }

      makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      makingOffer = false;

      // Ring on peer inbox (they may not be in the room yet).
      await inboxSend(targetId, {
        type: 'offer',
        callId: activeCallId,
        from: userId,
        to: targetId,
        sdp: { type: offer.type, sdp: offer.sdp },
      });

      clearTimers();
      ringTimer = setTimeout(() => {
        hangup({ notify: true }).catch(() => {});
        onError?.(new Error('No answer'));
      }, RING_TIMEOUT_MS);
    } catch (err) {
      makingOffer = false;
      await hangup({ notify: false });
      throw err;
    }
  }

  async function accept() {
    if (state !== 'ringing' || !peerId) return;
    const offer = pendingOffer;
    pendingOffer = null;
    if (!offer) throw new Error('Missing call offer');

    setState('connecting');
    armConnectTimeout();
    try {
      await getMic();
      if (!room || room.state !== 'joined') {
        await joinRoom(peerId);
      }

      pc = createPc();
      for (const track of localStream.getAudioTracks()) {
        pc.addTrack(track, localStream);
      }

      await pc.setRemoteDescription(offer);
      remoteReady = true;
      await flushPendingIce();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await roomSend({
        type: 'answer',
        callId: activeCallId,
        from: userId,
        to: peerId,
        sdp: { type: answer.type, sdp: answer.sdp },
      });
    } catch (err) {
      await hangup({ notify: true });
      throw err;
    }
  }

  async function decline() {
    if (state !== 'ringing' || !peerId) {
      await hangup({ notify: false });
      return;
    }
    const target = peerId;
    const id = activeCallId;
    await hangup({ notify: false });
    await inboxSend(target, { type: 'decline', callId: id, from: userId }).catch(() => {});
  }

  function setMuted(next) {
    muted = !!next;
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
    }
    emit();
  }

  async function hangup({ notify = true } = {}) {
    clearTimers();
    const target = peerId;
    const id = activeCallId;

    if (notify && target && id) {
      const payload = { type: 'hangup', callId: id, from: userId };
      if (room && room.state === 'joined') {
        await roomSend(payload).catch(() => {});
      } else {
        await inboxSend(target, payload).catch(() => {});
      }
    }

    if (pc) {
      try { pc.close(); } catch { /* ignore */ }
      pc = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    remoteStream = null;
    if (audioEl) audioEl.srcObject = null;

    if (room) {
      try { await sb.removeChannel(room); } catch { /* ignore */ }
      room = null;
    }

    peerId = null;
    activeCallId = null;
    pendingOffer = null;
    pendingIce = [];
    remoteReady = false;
    makingOffer = false;
    muted = false;
    setState('idle');
  }

  async function startInbox() {
    if (!userId || inbox) return;
    const topic = inboxTopic(userId);
    inbox = await subscribeChannel(topic, {
      onSignal: (payload) => {
        handleSignal(payload).catch((err) => onError?.(err));
      },
    });
  }

  async function stopInbox() {
    await hangup({ notify: true });
    if (inbox) {
      try { await sb.removeChannel(inbox); } catch { /* ignore */ }
      inbox = null;
    }
    if (audioEl?.parentNode) {
      audioEl.parentNode.removeChild(audioEl);
      audioEl = null;
    }
  }

  return {
    start,
    accept,
    decline,
    hangup: () => hangup({ notify: true }),
    setMuted,
    startInbox,
    stopInbox,
    getState: () => ({ state, peerId, callId: activeCallId, muted }),
  };
}
