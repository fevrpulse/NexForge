import { sb } from './supabase.js';

const RING_TIMEOUT_MS = 45_000;
const CONNECT_TIMEOUT_MS = 30_000;
const ICE_GATHER_TIMEOUT_MS = 6_000;

function callId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

function waitForIceGathering(pc, timeoutMs = ICE_GATHER_TIMEOUT_MS) {
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
 * 1:1 voice calls.
 * Signaling uses voice_call_signals rows + Realtime postgres_changes.
 * Handshake: ring → ready → offer (after ICE gather) → answer (after ICE gather).
 */
export function createVoiceCallController({ userId, onState, onError }) {
  let state = 'idle';
  let peerId = null;
  let activeCallId = null;
  let pc = null;
  let localStream = null;
  let remoteStream = null;
  let signalChannel = null;
  let ringTimer = null;
  let connectTimer = null;
  let muted = false;
  let deafened = false;
  let audioEl = null;
  let iceServers = null;
  let detail = '';
  let inputDeviceId = '';
  let outputDeviceId = '';
  let screenTrack = null;
  let screenStream = null;
  let remoteVideoTrack = null;
  let audioDevices = { inputs: [], outputs: [] };

  function emit(patch = {}) {
    onState?.({
      state,
      peerId,
      callId: activeCallId,
      muted,
      deafened,
      remoteStream,
      localStream,
      screenSharing: !!screenTrack,
      remoteVideoTrack,
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
        onError?.(new Error('Could not connect audio. Check mic permissions / try again.'));
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
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
      },
      video: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStream = stream;
    if (muted) {
      stream.getAudioTracks().forEach((t) => { t.enabled = false; });
    }
    await refreshDevices();
    return stream;
  }

  function applyDeafened() {
    const el = ensureAudioEl();
    el.muted = !!deafened;
    el.volume = deafened ? 0 : 1;
  }

  async function ensureIceServers() {
    if (!iceServers) iceServers = await buildIceServers();
    return iceServers;
  }

  function markConnected() {
    clearTimers();
    setState('connected', 'Connected');
    const el = ensureAudioEl();
    if (remoteStream) {
      el.srcObject = remoteStream;
      applyDeafened();
      el.play().catch(() => {});
    }
    if (outputDeviceId && typeof el.setSinkId === 'function') {
      el.setSinkId(outputDeviceId).catch(() => {});
    }
  }

  async function createPc() {
    const servers = await ensureIceServers();
    const conn = new RTCPeerConnection({
      iceServers: servers,
      iceCandidatePoolSize: 8,
    });

    conn.ontrack = (ev) => {
      if (ev.track.kind === 'audio') {
        remoteStream = ev.streams?.[0] || new MediaStream([ev.track]);
        const el = ensureAudioEl();
        el.srcObject = remoteStream;
        applyDeafened();
        el.play().catch(() => {});
      }
      if (ev.track.kind === 'video') {
        remoteVideoTrack = ev.track;
        ev.track.onended = () => {
          if (remoteVideoTrack === ev.track) {
            remoteVideoTrack = null;
            emit();
          }
        };
        emit();
        return;
      }
      emit();
    };

    conn.onconnectionstatechange = () => {
      const cs = conn.connectionState;
      detail = `Link: ${cs}`;
      emit();
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
      detail = `ICE: ${ice}`;
      emit();
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

  async function signal(recipientId, kind, body = {}) {
    const { error } = await sb.from('voice_call_signals').insert({
      call_id: activeCallId,
      sender_id: userId,
      recipient_id: recipientId,
      kind,
      body,
    });
    if (error) throw error;
  }

  async function handleSignal(row) {
    if (!row || row.sender_id === userId) return;
    const { kind, body, call_id: cid, sender_id: from } = row;

    if (kind === 'ring') {
      if (state !== 'idle') {
        await sb.from('voice_call_signals').insert({
          call_id: cid,
          sender_id: userId,
          recipient_id: from,
          kind: 'busy',
          body: {},
        }).then(() => {}).catch(() => {});
        return;
      }
      peerId = from;
      activeCallId = cid;
      setState('ringing', 'Incoming call');
      return;
    }

    if (kind === 'ready') {
      if (state !== 'calling' || cid !== activeCallId || from !== peerId) return;
      // Peer accepted — now create and send a complete offer.
      try {
        setState('connecting', 'Negotiating…');
        armConnectTimeout();
        await getMic();
        pc = await createPc();
        for (const track of localStream.getAudioTracks()) {
          pc.addTrack(track, localStream);
        }
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        setState('connecting', 'Gathering network…');
        await waitForIceGathering(pc);
        await signal(peerId, 'offer', {
          sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        });
        setState('connecting', 'Waiting for audio…');
      } catch (err) {
        await hangup({ notify: true });
        onError?.(err instanceof Error ? err : new Error('Could not start call media'));
      }
      return;
    }

    if (kind === 'offer') {
      if (state !== 'connecting' && state !== 'ringing' && state !== 'connected') return;
      if (cid !== activeCallId || from !== peerId) return;
      try {
        if (!pc) {
          await getMic();
          pc = await createPc();
          for (const track of localStream.getAudioTracks()) {
            pc.addTrack(track, localStream);
          }
        }
        setState(state === 'connected' ? 'connected' : 'connecting', body?.renegotiate ? 'Updating media…' : 'Answering…');
        await pc.setRemoteDescription(body.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (state !== 'connected') setState('connecting', 'Gathering network…');
        await waitForIceGathering(pc);
        await signal(peerId, 'answer', {
          sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        });
        if (state !== 'connected') {
          setState('connecting', 'Connecting audio…');
          armConnectTimeout();
        }
      } catch (err) {
        if (state !== 'connected') {
          await hangup({ notify: true });
          onError?.(err instanceof Error ? err : new Error('Could not answer call'));
        }
      }
      return;
    }

    if (kind === 'answer') {
      if (!pc || cid !== activeCallId || from !== peerId) return;
      try {
        await pc.setRemoteDescription(body.sdp);
        if (state !== 'connected') {
          setState('connecting', 'Connecting audio…');
          armConnectTimeout();
        }
      } catch (err) {
        if (state !== 'connected') {
          await hangup({ notify: true });
          onError?.(err instanceof Error ? err : new Error('Bad call answer'));
        }
      }
      return;
    }

    if (kind === 'hangup' || kind === 'decline' || kind === 'busy') {
      if (cid && activeCallId && cid !== activeCallId) return;
      await hangup({ notify: false });
      if (kind === 'busy') onError?.(new Error('Friend is busy on another call'));
      else if (kind === 'decline') onError?.(new Error('Call declined'));
    }
  }

  async function start(targetId) {
    if (!userId) throw new Error('Not signed in');
    if (!targetId) throw new Error('Pick a friend to call');
    if (state !== 'idle') throw new Error('Already in a call');

    peerId = targetId;
    activeCallId = callId();
    setState('calling', 'Ringing…');

    try {
      await ensureIceServers();
      await signal(targetId, 'ring', {});
      clearTimers();
      ringTimer = setTimeout(() => {
        hangup({ notify: true }).catch(() => {});
        onError?.(new Error('No answer'));
      }, RING_TIMEOUT_MS);
    } catch (err) {
      await hangup({ notify: false });
      throw err;
    }
  }

  async function accept() {
    if (state !== 'ringing' || !peerId || !activeCallId) return;
    setState('connecting', 'Joining…');
    armConnectTimeout();
    try {
      await ensureIceServers();
      await getMic();
      // Tell caller we are ready — they will send the offer.
      await signal(peerId, 'ready', {});
      setState('connecting', 'Waiting for offer…');
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
    await sb.from('voice_call_signals').insert({
      call_id: id,
      sender_id: userId,
      recipient_id: target,
      kind: 'decline',
      body: {},
    }).then(() => {}).catch(() => {});
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
    // Discord-style: deafen forces mute; undeafen restores hearing + unmute.
    if (deafened) setMuted(true);
    else if (wasDeafened) setMuted(false);
    applyDeafened();
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
    if (pc) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
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
    const el = ensureAudioEl();
    if (typeof el.setSinkId === 'function') {
      await el.setSinkId(outputDeviceId || '');
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
    if (pc && peerId) {
      pc.addTrack(screenTrack, stream);
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);
        await signal(peerId, 'offer', {
          sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
          renegotiate: true,
        });
      } catch {
        /* peer may still get track via addTrack in some stacks */
      }
    }
    emit();
  }

  async function stopScreenShare() {
    if (screenTrack && pc) {
      const sender = pc.getSenders().find((s) => s.track === screenTrack);
      if (sender) {
        try { pc.removeTrack(sender); } catch { /* ignore */ }
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

  async function startChannelVoice(_channelId, peerIds = []) {
    const first = (peerIds || []).find(Boolean);
    if (first) {
      await start(first);
      return;
    }
    // Alone in the channel — still open mic so mute/deafen/devices/share work.
    if (state !== 'idle') return;
    peerId = null;
    activeCallId = callId();
    setState('connecting', 'Joining voice…');
    try {
      await ensureIceServers();
      await getMic();
      setState('connected', 'In voice channel');
    } catch (err) {
      await hangup({ notify: false });
      throw err;
    }
  }

  async function leaveChannelVoice() {
    await hangup({ notify: true });
  }

  async function hangup({ notify = true } = {}) {
    clearTimers();
    const target = peerId;
    const id = activeCallId;

    if (notify && target && id) {
      await sb.from('voice_call_signals').insert({
        call_id: id,
        sender_id: userId,
        recipient_id: target,
        kind: 'hangup',
        body: {},
      }).then(() => {}).catch(() => {});
    }

    await stopScreenShare().catch(() => {});

    if (pc) {
      try { pc.close(); } catch { /* ignore */ }
      pc = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    remoteStream = null;
    remoteVideoTrack = null;
    if (audioEl) audioEl.srcObject = null;

    if (id) {
      await sb.from('voice_call_signals').delete().eq('call_id', id).then(() => {}).catch(() => {});
    }

    peerId = null;
    activeCallId = null;
    muted = false;
    deafened = false;
    detail = '';
    setState('idle', '');
  }

  async function startInbox() {
    if (!userId || signalChannel) return;

    // Catch anything queued while we were offline (last minute).
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
      /* table may not exist yet on old clients */
    }

    const ch = sb
      .channel(`voice-signals-${userId}`)
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

    await new Promise((resolve) => {
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          resolve(status);
        }
      });
    });
    signalChannel = ch;
  }

  async function stopInbox() {
    await hangup({ notify: true });
    if (signalChannel) {
      try { await sb.removeChannel(signalChannel); } catch { /* ignore */ }
      signalChannel = null;
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
    setDeafened,
    setInputDevice,
    setOutputDevice,
    refreshDevices,
    startScreenShare,
    stopScreenShare,
    startChannelVoice,
    leaveChannelVoice,
    startInbox,
    stopInbox,
    getState: () => ({
      state,
      peerId,
      callId: activeCallId,
      muted,
      deafened,
      screenSharing: !!screenTrack,
      remoteVideoTrack,
      detail,
      inputDeviceId,
      outputDeviceId,
      audioDevices,
    }),
  };
}
