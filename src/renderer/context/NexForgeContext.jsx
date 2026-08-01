import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { sb } from '../lib/supabase.js';
import {
  isAuthSessionError,
  isCloudUnreachableError,
  probeSupabaseCloud,
  recoverAuthSession,
  clearLocalAuthSession,
} from '../lib/cloud.js';
import { GAME_CATALOG, KNOWN_MAIN_GAMES, mergeGameCatalog } from '../lib/games.js';

const NexForgeContext = createContext(null);

/** Screens that guests cannot access — matches legacy GUEST_LOCKED behavior. */
export const GUEST_LOCKED_SCREENS = ['matchmaking', 'profile', 'analytics', 'squad', 'friends', 'shop', 'clans'];

const GUEST_LOCKED_LABELS = {
  matchmaking: 'Matchmaking is locked in Guest Mode',
  profile: 'Your profile requires an account',
  analytics: 'Analytics requires an account',
  squad: 'Squad Finder requires an account',
  friends: 'Friends & messages require an account',
  shop: 'The cosmetics shop requires an account',
  clans: 'Clans require an account',
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

/** Short synthesized chirp for incoming messages — no audio asset needed. */
function playMessageChirp() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch {
    /* sound is best-effort */
  }
}

export function NexForgeProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [guestMode, setGuestMode] = useState(false);
  const [screen, setScreenState] = useState('dashboard');
  const [toasts, setToasts] = useState([]);
  const [cloudOffline, setCloudOfflineState] = useState(false);
  const [cloudReason, setCloudReason] = useState('');
  const [lockMessage, setLockMessage] = useState(null);
  const [communityGames, setCommunityGames] = useState([]);
  const [appVersion, setAppVersion] = useState(null);
  const [appPlatform, setAppPlatform] = useState(typeof navigator !== 'undefined' ? navigator.platform : '');
  const [liveSession, setLiveSession] = useState(null);
  // Bumped whenever a finished session is saved so screens can refetch history.
  const [sessionSaveTick, setSessionSaveTick] = useState(0);
  const [pendingFriendChatId, setPendingFriendChatId] = useState(null);
  const [pendingMatchLog, setPendingMatchLog] = useState(null);
  const [party, setParty] = useState(null);
  const [clan, setClan] = useState(null);
  const [activeSeason, setActiveSeason] = useState(null);
  const [seasonRating, setSeasonRating] = useState(null);
  const [battlePassXp, setBattlePassXp] = useState(null);
  // sender_id -> count of unread DMs; drives the sidebar badge + Friends screen.
  const [unreadBySender, setUnreadBySender] = useState({});
  const [dndEnabled, setDndEnabledState] = useState(() => {
    try { return localStorage.getItem('nexforge_dnd') === '1'; } catch { return false; }
  });
  const dndRef = useRef(dndEnabled);
  useEffect(() => { dndRef.current = dndEnabled; }, [dndEnabled]);

  const setDndEnabled = useCallback((on) => {
    const next = !!on;
    setDndEnabledState(next);
    try { localStorage.setItem('nexforge_dnd', next ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  const userRef = useRef(null);
  useEffect(() => { userRef.current = user; }, [user]);

  const { catalog: gameCatalog, knownGames } = useMemo(
    () => mergeGameCatalog(communityGames),
    [communityGames],
  );

  const showToast = useCallback((msg, type = 'success') => {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const setCloudOffline = useCallback((offline, reason) => {
    const next = !!offline;
    setCloudOfflineState(next);
    if (!next) setCloudReason('');
    else if (reason) setCloudReason(String(reason));
  }, []);

  /** Mark offline only for real reachability problems — not RLS / validation / JWT glitches. */
  const reportCloudError = useCallback(async (err) => {
    if (!err) return false;
    if (isAuthSessionError(err)) {
      await clearLocalAuthSession();
      setUser(null);
      setProfile(null);
      setGuestMode(false);
      const result = await probeSupabaseCloud();
      if (result.ok) {
        setCloudOffline(false);
        return false;
      }
      setCloudOffline(true, result.error?.message || err?.message || 'Cloud sync unavailable');
      return true;
    }
    if (isCloudUnreachableError(err)) {
      setCloudOffline(true, err?.message || 'Cloud sync unavailable');
      return true;
    }
    return false;
  }, [setCloudOffline]);

  const loadCommunityGames = useCallback(async () => {
    try {
      const { data, error } = await sb
        .from('community_games')
        .select('name,name_key,player_count,status,category,mark,promoted_at')
        .eq('status', 'live')
        .order('player_count', { ascending: false });
      if (error) throw error;
      setCommunityGames(data || []);
      return data || [];
    } catch {
      // Table / RPC may not be applied yet — keep built-in catalog only.
      setCommunityGames([]);
      return [];
    }
  }, []);

  const syncCommunityGames = useCallback(async (gameName) => {
    try {
      if (gameName) {
        const { error } = await sb.rpc('report_custom_main_game', { p_game: gameName });
        if (error) throw error;
      } else {
        const { error } = await sb.rpc('sync_community_games', { p_threshold: 5 });
        if (error) throw error;
      }
    } catch {
      /* optional until community-games.sql is applied */
    }
    return loadCommunityGames();
  }, [loadCommunityGames]);

  const probeCloud = useCallback(async () => {
    const result = await probeSupabaseCloud();
    if (result.ok) {
      setCloudOffline(false);
      if (result.recoveredAuth) {
        setUser(null);
        setProfile(null);
      }
      await loadCommunityGames();
      return true;
    }
    setCloudOffline(true, result.error?.message || 'Cloud sync unavailable');
    return false;
  }, [loadCommunityGames, setCloudOffline]);

  const loadProfileFor = useCallback(async (authUser) => {
    if (!authUser) return null;
    const { data } = await sb.from('profiles').select('*').eq('id', authUser.id).single();
    if (data) {
      setProfile(data);
      return data;
    }
    // Identity-only insert — MMR/wins/losses are DB defaults / RPC-owned (security-hardening.sql).
    const tag = authUser.user_metadata?.gamer_tag
      || authUser.user_metadata?.full_name
      || authUser.user_metadata?.name
      || authUser.email?.split('@')[0]
      || 'Player';
    const plat = authUser.user_metadata?.platform || 'PC';
    const identity = {
      id: authUser.id,
      gamer_tag: String(tag).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'Player',
      platform: plat,
      main_game: 'Valorant',
      main_game_description: null,
      onboarding_done: false,
    };
    const { error } = await sb.from('profiles').upsert(identity, { onConflict: 'id' });
    if (error) {
      // Trigger may have created the row already — try a plain select again.
      const { data: again } = await sb.from('profiles').select('*').eq('id', authUser.id).single();
      if (again) {
        setProfile(again);
        return again;
      }
      await reportCloudError(error);
      return null;
    }
    const { data: created } = await sb.from('profiles').select('*').eq('id', authUser.id).single();
    const fresh = created || {
      ...identity,
      mmr: 1200,
      wins: 0,
      losses: 0,
      created_at: new Date().toISOString(),
    };
    setProfile(fresh);
    return fresh;
  }, [reportCloudError]);

  const refreshProfile = useCallback(async () => {
    if (!user) return null;
    return loadProfileFor(user);
  }, [user, loadProfileFor]);

  const enterGuest = useCallback(() => {
    setGuestMode(true);
    setUser(null);
    setParty(null);
    setClan(null);
    setActiveSeason(null);
    setSeasonRating(null);
    setBattlePassXp(null);
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
    setParty(null);
    setClan(null);
    setActiveSeason(null);
    setSeasonRating(null);
    setBattlePassXp(null);
    setScreenState('dashboard');
    showToast('Signed out', 'success');
  }, [guestMode, showToast]);

  const createAccount = useCallback(async () => {
    setLockMessage(null);
    if (guestMode) {
      setGuestMode(false);
      setProfile(null);
      setScreenState('dashboard');
    }
    if (!window.nexforge?.openAuthBrowser) {
      showToast('Browser sign in is only available in the desktop app.', 'error');
      return;
    }
    try {
      await window.nexforge.openAuthBrowser('signup');
    } catch (err) {
      showToast(err?.message || 'Could not open signup.', 'error');
    }
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

  const openFriendChat = useCallback((friendId) => {
    setPendingFriendChatId(friendId);
    setScreenState('friends');
  }, []);

  const clearPendingFriendChat = useCallback(() => {
    setPendingFriendChatId(null);
  }, []);

  useEffect(() => {
    let mounted = true;
    let offAuth = null;

    (async () => {
      try {
        const info = await window.nexforge?.getAppInfo?.();
        if (info?.version && mounted) setAppVersion(info.version);
        if (info?.platform && mounted) setAppPlatform(info.platform);
      } catch (_) {
        /* unpackaged / missing preload */
      }

      // Clear corrupt JWTs first — a bad session makes every REST call 401 and looks "offline".
      await recoverAuthSession();
      await probeCloud();
      await loadCommunityGames();

      if (window.nexforge?.onAuthCallback) {
        offAuth = window.nexforge.onAuthCallback((tokens) => {
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

    return () => {
      mounted = false;
      offAuth?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-retry while offline so a blip or recovered JWT does not stick forever.
  useEffect(() => {
    if (!cloudOffline) return undefined;
    const id = setInterval(() => { probeCloud(); }, 20000);
    return () => clearInterval(id);
  }, [cloudOffline, probeCloud]);

  // Baseline for the message chirp: null until the first unread fetch completes,
  // so signing in with old unread messages stays silent.
  const unreadSoundBaselineRef = useRef(null);

  const refreshUnread = useCallback(async () => {
    const u = userRef.current;
    if (!u) {
      unreadSoundBaselineRef.current = null;
      setUnreadBySender({});
      return;
    }
    try {
      const { data, error } = await sb
        .from('messages')
        .select('sender_id')
        .eq('recipient_id', u.id)
        .is('read_at', null)
        .limit(500);
      if (error) throw error;
      const counts = {};
      for (const row of data || []) {
        counts[row.sender_id] = (counts[row.sender_id] || 0) + 1;
      }
      const total = (data || []).length;
      if (
        unreadSoundBaselineRef.current !== null
        && total > unreadSoundBaselineRef.current
        && !dndRef.current
      ) {
        playMessageChirp();
      }
      unreadSoundBaselineRef.current = total;
      setUnreadBySender(counts);
    } catch {
      /* table may not be applied yet / transient network — keep last known counts */
    }
  }, []);

  // Sidebar unread badge stays fresh even when the Friends screen is closed.
  useEffect(() => {
    if (!user) {
      setUnreadBySender({});
      return undefined;
    }
    refreshUnread();
    const id = setInterval(refreshUnread, 15000);
    return () => clearInterval(id);
  }, [user, refreshUnread]);

  const unreadTotal = useMemo(
    () => Object.values(unreadBySender).reduce((sum, n) => sum + n, 0),
    [unreadBySender],
  );

  // Presence heartbeat: friends see a green dot (recent last_seen_at) and the
  // game currently being tracked. Column-level grants limit this to own row.
  const playingGame = liveSession?.game ?? null;
  useEffect(() => {
    if (!user) return undefined;
    const beat = async () => {
      try {
        await sb
          .from('profiles')
          .update({ last_seen_at: new Date().toISOString(), playing_game: playingGame })
          .eq('id', user.id);
      } catch {
        /* presence is best-effort */
      }
    };
    beat();
    const id = setInterval(beat, 60000);
    return () => clearInterval(id);
  }, [user, playingGame]);

  // In-game overlay: while a game session is tracked, poll fast for new
  // incoming messages and forward them to the always-on-top overlay window.
  const gameActive = !!liveSession;
  useEffect(() => {
    const nf = window.nexforge;
    if (!gameActive || !user || !nf?.overlayNotify) return undefined;

    let lastSeenId = null;
    let cancelled = false;
    const tagCache = {};

    async function poll() {
      try {
        const { data, error } = await sb
          .from('messages')
          .select('id,sender_id,body,image_path')
          .eq('recipient_id', user.id)
          .is('read_at', null)
          .order('id', { ascending: false })
          .limit(5);
        if (error || cancelled) return;
        const rows = (data || []).slice().reverse();
        const maxId = rows.length ? rows[rows.length - 1].id : null;
        if (lastSeenId === null) {
          // Baseline on session start — don't replay messages that were already waiting.
          lastSeenId = maxId ?? 0;
          return;
        }
        const fresh = rows.filter((m) => m.id > lastSeenId);
        if (!fresh.length) return;
        lastSeenId = maxId;
        const unknown = [...new Set(fresh.map((m) => m.sender_id))].filter((id) => !tagCache[id]);
        if (unknown.length) {
          const { data: profs } = await sb.from('profiles').select('id,gamer_tag').in('id', unknown);
          for (const p of profs || []) tagCache[p.id] = p.gamer_tag;
        }
        if (cancelled) return;
        if (dndRef.current) {
          refreshUnread();
          return;
        }
        // Approximate unread for the toast badge; exact total refreshes after.
        const approxUnread = (Object.values(unreadBySender).reduce((s, n) => s + n, 0) || 0) + fresh.length;
        for (const m of fresh) {
          nf.overlayNotify({
            kind: 'message',
            sender: tagCache[m.sender_id] || 'Friend',
            body: m.body || '',
            image: !!m.image_path,
            unread: approxUnread,
          });
        }
        refreshUnread();
      } catch {
        /* overlay notifications are best-effort */
      }
    }

    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [gameActive, user, refreshUnread]);

  // Ctrl+Shift+O — force an overlay peek with the current unread total.
  useEffect(() => {
    const nf = window.nexforge;
    if (!nf?.onOverlayHotkey) return undefined;
    return nf.onOverlayHotkey(async () => {
      if (dndRef.current) {
        showToast('Do Not Disturb is on — unmute to see overlay toasts.', 'error');
        return;
      }
      let count = Object.values(unreadBySender).reduce((s, n) => s + n, 0);
      const u = userRef.current;
      if (u) {
        try {
          const { count: c } = await sb
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('recipient_id', u.id)
            .is('read_at', null);
          if (typeof c === 'number') count = c;
        } catch { /* use cached total */ }
      }
      nf.overlayNotify({
        force: true,
        sender: 'NexForge',
        body: count > 0 ? `You have ${count} unread message${count === 1 ? '' : 's'}` : 'No unread messages',
        unread: count,
      });
    });
  }, [showToast, unreadBySender]);

  // Game session tracking lives here (always mounted) so finished sessions are
  // saved even when the Analytics screen is closed.
  useEffect(() => {
    const nf = window.nexforge;
    if (!nf?.onGameSessionStarted) return undefined;

    nf.getActiveGameSession?.()
      .then((s) => { if (s) setLiveSession(s); })
      .catch(() => {});

    const offStarted = nf.onGameSessionStarted((session) => {
      setLiveSession(session);
      showToast(`Tracking ${session.game}`, 'success');
    });
    const offSample = nf.onGameSessionSample((payload) => {
      setLiveSession((prev) => (prev ? { ...prev, ...payload } : payload));
    });
    const offEnded = nf.onGameSessionEnded(async (summary) => {
      setLiveSession(null);
      const u = userRef.current;
      if (!u) {
        showToast(`${summary.game} session ended — sign in to save sessions`, 'error');
        return;
      }
      try {
        const { data: saved, error } = await sb.from('game_sessions').insert({
          user_id: u.id,
          game: summary.game,
          process_name: summary.processName || null,
          duration_sec: summary.durationSec,
          avg_ram_mb: summary.avgRamMb,
          max_ram_mb: summary.maxRamMb,
          avg_cpu_pct: summary.avgCpuPct,
          max_cpu_pct: summary.maxCpuPct,
          avg_gpu_pct: summary.avgGpuPct,
          max_gpu_pct: summary.maxGpuPct,
          avg_ping_ms: summary.avgPingMs,
          max_ping_ms: summary.maxPingMs,
          tips: summary.tips || [],
          samples: summary.samples || [],
          started_at: summary.startedAt,
          ended_at: summary.endedAt,
        }).select('id').single();
        if (error) throw error;
        showToast(`${summary.game} session saved`, 'success');
        setPendingMatchLog({
          sessionId: saved?.id ?? null,
          game: summary.game,
          durationSec: summary.durationSec,
          mode: null,
        });
      } catch (err) {
        showToast(`${summary.game} session ended (cloud save failed)`, 'error');
        await reportCloudError(err);
        // Still offer a result prompt even if session save failed (no session link).
        setPendingMatchLog({
          sessionId: null,
          game: summary.game,
          durationSec: summary.durationSec,
          mode: null,
        });
      } finally {
        setSessionSaveTick((t) => t + 1);
      }
    });
    const offCancelled = nf.onGameSessionCancelled((payload) => {
      setLiveSession(null);
      if (payload?.game) showToast(`${payload.game} session discarded (too short)`, 'error');
    });

    return () => {
      offStarted?.();
      offSample?.();
      offEnded?.();
      offCancelled?.();
    };
  }, [showToast, reportCloudError]);

  // Update toasts only for user-initiated checks; background checks stay silent
  // (the main process shows its own dialog once an update is downloaded).
  const manualUpdateCheckRef = useRef(false);

  useEffect(() => {
    const off = window.nexforge?.onUpdateStatus?.((status) => {
      if (!status || !manualUpdateCheckRef.current) return;
      if (status.state === 'available') {
        showToast(`Update v${status.version || ''} found — downloading…`, 'success');
      } else if (status.state === 'not-available') {
        manualUpdateCheckRef.current = false;
        showToast('You are on the latest version.', 'success');
      } else if (status.state === 'downloaded') {
        manualUpdateCheckRef.current = false;
      } else if (status.state === 'error') {
        manualUpdateCheckRef.current = false;
        showToast(status.message || 'Update check failed.', 'error');
      }
    });
    return () => off?.();
  }, [showToast]);

  const checkForUpdates = useCallback(async () => {
    if (!window.nexforge?.checkForUpdates) {
      showToast('Updates only work in the installed desktop app.', 'error');
      return;
    }
    manualUpdateCheckRef.current = true;
    showToast('Checking for updates…', 'success');
    const res = await window.nexforge.checkForUpdates().catch((err) => ({ ok: false, reason: err?.message }));
    if (res && res.ok === false) {
      manualUpdateCheckRef.current = false;
      showToast(
        res.reason === 'dev'
          ? 'Updates only work in the installed desktop app.'
          : res.reason || 'Update check failed.',
        'error',
      );
    }
  }, [showToast]);

  const clearPendingMatchLog = useCallback(() => {
    setPendingMatchLog(null);
  }, []);

  const refreshParty = useCallback(async () => {
    if (!user || guestMode) {
      setParty(null);
      return null;
    }
    try {
      const { data, error } = await sb.rpc('get_my_party');
      if (error) throw error;
      setParty(data || null);
      return data || null;
    } catch (err) {
      // Don't flip the whole app offline for a missing party RPC.
      console.warn('get_my_party failed', err);
      await reportCloudError(err);
      return null;
    }
  }, [user, guestMode, reportCloudError]);

  const runPartyRpc = useCallback(async (fnName, args = {}) => {
    const { data, error } = await sb.rpc(fnName, args);
    if (error) throw error;
    // leave/disband/decline return {ok:true} without a party snapshot.
    if (data && typeof data === 'object' && data.id) {
      setParty(data);
      return data;
    }
    await refreshParty();
    return data;
  }, [refreshParty]);

  const createParty = useCallback(async (game = null) => {
    const data = await runPartyRpc('create_party', { p_game: game });
    showToast('Party created', 'success');
    return data;
  }, [runPartyRpc, showToast]);

  const inviteToParty = useCallback(async (friendId, game = null) => {
    const data = await runPartyRpc('invite_to_party', { p_friend_id: friendId, p_game: game });
    showToast('Party invite sent', 'success');
    return data;
  }, [runPartyRpc, showToast]);

  const respondPartyInvite = useCallback(async (partyId, accept) => {
    const data = await runPartyRpc('respond_party_invite', {
      p_party_id: partyId,
      p_accept: !!accept,
    });
    showToast(accept ? 'Joined party' : 'Invite declined', 'success');
    return data;
  }, [runPartyRpc, showToast]);

  const setPartyReady = useCallback(async (ready) => {
    return runPartyRpc('set_party_ready', { p_ready: !!ready });
  }, [runPartyRpc]);

  const leaveParty = useCallback(async () => {
    await runPartyRpc('leave_party');
    setParty(null);
    showToast('Left party', 'success');
  }, [runPartyRpc, showToast]);

  const kickPartyMember = useCallback(async (userId) => {
    const data = await runPartyRpc('kick_party_member', { p_user_id: userId });
    showToast('Member removed', 'success');
    return data;
  }, [runPartyRpc, showToast]);

  const disbandParty = useCallback(async () => {
    await runPartyRpc('disband_party');
    setParty(null);
    showToast('Party disbanded', 'success');
  }, [runPartyRpc, showToast]);

  // Poll party state while signed in (same pattern as friends / duels).
  useEffect(() => {
    if (!user || guestMode) {
      setParty(null);
      return undefined;
    }
    let active = true;
    const tick = async () => {
      if (!active) return;
      await refreshParty();
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [user, guestMode, refreshParty]);

  const refreshSeason = useCallback(async () => {
    if (!user || guestMode) {
      setActiveSeason(null);
      setSeasonRating(null);
      return null;
    }
    try {
      const { data, error } = await sb.rpc('get_my_season_ratings');
      if (error) throw error;
      const season = data?.season || null;
      const ratings = Array.isArray(data?.ratings) ? data.ratings : [];
      const global = ratings.find((r) => r.game === '_global') || ratings[0] || null;
      setActiveSeason(season);
      setSeasonRating(global);
      return data;
    } catch (err) {
      console.warn('get_my_season_ratings failed', err);
      try {
        const { data } = await sb.rpc('get_active_season');
        setActiveSeason(data || null);
      } catch {
        setActiveSeason(null);
      }
      setSeasonRating(null);
      return null;
    }
  }, [user, guestMode]);

  useEffect(() => {
    if (!user || guestMode) {
      setActiveSeason(null);
      setSeasonRating(null);
      return undefined;
    }
    refreshSeason();
    return undefined;
  }, [user, guestMode, refreshSeason, profile?.mmr, profile?.wins, profile?.losses]);

  const refreshClan = useCallback(async () => {
    if (!user || guestMode) {
      setClan(null);
      return null;
    }
    try {
      const { data, error } = await sb.rpc('get_my_clan');
      if (error) throw error;
      setClan(data || null);
      return data || null;
    } catch (err) {
      console.warn('get_my_clan failed', err);
      await reportCloudError(err);
      return null;
    }
  }, [user, guestMode, reportCloudError]);

  const runClanRpc = useCallback(async (fnName, args = {}) => {
    const { data, error } = await sb.rpc(fnName, args);
    if (error) throw error;
    if (data && typeof data === 'object' && data.id) {
      setClan(data);
      return data;
    }
    await refreshClan();
    return data;
  }, [refreshClan]);

  const createClan = useCallback(async (name, tag, minMmr = 0, isOpen = true) => {
    const data = await runClanRpc('create_clan', {
      p_name: name,
      p_tag: tag,
      p_min_mmr: Number(minMmr) || 0,
      p_is_open: !!isOpen,
    });
    showToast('Clan created', 'success');
    await refreshProfile();
    return data;
  }, [runClanRpc, showToast, refreshProfile]);

  const inviteToClan = useCallback(async (friendId) => {
    const data = await runClanRpc('invite_to_clan', { p_friend_id: friendId });
    showToast('Clan invite sent', 'success');
    return data;
  }, [runClanRpc, showToast]);

  const respondClanInvite = useCallback(async (clanId, accept) => {
    const data = await runClanRpc('respond_clan_invite', {
      p_clan_id: clanId,
      p_accept: !!accept,
    });
    showToast(accept ? 'Joined clan' : 'Invite declined', 'success');
    await refreshProfile();
    return data;
  }, [runClanRpc, showToast, refreshProfile]);

  const leaveClan = useCallback(async () => {
    await runClanRpc('leave_clan');
    setClan(null);
    showToast('Left clan', 'success');
    await refreshProfile();
  }, [runClanRpc, showToast, refreshProfile]);

  const disbandClan = useCallback(async () => {
    await runClanRpc('disband_clan');
    setClan(null);
    showToast('Clan disbanded', 'success');
    await refreshProfile();
  }, [runClanRpc, showToast, refreshProfile]);

  const joinClan = useCallback(async (clanId) => {
    const data = await runClanRpc('join_clan', { p_clan_id: clanId });
    showToast('Joined clan', 'success');
    await refreshProfile();
    return data;
  }, [runClanRpc, showToast, refreshProfile]);

  const updateClanSettings = useCallback(async ({ minMmr, isOpen, description } = {}) => {
    const data = await runClanRpc('update_clan_settings', {
      p_min_mmr: minMmr == null ? null : Number(minMmr),
      p_is_open: isOpen == null ? null : !!isOpen,
      p_description: description == null ? null : description,
    });
    showToast('Clan settings saved', 'success');
    return data;
  }, [runClanRpc, showToast]);

  const claimClanReward = useCallback(async () => {
    const { data, error } = await sb.rpc('claim_clan_reward');
    if (error) throw error;
    if (data?.clan) setClan(data.clan);
    else await refreshClan();
    await refreshProfile();
    showToast(`+${data?.coins || 0} clan coins`, 'success');
    return data;
  }, [refreshClan, refreshProfile, showToast]);

  useEffect(() => {
    if (!user || guestMode) {
      setClan(null);
      return undefined;
    }
    let active = true;
    const tick = async () => {
      if (!active) return;
      await refreshClan();
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [user, guestMode, refreshClan]);

  const refreshBattlePassXp = useCallback(async () => {
    if (!user || guestMode) {
      setBattlePassXp(null);
      return null;
    }
    try {
      const { data, error } = await sb.rpc('get_my_battle_pass');
      if (error) throw error;
      setBattlePassXp(data?.season ? (data.xp ?? 0) : null);
      return data;
    } catch (err) {
      console.warn('get_my_battle_pass failed', err);
      setBattlePassXp(null);
      return null;
    }
  }, [user, guestMode]);

  useEffect(() => {
    if (!user || guestMode) {
      setBattlePassXp(null);
      return undefined;
    }
    refreshBattlePassXp();
    return undefined;
  }, [user, guestMode, refreshBattlePassXp, profile?.wins, profile?.losses, activeSeason?.id]);

  // Overlay 2.0 — party invites + lobby codes (click-through; respects DND).
  const overlaySeenRef = useRef({ partyInviteKey: null, lobbyCodeKey: null });
  useEffect(() => {
    if (!user || guestMode) return undefined;
    const nf = window.nexforge;
    if (!nf?.overlayNotify) return undefined;

    if (party?.my_status === 'invited' && party.id) {
      const key = `invite:${party.id}`;
      if (overlaySeenRef.current.partyInviteKey !== key) {
        overlaySeenRef.current.partyInviteKey = key;
        if (!dndRef.current) {
          const host = (party.members || []).find((m) => m.role === 'host');
          nf.overlayNotify({
            kind: 'party',
            sender: host?.gamer_tag || 'Party',
            body: party.game
              ? `Party invite · ${party.game}`
              : 'Party invite — open Friends to accept',
            unread: 0,
          });
        }
      }
    } else if (party?.my_status === 'joined') {
      overlaySeenRef.current.partyInviteKey = null;
    }

    let cancelled = false;
    async function pollLobbyOverlay() {
      try {
        const { data, error } = await sb.rpc('get_my_lobby');
        if (error || cancelled || !data?.lobby_code) return;
        const key = `${data.id}:${data.lobby_code}`;
        if (overlaySeenRef.current.lobbyCodeKey === key) return;
        overlaySeenRef.current.lobbyCodeKey = key;
        if (dndRef.current) return;
        nf.overlayNotify({
          kind: 'lobby',
          sender: data.game || 'Lobby',
          body: `Lobby code: ${data.lobby_code}`,
          unread: 0,
        });
      } catch {
        /* overlay best-effort */
      }
    }
    pollLobbyOverlay();
    const id = setInterval(pollLobbyOverlay, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user, guestMode, party]);

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
    cloudReason,
    setCloudOffline,
    reportCloudError,
    refreshProfile,
    signOut,
    createAccount,
    enterGuest,
    handleAuthTokens,
    lockMessage,
    setLockMessage,
    probeCloud,
    appVersion,
    appPlatform,
    liveSession,
    sessionSaveTick,
    checkForUpdates,
    unreadBySender,
    unreadTotal,
    refreshUnread,
    dndEnabled,
    setDndEnabled,
    communityGames,
    gameCatalog: gameCatalog.length ? gameCatalog : GAME_CATALOG,
    knownGames: knownGames.length ? knownGames : KNOWN_MAIN_GAMES,
    loadCommunityGames,
    syncCommunityGames,
    pendingFriendChatId,
    openFriendChat,
    clearPendingFriendChat,
    pendingMatchLog,
    clearPendingMatchLog,
    party,
    refreshParty,
    createParty,
    inviteToParty,
    respondPartyInvite,
    setPartyReady,
    leaveParty,
    kickPartyMember,
    disbandParty,
    clan,
    refreshClan,
    createClan,
    inviteToClan,
    respondClanInvite,
    leaveClan,
    disbandClan,
    joinClan,
    updateClanSettings,
    claimClanReward,
    activeSeason,
    seasonRating,
    refreshSeason,
    battlePassXp,
    refreshBattlePassXp,
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
