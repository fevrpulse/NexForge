import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { sb } from '../lib/supabase.js';

const NexForgeContext = createContext(null);

/** Screens that guests cannot access — matches legacy GUEST_LOCKED behavior. */
export const GUEST_LOCKED_SCREENS = ['matchmaking', 'profile', 'analytics', 'squad'];

const GUEST_LOCKED_LABELS = {
  matchmaking: 'Matchmaking is locked in Guest Mode',
  profile: 'Your profile requires an account',
  analytics: 'Analytics requires an account',
  squad: 'Squad Finder requires an account',
};

const GUEST_PROFILE = {
  gamer_tag: 'Guest',
  platform: '—',
  mmr: 1200,
  wins: 0,
  losses: 0,
  main_game: 'Valorant',
  created_at: new Date().toISOString(),
};

let toastSeq = 0;

export function NexForgeProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [guestMode, setGuestMode] = useState(false);
  const [screen, setScreenState] = useState('dashboard');
  const [toasts, setToasts] = useState([]);
  const [cloudOffline, setCloudOffline] = useState(false);
  const [lockMessage, setLockMessage] = useState(null);

  const showToast = useCallback((msg, type = 'success') => {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const probeCloud = useCallback(async () => {
    try {
      const { error } = await sb.from('profiles').select('id').limit(1);
      if (error) throw error;
      setCloudOffline(false);
      return true;
    } catch (err) {
      setCloudOffline(true, err?.message || err);
      return false;
    }
  }, []);

  const loadProfileFor = useCallback(async (authUser) => {
    if (!authUser) return null;
    const { data } = await sb.from('profiles').select('*').eq('id', authUser.id).single();
    if (data) {
      setProfile(data);
      return data;
    }
    const tag = authUser.user_metadata?.gamer_tag || authUser.email?.split('@')[0] || 'Player';
    const plat = authUser.user_metadata?.platform || 'PC';
    const fresh = {
      id: authUser.id,
      gamer_tag: tag,
      platform: plat,
      mmr: 1200,
      wins: 0,
      losses: 0,
      main_game: 'Valorant',
      main_game_description: null,
      onboarding_done: false,
      created_at: new Date().toISOString(),
    };
    await sb.from('profiles').upsert(fresh);
    setProfile(fresh);
    return fresh;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return null;
    return loadProfileFor(user);
  }, [user, loadProfileFor]);

  const enterGuest = useCallback(() => {
    setGuestMode(true);
    setUser(null);
    setProfile(GUEST_PROFILE);
    setScreenState('dashboard');
  }, []);

  const signOut = useCallback(async () => {
    if (guestMode) {
      setGuestMode(false);
      setProfile(null);
      setScreenState('dashboard');
      return;
    }
    await sb.auth.signOut();
    setUser(null);
    setProfile(null);
    setScreenState('dashboard');
    showToast('Signed out', 'success');
  }, [guestMode, showToast]);

  const handleAuthTokens = useCallback(async (tokens) => {
    if (!tokens?.access_token || !tokens?.refresh_token) {
      showToast('Sign in did not return a valid session. Try again.', 'error');
      return;
    }

    const { error } = await sb.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    if (error) {
      showToast(error.message, 'error');
      return;
    }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      showToast('Could not restore your session.', 'error');
      return;
    }

    setGuestMode(false);
    setUser(session.user);
    await loadProfileFor(session.user);
    setScreenState('dashboard');
    showToast('Signed in successfully', 'success');
  }, [loadProfileFor, showToast]);

  const setScreen = useCallback((id) => {
    if (guestMode && GUEST_LOCKED_SCREENS.includes(id)) {
      setLockMessage(GUEST_LOCKED_LABELS[id] || 'This feature requires an account');
      return;
    }
    setScreenState(id);
  }, [guestMode]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      probeCloud();

      if (window.nexforge?.onAuthCallback) {
        window.nexforge.onAuthCallback((tokens) => {
          handleAuthTokens(tokens);
        });
        try {
          const pending = await window.nexforge.getPendingAuth?.();
          if (pending) {
            await handleAuthTokens(pending);
            if (mounted) setLoading(false);
            return;
          }
        } catch (_) {
          /* no pending auth */
        }
      }

      const { data: { session } } = await sb.auth.getSession();
      if (!mounted) return;
      if (session) {
        setUser(session.user);
        await loadProfileFor(session.user);
      }
      setLoading(false);
    })();

    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = {
    loading,
    user,
    profile,
    guestMode,
    screen,
    setScreen,
    toasts,
    showToast,
    cloudOffline,
    setCloudOffline,
    refreshProfile,
    signOut,
    enterGuest,
    handleAuthTokens,
    lockMessage,
    setLockMessage,
    probeCloud,
  };

  return (
    <NexForgeContext.Provider value={value}>
      {children}
    </NexForgeContext.Provider>
  );
}

export function useNexForge() {
  const ctx = useContext(NexForgeContext);
  if (!ctx) throw new Error('useNexForge must be used within a NexForgeProvider');
  return ctx;
}
