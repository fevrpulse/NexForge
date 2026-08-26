import { sb } from './supabase.js';

const RING_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 12_000;
/** Brief wait so SDP embeds host/srflx candidates — still trickle the rest. */
const ICE_GATHER_ASSIST_MS = 350;
const ICE_BATCH_MS = 70;

function randomCallId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable pair id so both sides share the same ICE broadcast room. */
function pairCallId(a, b, channelId) {
  const [x, y] = [String(a), String(b)].sort();
  const ch = String(channelId || 'dm').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36);
  return `vc_${ch}_${x.slice(0, 8)}_${y.slice(0, 8)}`;
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** Metered Open Relay static-auth TURN (public secret from their docs). */
async function buildIceServers() {
  const stun = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  try {
    const secret = 'openrelayprojectsecret';
    const expiry = Math.floor(Date.now() / 1000) + 6 * 3600;
    const username = String(expiry);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(username));
    const credential = bytesToBase64(new Uint8Array(sig));
    return [
      ...stun,
      { urls: 'stun:staticauth.openrelay.metered.ca:80' },
      {
        urls: [
          'turn:staticauth.openrelay.metered.ca:80',
          'turn:staticauth.openrelay.metered.ca:443',
          'turn:staticauth.openrelay.metered.ca:443?transport=tcp',
          'turns:staticauth.openrelay.metered.ca:443',
        ],
        username,
        credential,
      },
    ];
  } catch {
    return stun;
  }
}

function waitForIceGathering(pc, timeoutMs = ICE_GATHER_ASSIST_MS) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

/**
 * Voice: 1:1 DMs + multi-person channel mesh.
 * Signaling: voice_call_signals + Realtime. ICE via broadcast (batched) with DB fallback.
 * Channel mesh: one RTCPeerConnection per other member; lower UUID initiates.
 */
export function createVoiceCallController({ userId, onState, onError }) {
  let state = 'idle';
  /** @type {'idle'|'dm'|'channel'} */
  let mode = 'idle';
  let channelId = null;
  let localStream = null;
  let signalChannel = null;
  let ringTimer = null;
  let muted = false;
  let deafened = false;
  let iceServers = null;
  let detail = '';
  let inputDeviceId = '';
  let outputDeviceId = '';
  let screenTrack = null;
  let screenStream = null;
  let audioDevices = { inputs: [], outputs: [] };
  /** Incoming DM ring before accept (not yet in peers map). */
  let pendingDm = null; // { peerId, callId }
  /** @type {Map<string, any>} */
  const peers = new Map();

  function peerSnapshot() {
    return [...peers.values()].map((p) => ({
      peerId: p.peerId,
      connected: !!p.connected,
      callId: p.callId,
    }));
  }

  function primaryPeerId() {
    if (pendingDm?.peerId) return pendingDm.peerId;
    const first = peers.values().next().value;
    return first?.peerId || null;
  }

  function remoteVideoTrack() {
    for (const p of peers.values()) {
      if (p.remoteVideoTrack) return p.remoteVideoTrack;
    }
    return null;
  }

  function emit(patch = {}) {
    onState?.({
      state,
      mode,
      channelId,
      peerId: primaryPeerId(),
      peers: peerSnapshot(),
      callId: pendingDm?.callId || peers.values().next().value?.callId || null,
      muted,
      deafened,
      localStream,
      screenSharing: !!screenTrack,
      remoteVideoTrack: remoteVideoTrack(),
      localScreenTrack: screenTrack,
      detail,
      inputDeviceId,
      outputDeviceId,
      audioDevices,
      ...patch,
    });
  }

  function setState(next, nextDetail = '') {
    state = next;
    if (nextDetail !== undefined) detail = nextDetail;
    emit();
  }

  function refreshChannelDetail() {
    if (mode !== 'channel') return;
    const n = [...peers.values()].filter((p) => p.connected).length;
    const total = peers.size;
    if (total === 0) setState('connected', 'Alone in voice');
    else setState('connected', `Voice · ${n}/${total} linked`);
  }

  function clearRingTimer() {
    if (ringTimer) {
      clearTimeout(ringTimer);
      ringTimer = null;
    }
  }

  async function refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      audioDevices = {
        inputs: all.filter((d) => d.kind === 'audioinput'),
        outputs: all.filter((d) => d.kind === 'audiooutput'),
      };
      emit();
      return audioDevices;
    } catch {
      return audioDevices;
    }
  }

  async function getMic() {
    const baseAudio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    const tryConstraints = async (audio) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      localStream = stream;
      if (muted) {
        stream.getAudioTracks().forEach((t) => { t.enabled = false; });
      }
      await refreshDevices();
      return stream;
    };

    try {
      return await tryConstraints({
        ...baseAudio,
        ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
      });
    } catch (firstErr) {
      // Stale deviceId / overconstrained — retry with default mic.
      if (inputDeviceId) {
        try {
          inputDeviceId = '';
          return await tryConstraints(baseAudio);
        } catch {
          /* fall through to friendly error */
        }
      }
      const name = firstErr?.name || '';
      if (name === 'NotAllowedError' || /permission/i.test(String(firstErr?.message || ''))) {
        throw new Error('Microphone permission is required to join voice. Allow mic access and try again.');
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        throw new Error('No microphone found. Plug one in and try again.');
      }
      if (name === 'NotReadableError') {
        throw new Error('Microphone is in use by another app. Close it and try again.');
      }
      // Chromium sometimes reports getUserMedia failure as TypeError: Failed to fetch.
      if (/failed to fetch/i.test(String(firstErr?.message || ''))) {
        throw new Error('Could not access the microphone. Check Windows privacy settings for NexForge and try again.');
      }
      throw firstErr;
    }
  }

  async function ensureIceServers() {
    if (!iceServers) iceServers = await buildIceServers();
    return iceServers;
  }

  async function ensureLocalMedia() {
    // Mic first — clearer errors; ICE servers are only needed once peers connect.
    if (!localStream) await getMic();
    await ensureIceServers();
    return localStream;
  }

  function applyDeafenedToAll() {
    for (const p of peers.values()) {
      if (!p.audioEl) continue;
      p.audioEl.muted = !!deafened;
      p.audioEl.volume = deafened ? 0 : 1;
    }
  }

  function ensurePeerAudioEl(session) {
    if (session.audioEl) return session.audioEl;
    const el = document.createElement('audio');
    el.autoplay = true;
    el.setAttribute('playsinline', 'true');
    el.volume = 1;
    el.style.display = 'none';
    document.body.appendChild(el);
    session.audioEl = el;
    if (outputDeviceId && typeof el.setSinkId === 'function') {
      el.setSinkId(outputDeviceId).catch(() => {});
    }
    applyDeafenedToAll();
    return el;
  }

  async function signalTo(recipientId, callId, kind, body = {}) {
    const { error } = await sb.from('voice_call_signals').insert({
      call_id: callId,
      sender_id: userId,
      recipient_id: recipientId,
      kind,
      body,
    });
    if (error) throw error;
  }

  async function leavePeerIce(session) {
    if (session.iceBatchTimer) {
      clearTimeout(session.iceBatchTimer);
      session.iceBatchTimer = null;
    }
    session.iceBatch = [];
    if (session.iceChannel) {
      try { await sb.removeChannel(session.iceChannel); } catch { /* ignore */ }
      session.iceChannel = null;
    }
  }

  async function ensurePeerIce(session) {
    if (!session.callId) return null;
    if (session.iceChannel) return session.iceChannel;
    const ch = sb.channel(`voice-ice-${session.callId}`, {
      config: { broadcast: { ack: false, self: false } },
    });
    ch.on('broadcast', { event: 'candidates' }, ({ payload }) => {
      if (!payload || payload.from === userId) return;
      const list = payload.candidates || (payload.candidate ? [payload.candidate] : []);
      for (const c of list) applyRemoteCandidate(session, c);
    });
    await new Promise((resolve) => {
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          resolve(status);
        }
      });
    });
    session.iceChannel = ch;
    return ch;
  }

  function queueIceCandidate(session, candidate) {
    if (!candidate) return;
    session.iceBatch.push(candidate);
    if (session.iceBatchTimer) return;
    session.iceBatchTimer = setTimeout(() => {
      session.iceBatchTimer = null;
      flushIceBatch(session).catch(() => {});
    }, ICE_BATCH_MS);
  }

  async function flushIceBatch(session) {
    const batch = session.iceBatch.splice(0, session.iceBatch.length);
    if (!batch.length || !session.peerId || !session.callId) return;
    if (session.iceChannel) {
      try {
        await session.iceChannel.send({
          type: 'broadcast',
          event: 'candidates',
          payload: { from: userId, candidates: batch },
        });
        return;
      } catch {
        /* fall through */
      }
    }
    await signalTo(session.peerId, session.callId, 'ice', { candidates: batch }).catch(() => {});
  }

  async function flushPendingCandidates(session) {
    if (!session.pc) return;
    const queued = session.pendingRemoteCandidates.splice(0, session.pendingRemoteCandidates.length);
    for (const c of queued) {
      try {
        await session.pc.addIceCandidate(c);
      } catch {
        /* stale */
      }
    }
  }

  async function applyRemoteCandidate(session, candidate) {
    if (!candidate) return;
    if (!session.pc || !session.pc.remoteDescription) {
      session.pendingRemoteCandidates.push(candidate);
      return;
    }
    try {
      await session.pc.addIceCandidate(candidate);
    } catch {
      /* ignore */
    }
  }

  function markPeerConnected(session) {
    if (session.connected) return;
    session.connected = true;
    clearRingTimer();
    if (session.connectTimer) {
      clearTimeout(session.connectTimer);
      session.connectTimer = null;
    }
    if (mode === 'channel') refreshChannelDetail();
    else setState('connected', 'Connected');
    emit();
  }

  async function createPeerPc(session) {
    const servers = await ensureIceServers();
    const conn = new RTCPeerConnection({
      iceServers: servers,
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    conn.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      queueIceCandidate(session, ev.candidate.toJSON());
    };

    conn.ontrack = (ev) => {
      if (ev.track.kind === 'audio') {
        session.remoteStream = ev.streams?.[0] || new MediaStream([ev.track]);
        const el = ensurePeerAudioEl(session);
        el.srcObject = session.remoteStream;
        applyDeafenedToAll();
        el.play().catch(() => {});
        markPeerConnected(session);
      }
      if (ev.track.kind === 'video') {
        session.remoteVideoTrack = ev.track;
        ev.track.onended = () => {
          if (session.remoteVideoTrack === ev.track) {
            session.remoteVideoTrack = null;
            emit();
          }
        };
        emit();
      }
      emit();
    };

    conn.onconnectionstatechange = () => {
      const cs = conn.connectionState;
      if (cs === 'connected') markPeerConnected(session);
      if (cs === 'failed' || cs === 'closed' || cs === 'disconnected') {
        if (mode === 'channel') {
          if (cs === 'failed') dropPeer(session.peerId, { notify: false }).catch(() => {});
        } else if (cs === 'failed' && state !== 'idle') {
          hangup({ notify: true }).catch(() => {});
          onError?.(new Error('Call connection failed'));
        }
      }
      emit();
    };

    conn.oniceconnectionstatechange = () => {
      const ice = conn.iceConnectionState;
      if (ice === 'connected' || ice === 'completed') markPeerConnected(session);
      if (ice === 'failed' && mode !== 'channel' && state !== 'idle') {
        hangup({ notify: true }).catch(() => {});
        onError?.(new Error('Call connection failed'));
      }
    };

    return conn;
  }

  async function ensurePeerMedia(session) {
    await ensureLocalMedia();
    if (!session.pc) {
      session.pc = await createPeerPc(session);
      for (const track of localStream.getAudioTracks()) {
        session.pc.addTrack(track, localStream);
      }
      if (screenTrack && screenStream) {
        try { session.pc.addTrack(screenTrack, screenStream); } catch { /* ignore */ }
      }
    }
    return session.pc;
  }

  function getOrCreateSession(peerId, callId) {
    let session = peers.get(peerId);
    if (session) {
      if (callId && !session.callId) session.callId = callId;
      return session;
    }
    session = {
      peerId,
      callId: callId || null,
      pc: null,
      pendingRemoteCandidates: [],
      iceBatch: [],
      iceBatchTimer: null,
      iceChannel: null,
      remoteStream: null,
      remoteVideoTrack: null,
      audioEl: null,
      connected: false,
      connectTimer: null,
      makingOffer: false,
    };
    peers.set(peerId, session);
    return session;
  }

  async function sendOffer(session, { renegotiate = false } = {}) {
    await ensurePeerIce(session);
    await ensurePeerMedia(session);
    const offer = await session.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await session.pc.setLocalDescription(offer);
    await waitForIceGathering(session.pc, ICE_GATHER_ASSIST_MS);
    await signalTo(session.peerId, session.callId, 'offer', {
      sdp: { type: session.pc.localDescription.type, sdp: session.pc.localDescription.sdp },
      renegotiate: !!renegotiate,
      channel: mode === 'channel',
      channel_id: channelId,
    });
    await flushIceBatch(session).catch(() => {});
  }

  async function sendAnswer(session, sdp) {
    await ensurePeerIce(session);
    await ensurePeerMedia(session);
    await session.pc.setRemoteDescription(sdp);
    await flushPendingCandidates(session);
    const answer = await session.pc.createAnswer();
    await session.pc.setLocalDescription(answer);
    await waitForIceGathering(session.pc, ICE_GATHER_ASSIST_MS);
    await signalTo(session.peerId, session.callId, 'answer', {
      sdp: { type: session.pc.localDescription.type, sdp: session.pc.localDescription.sdp },
      channel: mode === 'channel',
      channel_id: channelId,
    });
    await flushIceBatch(session).catch(() => {});
  }

  async function dropPeer(peerId, { notify = true } = {}) {
    const session = peers.get(peerId);
    if (!session) return;
    if (notify && session.callId) {
      await signalTo(peerId, session.callId, 'hangup', {
        channel: mode === 'channel',
        channel_id: channelId,
      }).catch(() => {});
    }
    if (session.connectTimer) clearTimeout(session.connectTimer);
    await leavePeerIce(session);
    if (session.pc) {
      try { session.pc.close(); } catch { /* ignore */ }
    }
    if (session.audioEl) {
      session.audioEl.srcObject = null;
      try { session.audioEl.remove(); } catch { /* ignore */ }
    }
    if (session.callId) {
      await sb.from('voice_call_signals').delete().eq('call_id', session.callId).then(() => {}).catch(() => {});
    }
    peers.delete(peerId);
    if (mode === 'channel') refreshChannelDetail();
    else emit();
  }

  async function initiatePeer(peerId, { channel = false } = {}) {
    if (!peerId || peerId === userId || peers.has(peerId)) return;
    const cid = channel && channelId
      ? pairCallId(userId, peerId, channelId)
      : randomCallId();
    const session = getOrCreateSession(peerId, cid);
    session.callId = cid;

    if (channel) {
      // Deterministic initiator avoids glare.
      if (String(userId) > String(peerId)) {
        // Wait for the other side to ring us.
        return;
      }
    }

    try {
      await ensureLocalMedia();
      Promise.all([ensurePeerIce(session), ensurePeerMedia(session)]).catch(() => {});
      await signalTo(peerId, cid, 'ring', {
        channel: !!channel,
        channel_id: channelId,
      });
      if (!channel) {
        setState('calling', 'Ringing…');
        clearRingTimer();
        ringTimer = setTimeout(() => {
          hangup({ notify: true }).catch(() => {});
          onError?.(new Error('No answer'));
        }, RING_TIMEOUT_MS);
      } else {
        session.connectTimer = setTimeout(() => {
          dropPeer(peerId, { notify: false }).catch(() => {});
        }, CONNECT_TIMEOUT_MS);
      }
    } catch (err) {
      await dropPeer(peerId, { notify: false });
      throw err;
    }
  }

  async function autoAcceptChannelPeer(from, cid, body) {
    if (mode !== 'channel') return;
    if (body?.channel_id && channelId && body.channel_id !== channelId) return;
    const session = getOrCreateSession(from, cid);
    session.callId = cid;
    try {
      await Promise.all([ensurePeerIce(session), ensurePeerMedia(session)]);
      await signalTo(from, cid, 'ready', { channel: true, channel_id: channelId });
      session.connectTimer = setTimeout(() => {
        dropPeer(from, { notify: false }).catch(() => {});
      }, CONNECT_TIMEOUT_MS);
      refreshChannelDetail();
    } catch (err) {
      await dropPeer(from, { notify: false });
      onError?.(err instanceof Error ? err : new Error('Could not link voice peer'));
    }
  }

  async function handleSignal(row) {
    if (!row || row.sender_id === userId) return;
    const { kind, body, call_id: cid, sender_id: from } = row;
    const isChannelSignal = !!(body?.channel || body?.channel_id);

    if (kind === 'ring') {
      // Multi-person channel: auto-link, no ringtone UI.
      if (mode === 'channel' && isChannelSignal) {
        await autoAcceptChannelPeer(from, cid, body || {});
        return;
      }
      if (state !== 'idle' || mode !== 'idle') {
        await signalTo(from, cid, 'busy', {}).catch(() => {});
        return;
      }
      pendingDm = { peerId: from, callId: cid };
      const session = getOrCreateSession(from, cid);
      session.callId = cid;
      ensurePeerIce(session).catch(() => {});
      setState('ringing', 'Incoming call');
      return;
    }

    if (kind === 'ready') {
      const session = peers.get(from);
      if (!session || session.callId !== cid) return;
      if (mode === 'dm' && state !== 'calling') return;
      try {
        if (mode === 'dm') setState('connecting', 'Negotiating…');
        session.makingOffer = true;
        await sendOffer(session);
        if (mode === 'dm') setState('connecting', 'Connecting…');
      } catch (err) {
        if (mode === 'channel') await dropPeer(from, { notify: true });
        else {
          await hangup({ notify: true });
          onError?.(err instanceof Error ? err : new Error('Could not start call media'));
        }
      } finally {
        session.makingOffer = false;
      }
      return;
    }

    if (kind === 'offer') {
      let session = peers.get(from);
      if (!session && mode === 'channel' && isChannelSignal) {
        session = getOrCreateSession(from, cid);
      }
      if (!session || (session.callId && session.callId !== cid)) return;
      session.callId = cid;
      if (mode === 'dm' && state !== 'connecting' && state !== 'ringing' && state !== 'connected') return;
      try {
        if (mode === 'dm' && state !== 'connected') {
          setState('connecting', body?.renegotiate ? 'Updating media…' : 'Answering…');
        }
        await sendAnswer(session, body.sdp);
        if (mode === 'dm' && state !== 'connected') setState('connecting', 'Connecting…');
      } catch (err) {
        if (mode === 'channel') await dropPeer(from, { notify: true });
        else if (state !== 'connected') {
          await hangup({ notify: true });
          onError?.(err instanceof Error ? err : new Error('Could not answer call'));
        }
      }
      return;
    }

    if (kind === 'answer') {
      const session = peers.get(from);
      if (!session || !session.pc || session.callId !== cid) return;
      try {
        await session.pc.setRemoteDescription(body.sdp);
        await flushPendingCandidates(session);
        if (mode === 'dm' && state !== 'connected') setState('connecting', 'Connecting…');
      } catch (err) {
        if (mode === 'channel') await dropPeer(from, { notify: true });
        else if (state !== 'connected') {
          await hangup({ notify: true });
          onError?.(err instanceof Error ? err : new Error('Bad call answer'));
        }
      }
      return;
    }

    if (kind === 'ice') {
      const session = peers.get(from);
      if (!session || session.callId !== cid) return;
      const list = body?.candidates || (body?.candidate ? [body.candidate] : []);
      for (const c of list) await applyRemoteCandidate(session, c);
      return;
    }

    if (kind === 'hangup' || kind === 'decline' || kind === 'busy') {
      if (mode === 'channel' && peers.has(from)) {
        await dropPeer(from, { notify: false });
        return;
      }
      if (pendingDm?.callId && cid && pendingDm.callId !== cid) return;
      const session = peers.get(from);
      if (session?.callId && cid && session.callId !== cid) return;
      await hangup({ notify: false });
      if (kind === 'busy') onError?.(new Error('Friend is busy on another call'));
      else if (kind === 'decline') onError?.(new Error('Call declined'));
    }
  }

  async function start(targetId) {
    if (!userId) throw new Error('Not signed in');
    if (!targetId) throw new Error('Pick a friend to call');
    if (state !== 'idle' || mode !== 'idle') throw new Error('Already in a call');

    mode = 'dm';
    channelId = null;
    pendingDm = null;
    await initiatePeer(targetId, { channel: false });
  }

  async function accept() {
    if (state !== 'ringing' || !pendingDm) return;
    const { peerId, callId } = pendingDm;
    const session = getOrCreateSession(peerId, callId);
    mode = 'dm';
    setState('connecting', 'Joining…');
    try {
      await Promise.all([ensurePeerIce(session), ensurePeerMedia(session)]);
      await signalTo(peerId, callId, 'ready', {});
      pendingDm = null;
      setState('connecting', 'Waiting for offer…');
      session.connectTimer = setTimeout(() => {
        if (state === 'connecting') {
          hangup({ notify: true }).catch(() => {});
          onError?.(new Error('Could not connect audio. Check mic permissions / try again.'));
        }
      }, CONNECT_TIMEOUT_MS);
    } catch (err) {
      await hangup({ notify: true });
      throw err;
    }
  }

  async function decline() {
    if (state !== 'ringing' || !pendingDm) {
      await hangup({ notify: false });
      return;
    }
    const { peerId, callId } = pendingDm;
    await hangup({ notify: false });
    await signalTo(peerId, callId, 'decline', {}).catch(() => {});
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

  function setDeafened(next) {
    const wasDeafened = deafened;
    deafened = !!next;
    if (deafened) setMuted(true);
    else if (wasDeafened) setMuted(false);
    applyDeafenedToAll();
    emit();
  }

  async function setInputDevice(deviceId) {
    inputDeviceId = deviceId || '';
    if (!localStream) {
      emit();
      return;
    }
    const oldTrack = localStream.getAudioTracks()[0];
    const fresh = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
      },
    });
    const newTrack = fresh.getAudioTracks()[0];
    if (muted) newTrack.enabled = false;
    for (const session of peers.values()) {
      if (!session.pc) continue;
      const sender = session.pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
      if (sender) await sender.replaceTrack(newTrack);
    }
    if (oldTrack) {
      oldTrack.stop();
      localStream.removeTrack(oldTrack);
    }
    localStream.addTrack(newTrack);
    fresh.getTracks().forEach((t) => {
      if (t !== newTrack) t.stop();
    });
    emit();
  }

  async function setOutputDevice(deviceId) {
    outputDeviceId = deviceId || '';
    for (const session of peers.values()) {
      const el = session.audioEl;
      if (el && typeof el.setSinkId === 'function') {
        await el.setSinkId(outputDeviceId || '').catch(() => {});
      }
    }
    emit();
  }

  async function startScreenShare() {
    if (state !== 'connected' && state !== 'connecting') {
      throw new Error('Join a call or voice channel first');
    }
    if (screenTrack) return;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 },
      audio: false,
    });
    screenStream = stream;
    screenTrack = stream.getVideoTracks()[0];
    screenTrack.onended = () => {
      stopScreenShare().catch(() => {});
    };
    for (const session of peers.values()) {
      if (!session.pc || !session.peerId) continue;
      try {
        session.pc.addTrack(screenTrack, stream);
        await sendOffer(session, { renegotiate: true });
      } catch {
        /* peer may still get track */
      }
    }
    emit();
  }

  async function stopScreenShare() {
    for (const session of peers.values()) {
      if (!session.pc || !screenTrack) continue;
      const sender = session.pc.getSenders().find((s) => s.track === screenTrack);
      if (sender) {
        try { session.pc.removeTrack(sender); } catch { /* ignore */ }
      }
    }
    if (screenTrack) {
      try { screenTrack.stop(); } catch { /* ignore */ }
    }
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
    }
    screenTrack = null;
    screenStream = null;
    emit();
  }

  async function startChannelVoice(chId, peerIds = []) {
    if (!userId) throw new Error('Not signed in');
    if (!chId) throw new Error('Missing voice channel');
    if (mode === 'dm' && state !== 'idle') throw new Error('Leave your call before joining voice');

    // Already in this channel — just sync peers.
    if (mode === 'channel' && channelId === chId && state !== 'idle') {
      await syncChannelPeers(peerIds);
      return;
    }

    mode = 'channel';
    channelId = chId;
    pendingDm = null;
    clearRingTimer();
    setState('connecting', 'Joining voice…');

    try {
      await ensureLocalMedia();
      setState('connected', 'Alone in voice');
      const others = [...new Set((peerIds || []).filter((id) => id && id !== userId))];
      await Promise.all(others.map((id) => initiatePeer(id, { channel: true }).catch(() => {})));
      refreshChannelDetail();
    } catch (err) {
      await hangup({ notify: false });
      throw err;
    }
  }

  async function syncChannelPeers(peerIds = []) {
    if (mode !== 'channel' || !channelId) return;
    const wanted = new Set((peerIds || []).filter((id) => id && id !== userId));
    for (const id of [...peers.keys()]) {
      if (!wanted.has(id)) await dropPeer(id, { notify: true });
    }
    for (const id of wanted) {
      if (!peers.has(id)) await initiatePeer(id, { channel: true }).catch(() => {});
    }
    refreshChannelDetail();
  }

  async function leaveChannelVoice() {
    await hangup({ notify: true });
  }

  async function hangup({ notify = true } = {}) {
    clearRingTimer();
    const peerList = [...peers.keys()];
    pendingDm = null;

    for (const id of peerList) {
      await dropPeer(id, { notify });
    }

    await stopScreenShare().catch(() => {});

    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }

    mode = 'idle';
    channelId = null;
    muted = false;
    deafened = false;
    detail = '';
    setState('idle', '');
  }

  async function startInbox() {
    if (!userId || signalChannel) return;

    ensureIceServers().catch(() => {});

    try {
      const since = new Date(Date.now() - 60_000).toISOString();
      const { data } = await sb
        .from('voice_call_signals')
        .select('id,call_id,sender_id,recipient_id,kind,body,created_at')
        .eq('recipient_id', userId)
        .eq('kind', 'ring')
        .gte('created_at', since)
        .order('created_at', { ascending: true });
      for (const row of data || []) {
        await handleSignal(row);
      }
    } catch {
      /* table may not exist yet */
    }

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ch = sb
        .channel(`voice-signals-${userId}-${attempt}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'voice_call_signals',
            filter: `recipient_id=eq.${userId}`,
          },
          (payload) => {
            handleSignal(payload.new).catch((err) => onError?.(err));
          },
        );
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Voice signaling timed out')), 8000);
          ch.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              clearTimeout(timer);
              resolve(status);
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              clearTimeout(timer);
              reject(new Error(`Voice inbox ${status}`));
            }
          });
        });
        signalChannel = ch;
        return;
      } catch (err) {
        lastErr = err;
        try { await sb.removeChannel(ch); } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    onError?.(lastErr || new Error('Voice signaling is down'));
  }

  async function stopInbox() {
    await hangup({ notify: true });
    if (signalChannel) {
      try { await sb.removeChannel(signalChannel); } catch { /* ignore */ }
      signalChannel = null;
    }
  }

  return {
    start,
    accept,
    decline,
    hangup: () => hangup({ notify: true }),
    setMuted,
    setDeafened,
    setInputDevice,
    setOutputDevice,
    refreshDevices,
    startScreenShare,
    stopScreenShare,
    startChannelVoice,
    syncChannelPeers,
    leaveChannelVoice,
    startInbox,
    stopInbox,
    getState: () => ({
      state,
      mode,
      channelId,
      peerId: primaryPeerId(),
      peers: peerSnapshot(),
      muted,
      deafened,
      screenSharing: !!screenTrack,
      remoteVideoTrack: remoteVideoTrack(),
      localScreenTrack: screenTrack,
      detail,
      inputDeviceId,
      outputDeviceId,
      audioDevices,
    }),
  };
}
