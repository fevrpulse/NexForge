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
  } = useNexForge();
  const [call, setCall] = useState({
    state: 'idle',
    peerId: null,
    muted: false,
  });
  const [peerProfile, setPeerProfile] = useState(null);
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
      setCall({ state: 'idle', peerId: null, muted: false });
      setPeerProfile(null);
      stopRingtone();
      return undefined;
    }

    const ctrl = createVoiceCallController({
      userId: user.id,
      onState: (next) => {
        setCall({
          state: next.state,
          peerId: next.peerId,
          muted: next.muted,
        });
        if (next.state === 'idle') {
          setPeerProfile(null);
          stopRingtone();
        }
        if (next.state === 'ringing') {
          playRingtone();
          try {
            window.nexforge?.overlayNotify?.({
              kind: 'call',
              sender: 'Incoming call',
              body: 'Open NexForge to Accept or Decline',
            });
          } catch { /* ignore */ }
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
    if (!peerId) {
      setPeerProfile(null);
      return undefined;
    }
    let active = true;
    sb.from('profiles')
      .select('id,gamer_tag,avatar_path,equipped_frame,clan_tag,mmr')
      .eq('id', peerId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setPeerProfile(data || { id: peerId, gamer_tag: 'Friend' });
      });
    return () => { active = false; };
  }, [call.peerId]);

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
    await ctrlRef.current?.hangup();
  }, [stopRingtone]);

  const toggleMute = useCallback(() => {
    const next = !call.muted;
    ctrlRef.current?.setMuted(next);
  }, [call.muted]);

  const value = useMemo(() => ({
    call,
    peerProfile,
    startCall,
    acceptCall,
    declineCall,
    hangup,
    toggleMute,
    inCall: call.state !== 'idle',
  }), [call, peerProfile, startCall, acceptCall, declineCall, hangup, toggleMute]);

  return (
    <VoiceCallContext.Provider value={value}>
      {children}
      <VoiceCallOverlay />
    </VoiceCallContext.Provider>
  );
}

function statusLabel(state) {
  if (state === 'calling') return 'Calling…';
  if (state === 'ringing') return 'Incoming call';
  if (state === 'connecting') return 'Connecting…';
  if (state === 'connected') return 'Connected';
  return '';
}

function VoiceCallOverlay() {
  const ctx = useVoiceCall();
  if (!ctx || ctx.call.state === 'idle') return null;
  const {
    call, peerProfile, acceptCall, declineCall, hangup, toggleMute,
  } = ctx;

  return (
    <div className={`voice-call-overlay ${call.state === 'ringing' ? 'incoming' : ''}`}>
      <div className="voice-call-card">
        <PlayerAvatar profile={peerProfile} size={64} className="friend-av" />
        <div className="voice-call-meta">
          <div className="voice-call-name">
            <GamerTag profile={peerProfile || { gamer_tag: 'Friend' }} />
          </div>
          <div className="voice-call-status">{statusLabel(call.state)}</div>
        </div>
        <div className="voice-call-actions">
          {call.state === 'ringing' ? (
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
              {(call.state === 'connected' || call.state === 'connecting') && (
                <button
                  type="button"
                  className={`action-btn ghost ${call.muted ? 'voice-muted' : ''}`}
                  onClick={toggleMute}
                >
                  {call.muted ? 'Unmute' : 'Mute'}
                </button>
              )}
              <button type="button" className="action-btn voice-hangup" onClick={hangup}>
                {call.state === 'calling' ? 'Cancel' : 'End'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
