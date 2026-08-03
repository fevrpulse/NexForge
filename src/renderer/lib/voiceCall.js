import { sb } from './supabase.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const RING_TIMEOUT_MS = 45_000;

function callId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function channelName(userId) {
  return `nf-call-${userId}`;
}

/**
 * 1:1 voice calls via WebRTC + Supabase Realtime broadcast inboxes.
 * Each user listens on `nf-call-{userId}`; signals are sent to the peer's inbox.
 */
export function createVoiceCallController({ userId, onState, onError }) {
  let state = 'idle'; // idle | calling | ringing | connecting | connected
  let peerId = null;
  let activeCallId = null;
  let pc = null;
  let localStream = null;
  let remoteStream = null;
  let inbox = null;
  let peerChannel = null;
  let ringTimer = null;
  let muted = false;
  let audioEl = null;
  let pendingOffer = null;
  /** ICE that arrived before remote description / before PC existed. */
  let pendingIce = [];
  let remoteReady = false;

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

  function clearRingTimer() {
    if (ringTimer) {
      clearTimeout(ringTimer);
      ringTimer = null;
    }
  }

  function ensureAudioEl() {
    if (audioEl) return audioEl;
    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.setAttribute('playsinline', 'true');
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
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        /* stale candidates are fine */
      }
    }
  }

  function createPc() {
    const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    remoteReady = false;
    conn.onicecandidate = (ev) => {
      if (!ev.candidate || !peerId || !activeCallId) return;
      send(peerId, {
        type: 'ice',
        callId: activeCallId,
        from: userId,
        candidate: ev.candidate.toJSON(),
      }).catch(() => {});
    };
    conn.ontrack = (ev) => {
      remoteStream = ev.streams?.[0] || new MediaStream([ev.track]);
      const el = ensureAudioEl();
      el.srcObject = remoteStream;
      el.play().catch(() => {});
      emit();
    };
    conn.onconnectionstatechange = () => {
      const cs = conn.connectionState;
      if (cs === 'connected') {
        clearRingTimer();
        setState('connected');
      }
      // Do not hang up on transient "disconnected" — ICE restarts often recover.
      if (cs === 'failed') {
        if (state !== 'idle') {
          hangup({ notify: true }).catch(() => {});
          onError?.(new Error('Call connection failed'));
        }
      }
    };
    return conn;
  }

  async function openChannel(targetId) {
    const topic = channelName(targetId);
    // Reuse an existing client channel for this topic when possible.
    const existing = sb.getChannels?.().find((c) => String(c.topic || '').endsWith(topic));
    if (existing && existing.state === 'joined') return existing;

    const ch = sb.channel(topic, {
      config: { broadcast: { self: false, ack: false } },
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Call channel timeout')), 10000);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(t);
          resolve();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(t);
          reject(new Error('Could not reach call channel'));
        }
      });
    });
    return ch;
  }

  async function subscribePeer(targetId) {
    if (peerChannel) {
      const same = String(peerChannel.topic || '').includes(targetId);
      if (same && peerChannel.state === 'joined') return peerChannel;
      try { await sb.removeChannel(peerChannel); } catch { /* ignore */ }
      peerChannel = null;
    }
    peerChannel = await openChannel(targetId);
    return peerChannel;
  }

  async function send(targetId, payload) {
    let ch = peerChannel;
    let ephemeral = false;
    if (!ch || !String(ch.topic || '').includes(targetId) || ch.state !== 'joined') {
      ch = await openChannel(targetId);
      ephemeral = ch !== peerChannel;
      if (!peerChannel) peerChannel = ch;
    }
    const result = await ch.send({ type: 'broadcast', event: 'signal', payload });
    if (result === 'timed out' || result === 'error') {
      throw new Error('Could not deliver call signal');
    }
    if (ephemeral && ch !== peerChannel) {
      try { await sb.removeChannel(ch); } catch { /* ignore */ }
    }
  }

  async function handleSignal(payload) {
    if (!payload || payload.from === userId) return;
    if (payload.to && payload.to !== userId) return;

    if (payload.type === 'offer') {
      if (state !== 'idle') {
        await send(payload.from, {
          type: 'busy',
          callId: payload.callId,
          from: userId,
        }).catch(() => {});
        return;
      }
      peerId = payload.from;
      activeCallId = payload.callId;
      pendingOffer = payload.sdp;
      pendingIce = [];
      remoteReady = false;
      setState('ringing');
      return;
    }

    if (payload.type === 'answer') {
      if (!pc || payload.callId !== activeCallId) return;
      clearRingTimer();
      await pc.setRemoteDescription(payload.sdp);
      remoteReady = true;
      await flushPendingIce();
      setState('connecting');
      return;
    }

    if (payload.type === 'ice') {
      if (payload.callId !== activeCallId || !payload.candidate) return;
      // Queue until we have a PC + remote description (common while still ringing).
      if (!pc || !remoteReady) {
        pendingIce.push(payload.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch {
        /* ignore */
      }
      return;
    }

    if (payload.type === 'hangup' || payload.type === 'decline' || payload.type === 'busy') {
      if (payload.callId && activeCallId && payload.callId !== activeCallId) return;
      const reason = payload.type;
      await hangup({ notify: false, reason });
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
      await subscribePeer(targetId);
      pc = createPc();
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      await send(targetId, {
        type: 'offer',
        callId: activeCallId,
        from: userId,
        to: targetId,
        sdp: { type: offer.type, sdp: offer.sdp },
      });

      clearRingTimer();
      ringTimer = setTimeout(() => {
        hangup({ notify: true, reason: 'timeout' }).catch(() => {});
        onError?.(new Error('No answer'));
      }, RING_TIMEOUT_MS);
    } catch (err) {
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
    try {
      await getMic();
      await subscribePeer(peerId);
      pc = createPc();
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
      await pc.setRemoteDescription(offer);
      remoteReady = true;
      await flushPendingIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await send(peerId, {
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
    await send(target, { type: 'decline', callId: id, from: userId }).catch(() => {});
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
    clearRingTimer();
    const target = peerId;
    const id = activeCallId;

    if (notify && target && id) {
      await send(target, { type: 'hangup', callId: id, from: userId }).catch(() => {});
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
    if (audioEl) {
      audioEl.srcObject = null;
    }
    if (peerChannel) {
      // Never remove the inbox channel if it happens to be the same reference.
      if (peerChannel !== inbox) {
        try { await sb.removeChannel(peerChannel); } catch { /* ignore */ }
      }
      peerChannel = null;
    }
    peerId = null;
    activeCallId = null;
    pendingOffer = null;
    pendingIce = [];
    remoteReady = false;
    muted = false;
    setState('idle');
  }

  async function startInbox() {
    if (!userId || inbox) return;
    const topic = channelName(userId);
    const ch = sb.channel(topic, {
      config: { broadcast: { self: false, ack: false } },
    });
    // Handlers must be registered before subscribe or early signals are missed.
    ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
      handleSignal(payload).catch((err) => onError?.(err));
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Call inbox timeout')), 10000);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(t);
          resolve();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(t);
          reject(new Error('Could not join call inbox'));
        }
      });
    });
    inbox = ch;
  }

  async function stopInbox() {
    await hangup({ notify: true });
    if (inbox) {
      try { await sb.removeChannel(inbox); } catch { /* ignore */ }
      inbox = null;
    }
    if (audioEl && audioEl.parentNode) {
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
