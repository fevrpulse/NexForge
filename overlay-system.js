const { BrowserWindow, ipcMain, screen, globalShortcut, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { createPerfMonitor } = require('./perf-monitor');

const PANEL_IDS = [
  'session', 'hardware', 'network', 'clock', 'you', 'clip', 'quick',
  'nexai', 'feed', 'squad', 'friends', 'recap', 'focus', 'notes', 'keys',
];

const DEFAULT_PANELS = {
  session: true,
  hardware: true,
  network: true,
  clock: true,
  you: true,
  clip: true,
  quick: true,
  nexai: true,
  feed: true,
  squad: true,
  friends: true,
  recap: true,
  focus: true,
  notes: false,
  keys: false,
};

const STAT_KEYS = ['gpuUsage', 'gpuTemp', 'cpuUsage', 'cpuTemp', 'fps', 'ram'];

const DEFAULT_STATS = {
  gpuUsage: true,
  gpuTemp: true,
  cpuUsage: true,
  cpuTemp: true,
  fps: true,
  ram: true,
};

const DEFAULT_PREFS = {
  overlayEnabled: true,
  clipEnabled: true,
  clipSeconds: 20,
  statusStrip: true,
  crosshair: false,
  crosshairStyle: 'cross',
  stripPosition: 'bottom',
  hudOpacity: 92,
  hudLook: 'solid',
  statsHud: true,
  statsPos: 'top-left',
  stats: { ...DEFAULT_STATS },
  panels: { ...DEFAULT_PANELS },
  hotkeys: {
    overlay: 'CommandOrControl+Shift+O',
    nexai: 'CommandOrControl+Shift+A',
    clip: 'CommandOrControl+F8',
  },
};

function clampOpacity(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_PREFS.hudOpacity;
  return Math.max(40, Math.min(100, Math.round(v)));
}

function resolvePanels(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const id of PANEL_IDS) {
    out[id] = src[id] !== undefined ? !!src[id] : DEFAULT_PANELS[id] !== false;
  }
  return out;
}

function resolveHudLook(raw) {
  const look = String(raw?.hudLook || DEFAULT_PREFS.hudLook);
  return look === 'glass' || look === 'clear' ? look : 'solid';
}

function resolveStats(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const id of STAT_KEYS) {
    out[id] = src[id] !== undefined ? !!src[id] : DEFAULT_STATS[id] !== false;
  }
  return out;
}

function resolveStatsPos(raw) {
  const pos = String(raw || DEFAULT_PREFS.statsPos);
  return ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(pos)
    ? pos
    : 'top-left';
}

function statsHudActive(prefs) {
  if (!prefs || prefs.statsHud === false) return false;
  const stats = prefs.stats || DEFAULT_STATS;
  return STAT_KEYS.some((id) => stats[id] !== false);
}

function resolveHudExtras(raw = {}) {
  const style = String(raw.crosshairStyle || DEFAULT_PREFS.crosshairStyle);
  const extras = {
    statusStrip: raw.statusStrip !== false,
    crosshair: !!raw.crosshair,
    crosshairStyle: ['cross', 'dot', 'circle', 'plus'].includes(style) ? style : 'cross',
    stripPosition: raw.stripPosition === 'top' ? 'top' : 'bottom',
    hudOpacity: clampOpacity(raw.hudOpacity),
    hudLook: resolveHudLook(raw),
    statsHud: raw.statsHud !== false,
    statsPos: resolveStatsPos(raw.statsPos),
    stats: resolveStats(raw.stats),
  };
  if (raw.panels && typeof raw.panels === 'object') {
    extras.panels = resolvePanels(raw.panels);
  }
  return extras;
}

function resolveHotkeys(hotkeys) {
  const next = {
    overlay: String(hotkeys?.overlay || DEFAULT_PREFS.hotkeys.overlay),
    nexai: String(hotkeys?.nexai || DEFAULT_PREFS.hotkeys.nexai),
    clip: String(hotkeys?.clip || DEFAULT_PREFS.hotkeys.clip),
  };
  if (next.nexai === next.overlay) next.nexai = DEFAULT_PREFS.hotkeys.nexai;
  if (next.nexai === next.overlay) next.nexai = 'CommandOrControl+Shift+N';
  if (next.clip === next.overlay || next.clip === next.nexai) {
    next.clip = DEFAULT_PREFS.hotkeys.clip;
  }
  if (next.clip === next.overlay || next.clip === next.nexai) {
    next.clip = 'CommandOrControl+F9';
  }
  return next;
}

function prefsPath() {
  return path.join(app.getPath('userData'), 'overlay-prefs.json');
}

function loadPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
    return {
      overlayEnabled: raw.overlayEnabled !== false,
      clipEnabled: raw.clipEnabled !== false,
      clipSeconds: Math.max(8, Math.min(45, Number(raw.clipSeconds) || 20)),
      hotkeys: resolveHotkeys(raw.hotkeys),
      ...resolveHudExtras(raw),
    };
  } catch {
    return { ...DEFAULT_PREFS, hotkeys: { ...DEFAULT_PREFS.hotkeys } };
  }
}

function savePrefs(prefs) {
  try {
    fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2));
  } catch {
    /* best-effort */
  }
}

function clipsDir() {
  return path.join(app.getPath('videos'), 'NexForge Clips');
}

function ensureClipsDir() {
  const dir = clipsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(value) {
  return String(value || 'clip').replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '_').slice(0, 40) || 'clip';
}

function createOverlaySystem({ getMainWindow, sendToRenderer, getActiveGame }) {
  let overlayWindow = null;
  let overlayReady = false;
  let pendingReady = null;
  let clipWindow = null;
  let hudOpen = false;
  let hudMode = null;
  let toastLive = false;
  let prefs = loadPrefs();
  let lastClipPath = null;
  let lastGame = '';
  let lastPerf = {};
  let perfMonitor = null;

  // The overlay window is created lazily on the first hotkey press, long after
  // the renderer has pushed sign-in state, prefs and clip status. Without the
  // newest payload per channel kept here, those sends land on no window at all
  // and the first HUD of each launch shows "No game tracked" and refuses NexAI.
  const overlayReplay = new Map();

  function sendOverlay(channel, payload) {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.webContents.send(channel, payload);
  }

  /** Latest-wins channel state: cached for replay and queued until ready. */
  function sendOverlayLatest(channel, payload) {
    overlayReplay.set(channel, payload);
    whenOverlayReady(`channel:${channel}`, () => sendOverlay(channel, overlayReplay.get(channel)));
  }

  function idleClipStatus() {
    return {
      enabled: prefs.clipEnabled,
      // Enabled but not yet recording is still "nothing to save".
      buffering: prefs.clipEnabled,
      readySeconds: 0,
      seconds: prefs.clipSeconds,
    };
  }

  let clipStatus = idleClipStatus();
  let clipRestartTimer = null;
  let lastClipStartAt = 0;
  let clipFailStreak = 0;

  function setClipStatus(next) {
    clipStatus = next;
    sendOverlayLatest('overlay-clip-status', clipStatus);
    sendToRenderer('overlay-clip-status', clipStatus);
  }

  function overlayBounds() {
    return screen.getPrimaryDisplay().bounds;
  }

  function positionOverlay(win) {
    win.setBounds(overlayBounds());
  }

  let pointerHover = false;
  let pointerTyping = false;
  let pointerDown = false;
  let hitRects = [];

  function watchMainFocus() {
    const main = getMainWindow?.();
    if (!main || main.isDestroyed() || main.__nfPointerWatch) return;
    main.__nfPointerWatch = true;
    const refresh = () => applyPointer();
    main.on('focus', refresh);
    main.on('blur', refresh);
  }

  // The game keeps clicks and keys unless the cursor is on a panel, a drag is
  // in progress, or a text field is focused. No mouse forwarding — on Windows,
  // forwarding keeps the window in the hit-test path, so the game underneath
  // stops receiving clicks.
  function releasePointer() {
    const win = overlayWindow;
    if (!win || win.isDestroyed()) return;
    try {
      if (win.isFocused()) win.blur();
    } catch { /* ignore */ }
    try {
      if (win.isFocusable()) win.setFocusable(false);
    } catch { /* ignore */ }
    // setFocusable rebuilds the window style and can drop click-through,
    // so ignore-mouse has to be the last call.
    try {
      win.setIgnoreMouseEvents(true);
    } catch { /* ignore */ }
  }

  function wantsPointer() {
    return hudOpen && (pointerHover || pointerTyping || pointerDown);
  }

  function gameplayClickThrough() {
    return !wantsPointer();
  }

  function applyPointer() {
    watchMainFocus();
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    if (!wantsPointer()) {
      releasePointer();
      return;
    }
    // Buttons and drags stay unfocused so the game keeps the keyboard.
    // A text field is the only reason to pull focus into the overlay.
    try {
      if (pointerTyping) {
        if (!overlayWindow.isFocusable()) overlayWindow.setFocusable(true);
      } else if (overlayWindow.isFocusable()) {
        overlayWindow.setFocusable(false);
      }
    } catch { /* closing */ }
    try {
      overlayWindow.setIgnoreMouseEvents(false);
    } catch { /* closing */ }
    if (pointerTyping && !overlayWindow.isFocused()) {
      try { overlayWindow.focus(); } catch { /* closing */ }
    }
  }

  function cursorOverHud() {
    if (!hitRects.length || !overlayWindow || overlayWindow.isDestroyed()) return false;
    const point = screen.getCursorScreenPoint();
    const bounds = overlayWindow.getBounds();
    const x = point.x - bounds.x;
    const y = point.y - bounds.y;
    if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) return false;
    for (const rect of hitRects) {
      if (x >= rect.x - 4 && y >= rect.y - 4 && x <= rect.x + rect.w + 4 && y <= rect.y + rect.h + 4) return true;
    }
    return false;
  }

  function syncPointerFromCursor() {
    if (!hudOpen) return;
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return;
    if (pointerDown) {
      const point = screen.getCursorScreenPoint();
      const bounds = overlayWindow.getBounds();
      const inside = point.x >= bounds.x && point.y >= bounds.y
        && point.x <= bounds.x + bounds.width && point.y <= bounds.y + bounds.height;
      if (inside) return;
      pointerDown = false;
    }
    const hit = cursorOverHud();
    const typing = hit && pointerTyping;
    if (hit === pointerHover && typing === pointerTyping) return;
    pointerHover = hit;
    pointerTyping = typing;
    applyPointer();
  }

  function getOverlayWindow() {
    if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;

    const area = overlayBounds();
    overlayWindow = new BrowserWindow({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      show: false,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      fullscreenable: false,
      thickFrame: false,
      roundedCorners: false,
      backgroundColor: '#00000000',
      title: 'NexForge Overlay',
      webPreferences: {
        preload: path.join(__dirname, 'overlay-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: true,
      },
    });
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    try { overlayWindow.setContentProtection(true); } catch { /* older Windows */ }
    releasePointer();
    overlayWindow.on('show', () => applyPointer());
    overlayWindow.on('focus', () => {
      if (gameplayClickThrough()) releasePointer();
    });
    overlayWindow.setMenu(null);
    overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
    overlayWindow.webContents.on('did-finish-load', () => {
      overlayReady = true;
      const queued = pendingReady;
      pendingReady = null;
      // Replay cached channel state first, so a window recreated after the last
      // send still paints the current session, prefs and clip status.
      for (const [channel, payload] of overlayReplay) {
        if (!queued || !queued.has(`channel:${channel}`)) sendOverlay(channel, payload);
      }
      if (queued) for (const fn of queued.values()) fn();
      applyPointer();
    });
    overlayWindow.on('closed', () => {
      overlayWindow = null;
      overlayReady = false;
      pendingReady = null;
      hudOpen = false;
      hudMode = null;
      toastLive = false;
    });
    overlayWindow.on('blur', () => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      if (hudOpen) overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      if (gameplayClickThrough()) releasePointer();
    });
    return overlayWindow;
  }

  // Keyed so each concern keeps only its newest callback: queuing one
  // 'did-finish-load' listener per call let rapid hotkey toggles replay stale
  // state on first paint, but they still must not cancel each other out.
  function whenOverlayReady(key, fn) {
    if (overlayReady && overlayWindow && !overlayWindow.isDestroyed()) {
      fn();
      return;
    }
    pendingReady = pendingReady || new Map();
    pendingReady.set(key, fn);
  }

  function showOverlay() {
    const win = getOverlayWindow();
    whenOverlayReady('show', () => {
      if (!win || win.isDestroyed()) return;
      positionOverlay(win);
      if (!win.isVisible()) win.showInactive();
      applyPointer();
    });
    return win;
  }

  function idleStrip() {
    return prefs.statusStrip !== false && !!lastGame;
  }

  function wantsIdleOverlay() {
    if (prefs.overlayEnabled === false) return false;
    if (!lastGame) return false;
    return idleStrip() || !!prefs.crosshair || statsHudActive(prefs);
  }

  function hideIfIdle() {
    if (hudOpen || toastLive) return;
    if (wantsIdleOverlay()) {
      const win = showOverlay();
      whenOverlayReady('strip', () => {
        if (!win || win.isDestroyed()) return;
        applyPointer();
        if (!win.isVisible()) win.showInactive();
        sendOverlayLatest('overlay-hud', {
          open: false,
          strip: idleStrip(),
          prefs,
          lastClipPath,
          clipStatus,
        });
      });
      return;
    }
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      overlayWindow.hide();
    }
  }

  function pushPerf(sample) {
    lastPerf = sample && typeof sample === 'object' ? sample : {};
    sendToRenderer('perf-sample', lastPerf);
    const prev = overlayReplay.get('overlay-state') || {};
    sendOverlayLatest('overlay-state', {
      ...prev,
      sysCpuPct: lastPerf.cpuPct ?? null,
      sysGpuPct: lastPerf.gpuPct ?? null,
      sysCpuTempC: lastPerf.cpuTempC ?? null,
      sysGpuTempC: lastPerf.gpuTempC ?? null,
      sysRamPct: lastPerf.ramPct ?? null,
      sysRamUsedGb: lastPerf.ramUsedGb ?? null,
      sysRamTotalGb: lastPerf.ramTotalGb ?? null,
      sysFps: lastPerf.fps ?? null,
    });
    if (!hudOpen && !toastLive && lastGame && statsHudActive(prefs) && prefs.overlayEnabled !== false) {
      if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) {
        hideIfIdle();
      }
    }
  }

  function showOverlayMessage(payload) {
    if (!prefs.overlayEnabled && payload?.kind !== 'clip') return { ok: false, reason: 'disabled' };
    const win = showOverlay();
    whenOverlayReady('message', () => {
      if (!win || win.isDestroyed()) return;
      toastLive = true;
      win.webContents.send('overlay-message', payload);
    });
    return { ok: true };
  }

  function isMainFocused() {
    const main = getMainWindow?.();
    return !!(main && !main.isDestroyed() && main.isVisible() && main.isFocused());
  }

  function setHudOpen(open, mode = 'full') {
    hudOpen = !!open;
    hudMode = hudOpen ? (mode === 'nexai' ? 'nexai' : 'full') : null;
    const win = showOverlay();
    whenOverlayReady('hud', () => {
      if (!win || win.isDestroyed()) return;
      sendOverlayLatest('overlay-hud', {
        open: hudOpen,
        mode: hudMode,
        strip: !hudOpen && idleStrip(),
        prefs,
        lastClipPath,
        clipStatus,
      });
      if (hudOpen) {
        pointerHover = false;
        pointerTyping = false;
        applyPointer();
        if (!win.isVisible()) win.showInactive();
      } else {
        pointerHover = false;
        pointerTyping = false;
        applyPointer();
        hideIfIdle();
      }
    });
    sendToRenderer('overlay-hotkey', { open: hudOpen, mode: hudMode });
  }

  function toggleHud() {
    if (!prefs.overlayEnabled) {
      sendToRenderer('overlay-hotkey-blocked', { reason: 'disabled' });
      return;
    }
    if (hudOpen) {
      setHudOpen(false);
      return;
    }
    setHudOpen(true, isMainFocused() ? 'full' : 'nexai');
  }

  function toggleNexAi() {
    if (hudOpen) {
      const wasNexAi = hudMode === 'nexai';
      setHudOpen(false);
      // Closing the full HUD shouldn't swallow the press; in-app this key
      // still owns the dock.
      if (!wasNexAi && isMainFocused()) sendToRenderer('nexai-hotkey');
      return;
    }
    if (isMainFocused()) {
      sendToRenderer('nexai-hotkey');
      return;
    }
    if (!prefs.overlayEnabled) {
      sendToRenderer('overlay-hotkey-blocked', { reason: 'disabled' });
      return;
    }
    setHudOpen(true, 'nexai');
  }

  function getClipWindow() {
    if (clipWindow && !clipWindow.isDestroyed()) return clipWindow;
    clipWindow = new BrowserWindow({
      width: 8,
      height: 8,
      show: false,
      frame: false,
      skipTaskbar: true,
      transparent: true,
      focusable: false,
      webPreferences: {
        preload: path.join(__dirname, 'clip-recorder-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    clipWindow.setMenu(null);
    clipWindow.loadFile(path.join(__dirname, 'clip-recorder.html'));
    clipWindow.on('closed', () => { clipWindow = null; });
    return clipWindow;
  }

  function sendClip(channel, payload) {
    const win = getClipWindow();
    const deliver = () => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send(channel, payload);
    };
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', deliver);
    } else {
      deliver();
    }
  }

  /** Send only to an existing recorder — never spin one up just to tell it something. */
  function sendClipIfLive(channel, payload) {
    if (!clipWindow || clipWindow.isDestroyed()) return;
    sendClip(channel, payload);
  }

  let clipLive = false;

  function setClipLive(on) {
    const next = !!on;
    if (next === clipLive) return;
    clipLive = next;
    syncClipBuffer();
  }

  function syncClipBuffer() {
    lastClipStartAt = Date.now();
    if (clipRestartTimer) {
      clearTimeout(clipRestartTimer);
      clipRestartTimer = null;
    }
    // Screen capture encodes the whole display. Only run it while a game is tracked.
    if (prefs.clipEnabled && clipLive) {
      sendClip('clip-recorder-start', { seconds: prefs.clipSeconds });
      setClipStatus({
        enabled: true,
        buffering: true,
        readySeconds: 0,
        seconds: prefs.clipSeconds,
      });
    } else {
      sendClipIfLive('clip-recorder-stop');
      setClipStatus(idleClipStatus());
    }
  }

  function scheduleClipRestart(reason) {
    if (!prefs.clipEnabled || clipRestartTimer) return;
    const msg = String(reason || '');
    const blocked = /blocked|denied|NotAllowed|Permission/i.test(msg);
    clipFailStreak += 1;
    if (blocked && clipFailStreak >= 4) {
      showOverlayMessage({
        kind: 'clip',
        sender: 'Clip',
        body: 'Screen capture is blocked. Allow it, then toggle Clip buffer in Settings.',
        force: true,
      });
      sendToRenderer('overlay-clip-error', 'Screen capture blocked — toggle Clip buffer in Settings after allowing capture');
      return;
    }
    const wait = Math.min(45000, (blocked ? 7000 : 2500) * clipFailStreak);
    clipRestartTimer = setTimeout(() => {
      clipRestartTimer = null;
      if (prefs.clipEnabled) syncClipBuffer();
    }, wait);
  }

  function saveClip(label) {
    if (!prefs.clipEnabled) {
      showOverlayMessage({
        kind: 'clip',
        sender: 'Clip',
        body: 'Turn on clip buffer in Settings',
        force: true,
      });
      return;
    }
    sendClip('clip-recorder-save', { label: label || 'clip', game: lastGame });
  }

  function registerHotkeys() {
    globalShortcut.unregisterAll();
    const binds = [
      ['Overlay', prefs.hotkeys.overlay || DEFAULT_PREFS.hotkeys.overlay, () => toggleHud()],
      ['NexAI', prefs.hotkeys.nexai || DEFAULT_PREFS.hotkeys.nexai, () => toggleNexAi()],
      ['Clip', prefs.hotkeys.clip || DEFAULT_PREFS.hotkeys.clip, () => saveClip('highlight')],
    ];
    for (const [label, acc, handler] of binds) {
      let ok = false;
      try {
        ok = globalShortcut.register(acc, handler);
      } catch (err) {
        console.warn(`${label} hotkey threw:`, acc, err);
      }
      // register() signals failure by returning false, not by throwing.
      if (!ok) console.warn(`${label} hotkey unavailable:`, acc);
    }
  }

  function applyPrefs(next) {
    const previous = prefs;
    const patch = {};
    Object.entries(next || {}).forEach(([k, v]) => {
      if (v !== undefined) patch[k] = v;
    });
    prefs = {
      overlayEnabled: patch.overlayEnabled !== undefined ? patch.overlayEnabled !== false : previous.overlayEnabled,
      clipEnabled: patch.clipEnabled !== undefined ? patch.clipEnabled !== false : previous.clipEnabled,
      clipSeconds: patch.clipSeconds !== undefined
        ? Math.max(8, Math.min(45, Number(patch.clipSeconds) || 20))
        : previous.clipSeconds,
      hotkeys: resolveHotkeys({ ...prefs.hotkeys, ...(patch.hotkeys || {}) }),
      ...resolveHudExtras({ ...prefs, ...patch }),
    };
    savePrefs(prefs);
    const sameCore = previous.overlayEnabled === prefs.overlayEnabled
      && previous.clipEnabled === prefs.clipEnabled
      && previous.clipSeconds === prefs.clipSeconds
      && previous.hotkeys.overlay === prefs.hotkeys.overlay
      && previous.hotkeys.nexai === prefs.hotkeys.nexai
      && previous.hotkeys.clip === prefs.hotkeys.clip;
    if (!sameCore) registerHotkeys();
    // Starting the recorder wipes the rolling buffer, so it must only be
    // touched when the clip settings themselves changed — rebinding a hotkey
    // or toggling the overlay used to throw away the buffered footage.
    if (prefs.clipEnabled !== previous.clipEnabled) {
      clipFailStreak = 0;
      syncClipBuffer();
    } else if (prefs.clipEnabled && prefs.clipSeconds !== previous.clipSeconds) {
      // A running recorder can retune its window without losing what it holds.
      sendClipIfLive('clip-recorder-window', { seconds: prefs.clipSeconds });
      setClipStatus({ ...clipStatus, seconds: prefs.clipSeconds });
    }
    sendOverlayLatest('overlay-prefs', prefs);
    if (!prefs.overlayEnabled && hudOpen) setHudOpen(false);
    if (!hudOpen) hideIfIdle();
    return prefs;
  }

  function setupIpc() {
    ipcMain.handle('overlay-notify', (_event, payload) => {
      if (!payload || typeof payload !== 'object') return { ok: false, reason: 'bad-payload' };
      const force = !!payload.force;
      const main = getMainWindow?.();
      if (!force && main && !main.isDestroyed() && main.isFocused() && !hudOpen) {
        return { ok: false, reason: 'app-focused' };
      }
      return showOverlayMessage({
        kind: String(payload.kind || 'message').slice(0, 24),
        sender: String(payload.sender || 'Friend').slice(0, 40),
        body: String(payload.body || '').slice(0, 160),
        image: !!payload.image,
        unread: Math.max(0, Number(payload.unread) || 0),
        force,
      });
    });

    ipcMain.on('overlay-empty', () => {
      toastLive = false;
      hideIfIdle();
    });

    ipcMain.on('overlay-hud-close', () => setHudOpen(false));

    ipcMain.on('overlay-interactive', (_event, on) => {
      pointerHover = !!on;
      if (!pointerHover) pointerTyping = false;
      applyPointer();
    });

    ipcMain.on('overlay-pointer-down', (_event, on) => {
      pointerDown = !!on;
      if (pointerDown) pointerHover = true;
      else if (!pointerTyping) pointerHover = cursorOverHud();
      applyPointer();
    });

    ipcMain.on('overlay-hit-rects', (_event, rects) => {
      if (!Array.isArray(rects)) {
        hitRects = [];
        return;
      }
      hitRects = rects.slice(0, 48).map((rect) => ({
        x: Number(rect?.x) || 0,
        y: Number(rect?.y) || 0,
        w: Number(rect?.w) || 0,
        h: Number(rect?.h) || 0,
      })).filter((rect) => rect.w > 1 && rect.h > 1);
    });

    setInterval(syncPointerFromCursor, 40);

    ipcMain.on('overlay-typing', (_event, on) => {
      pointerTyping = !!on;
      if (pointerTyping) pointerHover = true;
      applyPointer();
    });

    ipcMain.on('overlay-ai-ask', (_event, payload) => {
      sendToRenderer('overlay-ai-ask', payload);
    });

    ipcMain.on('overlay-ai-reply', (_event, payload) => {
      sendOverlay('overlay-ai-reply', payload);
    });

    ipcMain.handle('overlay-clip-now', () => {
      saveClip('highlight');
      return { ok: true };
    });

    ipcMain.handle('get-overlay-prefs', () => ({
      ...prefs,
      lastClipPath,
      clipStatus,
      clipsDir: clipsDir(),
    }));

    ipcMain.handle('get-perf-sample', () => lastPerf);

    ipcMain.handle('set-overlay-prefs', (_event, next) => applyPrefs(next || {}));

    ipcMain.handle('set-overlay-hotkey', (_event, { action, accelerator } = {}) => {
      if (action !== 'overlay' && action !== 'clip' && action !== 'nexai') {
        return { ok: false, reason: 'bad-action' };
      }
      const acc = String(accelerator || '').trim();
      if (!acc) return { ok: false, reason: 'empty' };

      // Reject a combo already owned by another action instead of letting
      // resolveHotkeys silently remap it and reporting success.
      const resolved = resolveHotkeys({ ...prefs.hotkeys, [action]: acc });
      if (resolved[action] !== acc) {
        return { ok: false, reason: 'conflict', prefs };
      }

      // Probe first. register() returns false rather than throwing, so the old
      // code saved unusable combos and left the user with no working binding.
      const previous = prefs;
      globalShortcut.unregisterAll();
      let usable = false;
      try {
        usable = globalShortcut.register(acc, () => {});
      } catch {
        usable = false;
      }
      globalShortcut.unregisterAll();

      if (!usable) {
        applyPrefs(previous);
        registerHotkeys();
        return { ok: false, reason: 'could-not-register', prefs };
      }

      applyPrefs({ ...prefs, hotkeys: { ...prefs.hotkeys, [action]: acc } });
      return { ok: true, prefs, accelerator: prefs.hotkeys[action] };
    });

    ipcMain.handle('open-clips-folder', async () => {
      const dir = ensureClipsDir();
      const err = await shell.openPath(dir);
      return { ok: !err, reason: err || null, dir };
    });

    ipcMain.handle('overlay-sync-state', (_event, state) => {
      // Merged so a partial push never blanks a field the HUD already showed.
      const next = { ...(overlayReplay.get('overlay-state') || {}), ...(state || {}) };
      if (Object.prototype.hasOwnProperty.call(next, 'game')) {
        lastGame = next.game || '';
      }
      sendOverlayLatest('overlay-state', next);
      if (!hudOpen) hideIfIdle();
      return { ok: true };
    });
    ipcMain.on('overlay-action', (_event, payload) => {
      sendToRenderer('overlay-action', payload || {});
    });

    ipcMain.on('clip-recorder-ready', (_event, status) => {
      clipFailStreak = 0;
      setClipStatus({
        enabled: true,
        buffering: !!status?.buffering,
        readySeconds: Math.max(0, Number(status?.readySeconds) || 0),
        seconds: Number(status?.seconds) || prefs.clipSeconds,
      });
    });

    ipcMain.on('clip-recorder-error', (_event, message) => {
      const msg = String(message || 'Clip buffer failed');
      const saveOnly = /still filling|could not save clip|clip was empty/i.test(msg);
      sendToRenderer('overlay-clip-error', msg);
      // Don't restart the rolling buffer because the user clipped too early,
      // and don't overlay-spam every automatic retry.
      if (saveOnly || clipFailStreak === 0) {
        showOverlayMessage({
          kind: 'clip',
          sender: 'Clip',
          body: msg.slice(0, 140),
          force: true,
        });
      }
      if (!saveOnly) scheduleClipRestart(msg);
    });

    ipcMain.handle('clip-write', async (_event, payload) => {
      const dir = ensureClipsDir();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const game = safeName(payload?.game || lastGame || 'session');
      const file = path.join(dir, `NexForge_${game}_${stamp}.webm`);
      const bytes = payload?.bytes;
      let buffer = Buffer.alloc(0);
      if (Buffer.isBuffer(bytes)) buffer = bytes;
      else if (bytes && bytes.byteLength != null && bytes.buffer) {
        buffer = Buffer.from(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
      } else if (bytes) {
        buffer = Buffer.from(bytes);
      }
      if (!buffer.length) {
        throw new Error('Clip was empty');
      }
      fs.writeFileSync(file, buffer);
      lastClipPath = file;
      showOverlayMessage({
        kind: 'clip',
        sender: 'Clip saved',
        body: path.basename(file),
        force: true,
      });
      sendToRenderer('overlay-clip-saved', { path: file });
      sendOverlay('overlay-clip-saved', { path: file });
      return { ok: true, path: file };
    });
  }

  function destroyWindows() {
    if (clipRestartTimer) {
      clearTimeout(clipRestartTimer);
      clipRestartTimer = null;
    }
    if (clipWindow && !clipWindow.isDestroyed()) {
      try { clipWindow.webContents.send('clip-recorder-stop'); } catch { /* ignore */ }
      clipWindow.destroy();
    }
    clipWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
    overlayWindow = null;
    hudOpen = false;
    hudMode = null;
    toastLive = false;
  }

  function destroy() {
    globalShortcut.unregisterAll();
    if (pointerTimer) {
      clearInterval(pointerTimer);
      pointerTimer = null;
    }
    if (perfMonitor) {
      try { perfMonitor.stop(); } catch { /* ignore */ }
      perfMonitor = null;
    }
    destroyWindows();
  }

  let pointerTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return;
    if (gameplayClickThrough() && (overlayWindow.isFocused() || overlayWindow.isFocusable())) releasePointer();
  }, 2000);
  if (pointerTimer.unref) pointerTimer.unref();

  perfMonitor = createPerfMonitor({
    getActiveGame: () => (typeof getActiveGame === 'function' ? getActiveGame() : null),
    onSample: pushPerf,
  });
  perfMonitor.start();

  return {
    setupIpc,
    registerHotkeys,
    syncClipBuffer,
    setClipLive,
    destroy,
    destroyWindows,
    notify: showOverlayMessage,
    getOverlayWindow,
    prefs: () => prefs,
  };
}

module.exports = { createOverlaySystem, DEFAULT_PREFS };
