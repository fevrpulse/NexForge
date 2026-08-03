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
    audioEl.playsInline = true;
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

  function createPc() {
    const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
      remoteStream = ev.streams[0] || new MediaStream([ev.track]);
      const el = ensureAudioEl();
      el.srcObject = remoteStream;
      el.play().catch(() => {});
      emit();
    };
    conn.onconnectionstatechange = () => {
      const cs = conn.connectionState;
      if (cs === 'connected') setState('connected');
      if (cs === 'failed' || cs === 'disconnected' || cs === 'closed') {
        if (state !== 'idle') {
          hangup({ notify: cs === 'failed' }).catch(() => {});
        }
      }
    };
    return conn;
  }

  async function subscribePeer(targetId) {
    if (peerChannel) {
      try { await sb.removeChannel(peerChannel); } catch { /* ignore */ }
      peerChannel = null;
    }
    const ch = sb.channel(`nf-call-${targetId}`, {
      config: { broadcast: { self: false } },
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Call channel timeout')), 8000);
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
    peerChannel = ch;
    return ch;
  }

  async function send(targetId, payload) {
    // Prefer an already-open peer channel; otherwise open briefly.
    let ch = peerChannel;
    let ephemeral = false;
    if (!ch || !String(ch.topic || '').includes(targetId)) {
      ch = sb.channel(`nf-call-${targetId}`, {
        config: { broadcast: { self: false } },
      });
      ephemeral = true;
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Signal timeout')), 8000);
        ch.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(t);
            resolve();
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(t);
            reject(new Error('Signal failed'));
          }
        });
      });
    }
    await ch.send({ type: 'broadcast', event: 'signal', payload });
    if (ephemeral) {
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
      setState('ringing');
      // stash remote offer until accept
      handleSignal._pendingOffer = payload.sdp;
      return;
    }

    if (payload.type === 'answer') {
      if (!pc || payload.callId !== activeCallId) return;
      clearRingTimer();
      await pc.setRemoteDescription(payload.sdp);
      setState('connecting');
      return;
    }

    if (payload.type === 'ice') {
      if (!pc || payload.callId !== activeCallId || !payload.candidate) return;
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch {
        /* late/failed candidates are fine */
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
    const offer = handleSignal._pendingOffer;
    handleSignal._pendingOffer = null;
    if (!offer) throw new Error('Missing call offer');

    setState('connecting');
    try {
      await getMic();
      await subscribePeer(peerId);
      pc = createPc();
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
      await pc.setRemoteDescription(offer);
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

  async function hangup({ notify = true, reason = 'hangup' } = {}) {
    clearRingTimer();
    const target = peerId;
    const id = activeCallId;

    if (notify && target && id) {
      await send(target, { type: reason === 'timeout' ? 'hangup' : 'hangup', callId: id, from: userId }).catch(() => {});
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
      try { await sb.removeChannel(peerChannel); } catch { /* ignore */ }
      peerChannel = null;
    }
    peerId = null;
    activeCallId = null;
    handleSignal._pendingOffer = null;
    muted = false;
    setState('idle');
  }

  async function startInbox() {
    if (!userId || inbox) return;
    const ch = sb.channel(`nf-call-${userId}`, {
      config: { broadcast: { self: false } },
    });
    ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
      handleSignal(payload).catch((err) => onError?.(err));
    });
    await new Promise((resolve) => {
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          resolve(status);
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
