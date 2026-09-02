import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { createVoiceCallController } from '../lib/voiceCall.js';
import PlayerAvatar, { GamerTag } from './PlayerAvatar.jsx';
import { sb } from '../lib/supabase.js';

const VoiceCallContext = createContext(null);

export function useVoiceCall() {
  return useContext(VoiceCallContext);
}

export function VoiceCallProvider({ children }) {
  const {
    user,
    showToast,
    setScreen,
    openFriendChat,
    dndEnabled,
    overlayEnabled,
  } = useNexForge();
  const [call, setCall] = useState({
    state: 'idle',
    mode: 'idle',
    channelId: null,
    peerId: null,
    peers: [],
    muted: false,
    deafened: false,
    screenSharing: false,
    remoteVideoTrack: null,
    localScreenTrack: null,
    detail: '',
    inputDeviceId: '',
    outputDeviceId: '',
    audioDevices: { inputs: [], outputs: [] },
  });
  const [peerProfile, setPeerProfile] = useState(null);
  const [peerProfiles, setPeerProfiles] = useState({});
  const overlayEnabledRef = useRef(overlayEnabled);
  useEffect(() => { overlayEnabledRef.current = overlayEnabled; }, [overlayEnabled]);
  const dndRef = useRef(dndEnabled);
  useEffect(() => { dndRef.current = dndEnabled; }, [dndEnabled]);
  const ctrlRef = useRef(null);
  const ringAudioRef = useRef(null);

  const stopRingtone = useCallback(() => {
    const ctx = ringAudioRef.current;
    if (ctx) {
      try { ctx.close(); } catch { /* ignore */ }
      ringAudioRef.current = null;
    }
  }, []);

  const playRingtone = useCallback(() => {
    if (dndEnabled) return;
    stopRingtone();
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      ringAudioRef.current = ctx;
      const beep = (at, freq) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.value = 0.0001;
        o.connect(g);
        g.connect(ctx.destination);
        o.start(at);
        g.gain.exponentialRampToValueAtTime(0.08, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
        o.stop(at + 0.4);
      };
      let t = ctx.currentTime;
      const pulse = () => {
        if (ringAudioRef.current !== ctx) return;
        beep(t, 880);
        beep(t + 0.45, 660);
        t += 1.6;
        if (t < ctx.currentTime + 40) {
          setTimeout(pulse, 1600);
        }
      };
      pulse();
    } catch {
      /* ignore */
    }
  }, [dndEnabled, stopRingtone]);

  useEffect(() => {
    if (!user?.id) {
      ctrlRef.current?.stopInbox?.();
      ctrlRef.current = null;
      setCall({
        state: 'idle',
        mode: 'idle',
        channelId: null,
        peerId: null,
        peers: [],
        muted: false,
        deafened: false,
        screenSharing: false,
        remoteVideoTrack: null,
        localScreenTrack: null,
        detail: '',
        inputDeviceId: '',
        outputDeviceId: '',
        audioDevices: { inputs: [], outputs: [] },
      });
      setPeerProfile(null);
      setPeerProfiles({});
      stopRingtone();
      return undefined;
    }

    const ctrl = createVoiceCallController({
      userId: user.id,
      onState: (next) => {
        setCall({
          state: next.state,
          mode: next.mode || 'idle',
          channelId: next.channelId || null,
          peerId: next.peerId,
          peers: next.peers || [],
          muted: next.muted,
          deafened: next.deafened,
          screenSharing: next.screenSharing,
          remoteVideoTrack: next.remoteVideoTrack || null,
          localScreenTrack: next.localScreenTrack || null,
          detail: next.detail || '',
          inputDeviceId: next.inputDeviceId || '',
          outputDeviceId: next.outputDeviceId || '',
          audioDevices: next.audioDevices || { inputs: [], outputs: [] },
        });
        if (next.state === 'idle') {
          setPeerProfile(null);
          setPeerProfiles({});
          stopRingtone();
        }
        if (next.state === 'ringing' && next.mode !== 'channel') {
          playRingtone();
          // Do Not Disturb is advertised as muting overlay toasts, so it has to
          // cover force: true (which bypasses main-process suppression) and the
          // raise-the-app fallback too — neither should be thrown over a
          // fullscreen game. The in-app call UI still shows the call.
          if (!dndRef.current) {
            (async () => {
              let sender = 'Incoming call';
              try {
                if (next.peerId) {
                  const { data } = await sb.from('profiles').select('gamer_tag').eq('id', next.peerId).maybeSingle();
                  if (data?.gamer_tag) sender = data.gamer_tag;
                }
              } catch { /* tag is best-effort */ }
              if (!overlayEnabledRef.current) {
                window.nexforge?.showMainWindow?.();
              }
              window.nexforge?.overlayNotify?.({
                kind: 'call',
                sender,
                body: overlayEnabledRef.current
                  ? 'Press your overlay keybind to open the HUD, or accept in NexForge'
                  : 'Open NexForge to Accept or Decline',
                force: true,
              });
            })();
          }
        }
        if (next.state === 'connecting' || next.state === 'connected' || next.state === 'calling') {
          stopRingtone();
        }
      },
      onError: (err) => {
        showToast(err?.message || 'Call ended', 'error');
      },
    });
    ctrlRef.current = ctrl;
    ctrl.startInbox().catch(() => {});

    return () => {
      ctrl.stopInbox().catch(() => {});
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
      stopRingtone();
    };
  }, [user?.id, showToast, playRingtone, stopRingtone]);

  useEffect(() => {
    const peerId = call.peerId;
    if (!peerId || call.mode === 'channel') {
      if (call.mode !== 'channel') setPeerProfile(null);
      return undefined;
    }
    let active = true;
    sb.from('profiles')
      .select('id,gamer_tag,display_name,avatar_path,equipped_frame,clan_tag,mmr')
      .eq('id', peerId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setPeerProfile(data || { id: peerId, gamer_tag: 'Friend' });
      });
    return () => { active = false; };
  }, [call.peerId, call.mode]);

  useEffect(() => {
    const ids = (call.peers || []).map((p) => p.peerId).filter(Boolean);
    if (call.mode !== 'channel' || !ids.length) {
      if (call.mode !== 'channel') setPeerProfiles({});
      return undefined;
    }
    let active = true;
    sb.from('profiles')
      .select('id,gamer_tag,display_name,avatar_path,equipped_frame,clan_tag,mmr')
      .in('id', ids)
      .then(({ data }) => {
        if (!active) return;
        const map = {};
        for (const p of data || []) map[p.id] = p;
        for (const id of ids) {
          if (!map[id]) map[id] = { id, gamer_tag: 'Player' };
        }
        setPeerProfiles(map);
      });
    return () => { active = false; };
  }, [call.mode, call.peers]);

  const startCall = useCallback(async (friendId) => {
    if (!ctrlRef.current) {
      showToast('Sign in to place calls.', 'error');
      return;
    }
    try {
      setScreen('friends');
      openFriendChat?.(friendId);
      await ctrlRef.current.start(friendId);
      showToast('Calling…', 'success');
    } catch (err) {
      const msg = /Permission|NotAllowed|NotFound/i.test(String(err?.message || err))
        ? 'Microphone permission is required for calls.'
        : (err?.message || 'Could not start call.');
      showToast(msg, 'error');
    }
  }, [showToast, setScreen, openFriendChat]);

  const acceptCall = useCallback(async () => {
    try {
      stopRingtone();
      if (call.peerId) {
        setScreen('friends');
        openFriendChat?.(call.peerId);
      }
      await ctrlRef.current?.accept();
    } catch (err) {
      showToast(err?.message || 'Could not answer call.', 'error');
    }
  }, [call.peerId, openFriendChat, setScreen, showToast, stopRingtone]);

  const declineCall = useCallback(async () => {
    stopRingtone();
    await ctrlRef.current?.decline();
  }, [stopRingtone]);

  const hangup = useCallback(async () => {
    stopRingtone();
    if (ctrlRef.current?.getState?.()?.mode === 'channel' || call.mode === 'channel') {
      await ctrlRef.current?.leaveChannelVoice?.();
    } else {
      await ctrlRef.current?.hangup();
    }
  }, [stopRingtone, call.mode]);

  const toggleMute = useCallback(() => {
    ctrlRef.current?.setMuted(!call.muted);
  }, [call.muted]);

  const toggleDeafen = useCallback(() => {
    ctrlRef.current?.setDeafened(!call.deafened);
  }, [call.deafened]);

  const toggleScreenShare = useCallback(async () => {
    try {
      if (call.screenSharing) await ctrlRef.current?.stopScreenShare();
      else await ctrlRef.current?.startScreenShare();
    } catch (err) {
      showToast(err?.message || 'Screen share failed.', 'error');
    }
  }, [call.screenSharing, showToast]);

  const setInputDevice = useCallback(async (id) => {
    try {
      await ctrlRef.current?.setInputDevice(id);
    } catch (err) {
      showToast(err?.message || 'Could not switch mic.', 'error');
    }
  }, [showToast]);

  const setOutputDevice = useCallback(async (id) => {
    try {
      await ctrlRef.current?.setOutputDevice(id);
    } catch (err) {
      showToast(err?.message || 'Could not switch speakers.', 'error');
    }
  }, [showToast]);

  const startChannelVoice = useCallback(async (channelId, peerIds) => {
    if (!ctrlRef.current) {
      throw new Error('Voice is still starting up — wait a second and try again.');
    }
    await ctrlRef.current.startChannelVoice(channelId, peerIds);
  }, []);

  const syncChannelPeers = useCallback(async (peerIds) => {
    if (!ctrlRef.current?.syncChannelPeers) return;
    await ctrlRef.current.syncChannelPeers(peerIds);
  }, []);

  const leaveChannelVoice = useCallback(async () => {
    await ctrlRef.current?.leaveChannelVoice?.();
  }, []);

  useEffect(() => {
    if (call.state === 'connected' || call.state === 'connecting') {
      ctrlRef.current?.refreshDevices?.();
    }
  }, [call.state]);

  const value = useMemo(() => ({
    call,
    peerProfile,
    peerProfiles,
    startCall,
    startChannelVoice,
    syncChannelPeers,
    leaveChannelVoice,
    acceptCall,
    declineCall,
    hangup,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    setInputDevice,
    setOutputDevice,
    inCall: call.state !== 'idle',
  }), [
    call, peerProfile, peerProfiles, startCall, startChannelVoice, syncChannelPeers, leaveChannelVoice,
    acceptCall, declineCall, hangup, toggleMute, toggleDeafen, toggleScreenShare,
    setInputDevice, setOutputDevice,
  ]);

  return (
    <VoiceCallContext.Provider value={value}>
      {children}
      <VoiceCallOverlay />
    </VoiceCallContext.Provider>
  );
}

function statusLabel(call) {
  if (call?.detail) return call.detail;
  if (call?.mode === 'channel') {
    if (call?.state === 'connecting') return 'Joining voice…';
    if (call?.state === 'connected') return 'In voice channel';
  }
  if (call?.state === 'calling') return 'Calling…';
  if (call?.state === 'ringing') return 'Incoming call';
  if (call?.state === 'connecting') return 'Connecting…';
  if (call?.state === 'connected') return 'Connected';
  return '';
}

function VoiceCallOverlay() {
  const ctx = useVoiceCall();
  if (!ctx || ctx.call.state === 'idle') return null;
  return <VoiceCallOverlayActive ctx={ctx} />;
}

function VoiceCallOverlayActive({ ctx }) {
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const [shareExpanded, setShareExpanded] = useState(false);
  const [shareFullscreen, setShareFullscreen] = useState(false);
  const {
    call, peerProfile, peerProfiles, acceptCall, declineCall, hangup,
    toggleMute, toggleDeafen, toggleScreenShare, setInputDevice, setOutputDevice,
  } = ctx;
  const inputs = call.audioDevices?.inputs || [];
  const outputs = call.audioDevices?.outputs || [];
  const inLive = call.state === 'connected' || call.state === 'connecting';
  const isChannel = call.mode === 'channel';
  const channelPeers = call.peers || [];
  const shareTrack = call.remoteVideoTrack || call.localScreenTrack || null;
  const shareLabel = call.remoteVideoTrack
    ? (isChannel ? 'Someone is sharing' : 'Friend is sharing')
    : (call.localScreenTrack ? 'You are sharing' : '');

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    if (shareTrack) {
      el.srcObject = new MediaStream([shareTrack]);
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
      setShareExpanded(false);
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    }
    return undefined;
  }, [shareTrack]);

  useEffect(() => {
    const onFs = () => setShareFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  async function toggleShareFullscreen() {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        setShareExpanded(true);
        await stage.requestFullscreen();
      }
    } catch {
      setShareExpanded(true);
    }
  }

  return (
    <div className={`voice-call-overlay ${call.state === 'ringing' ? 'incoming' : ''} ${shareExpanded ? 'share-open' : ''} ${isChannel ? 'channel' : ''}`}>
      <div className={`voice-call-card ${shareTrack ? 'has-share' : ''} ${isChannel ? 'channel-card' : ''}`}>
        {shareTrack && (
          <div
            ref={stageRef}
            className={`voice-share-stage ${shareExpanded || shareFullscreen ? 'expanded' : ''}`}
          >
            <video ref={videoRef} className="voice-share-preview" autoPlay playsInline muted />
            <div className="voice-share-toolbar">
              <span className="voice-share-label">{shareLabel}</span>
              <button
                type="button"
                className="action-btn ghost friend-mini-btn"
                onClick={() => setShareExpanded((v) => !v)}
              >
                {shareExpanded || shareFullscreen ? 'Shrink' : 'Enlarge'}
              </button>
              <button
                type="button"
                className="action-btn ghost friend-mini-btn"
                onClick={toggleShareFullscreen}
              >
                {shareFullscreen ? 'Exit full screen' : 'Full screen'}
              </button>
            </div>
          </div>
        )}
        <div className="voice-call-main">
        {isChannel ? (
          <div className="voice-channel-avatars" aria-label="Voice channel members">
            {channelPeers.length === 0 ? (
              <div className="voice-channel-empty-av">You</div>
            ) : (
              channelPeers.slice(0, 6).map((p) => (
                <div
                  key={p.peerId}
                  className={`voice-channel-av ${p.connected ? 'linked' : 'linking'}`}
                  title={peerProfiles[p.peerId]?.gamer_tag || 'Player'}
                >
                  <PlayerAvatar profile={peerProfiles[p.peerId]} size={40} className="friend-av" />
                </div>
              ))
            )}
            {channelPeers.length > 6 && (
              <div className="voice-channel-more">+{channelPeers.length - 6}</div>
            )}
          </div>
        ) : (
          <PlayerAvatar profile={peerProfile} size={56} className="friend-av" />
        )}
        <div className="voice-call-meta">
          <div className="voice-call-name">
            {isChannel ? (
              `Voice channel${channelPeers.length ? ` · ${channelPeers.length + 1}` : ''}`
            ) : (
              <GamerTag profile={peerProfile || { gamer_tag: call.peerId ? 'Friend' : 'Voice' }} />
            )}
          </div>
          <div className="voice-call-status">{statusLabel(call)}</div>
          {inLive && (
            <div className="voice-device-row">
              <label>
                Mic
                <select
                  value={call.inputDeviceId || ''}
                  onChange={(e) => setInputDevice(e.target.value)}
                >
                  <option value="">Default</option>
                  {inputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || 'Microphone'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Speakers
                <select
                  value={call.outputDeviceId || ''}
                  onChange={(e) => setOutputDevice(e.target.value)}
                >
                  <option value="">Default</option>
                  {outputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || 'Speakers'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
        <div className="voice-call-actions">
          {call.state === 'ringing' && !isChannel ? (
            <>
              <button type="button" className="action-btn primary" onClick={acceptCall}>
                Accept
              </button>
              <button type="button" className="action-btn ghost" onClick={declineCall}>
                Decline
              </button>
            </>
          ) : (
            <>
              {inLive && (
                <>
                  <button
                    type="button"
                    className={`action-btn ghost ${call.muted ? 'voice-muted' : ''}`}
                    onClick={toggleMute}
                  >
                    {call.muted ? 'Unmute' : 'Mute'}
                  </button>
                  <button
                    type="button"
                    className={`action-btn ghost ${call.deafened ? 'voice-muted' : ''}`}
                    onClick={toggleDeafen}
                    title="Deafen — you won't hear others"
                  >
                    {call.deafened ? 'Undeafen' : 'Deafen'}
                  </button>
                  <button
                    type="button"
                    className={`action-btn ghost ${call.screenSharing ? 'voice-sharing' : ''}`}
                    onClick={toggleScreenShare}
                  >
                    {call.screenSharing ? 'Stop share' : 'Share screen'}
                  </button>
                </>
              )}
              <button type="button" className="action-btn voice-hangup" onClick={hangup}>
                {isChannel ? 'Leave' : (call.state === 'calling' ? 'Cancel' : 'End')}
              </button>
            </>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
