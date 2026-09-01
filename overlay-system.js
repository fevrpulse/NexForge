const { BrowserWindow, ipcMain, screen, globalShortcut, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_PREFS = {
  overlayEnabled: true,
  clipEnabled: true,
  clipSeconds: 20,
  hotkeys: {
    overlay: 'CommandOrControl+Shift+O',
    nexai: 'CommandOrControl+Shift+A',
    clip: 'CommandOrControl+F8',
  },
};

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

function createOverlaySystem({ getMainWindow, sendToRenderer }) {
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
  let clipStatus = { buffering: true, readySeconds: 0, seconds: prefs.clipSeconds };

  function sendOverlay(channel, payload) {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.webContents.send(channel, payload);
  }

  function overlayBounds() {
    return screen.getPrimaryDisplay().bounds;
  }

  function positionOverlay(win) {
    win.setBounds(overlayBounds());
  }

  function setClickThrough(through) {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    if (through) {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      overlayWindow.setFocusable(false);
    } else {
      overlayWindow.setIgnoreMouseEvents(false);
      overlayWindow.setFocusable(true);
    }
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
      title: 'NexForge Overlay',
      webPreferences: {
        preload: path.join(__dirname, 'overlay-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    try { overlayWindow.setContentProtection(true); } catch { /* older Windows */ }
    setClickThrough(true);
    overlayWindow.setMenu(null);
    overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
    overlayWindow.webContents.on('did-finish-load', () => {
      overlayReady = true;
      const queued = pendingReady;
      pendingReady = null;
      if (queued) for (const fn of queued.values()) fn();
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
      if (hudOpen && overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
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
    });
    return win;
  }

  function hideIfIdle() {
    if (hudOpen || toastLive) return;
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      overlayWindow.hide();
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
      sendOverlay('overlay-hud', {
        open: hudOpen,
        mode: hudMode,
        prefs,
        lastClipPath,
        clipStatus,
      });
      if (hudOpen) {
        // Both modes must accept input: a click-through window cannot hold
        // keyboard focus, so NexAI could not be typed into. The hotkey closes it.
        setClickThrough(false);
        win.show();
        win.focus();
      } else {
        setClickThrough(true);
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

  function syncClipBuffer() {
    if (prefs.clipEnabled) {
      sendClip('clip-recorder-start', { seconds: prefs.clipSeconds });
    } else if (clipWindow && !clipWindow.isDestroyed()) {
      sendClip('clip-recorder-stop');
    }
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
    prefs = {
      overlayEnabled: next.overlayEnabled !== false,
      clipEnabled: next.clipEnabled !== false,
      clipSeconds: Math.max(8, Math.min(45, Number(next.clipSeconds) || 20)),
      hotkeys: resolveHotkeys({ ...prefs.hotkeys, ...(next.hotkeys || {}) }),
    };
    savePrefs(prefs);
    registerHotkeys();
    syncClipBuffer();
    sendOverlay('overlay-prefs', prefs);
    if (!prefs.overlayEnabled && hudOpen) setHudOpen(false);
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
      if (state && Object.prototype.hasOwnProperty.call(state, 'game')) {
        lastGame = state.game || '';
      }
      sendOverlay('overlay-state', state || {});
      return { ok: true };
    });

    ipcMain.on('clip-recorder-ready', (_event, status) => {
      clipStatus = status || clipStatus;
      sendOverlay('overlay-clip-status', clipStatus);
      sendToRenderer('overlay-clip-status', clipStatus);
    });

    ipcMain.on('clip-recorder-error', (_event, message) => {
      sendToRenderer('overlay-clip-error', String(message || 'Clip buffer failed'));
      showOverlayMessage({
        kind: 'clip',
        sender: 'Clip',
        body: String(message || 'Clip buffer failed').slice(0, 140),
        force: true,
      });
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
    destroyWindows();
  }

  return {
    setupIpc,
    registerHotkeys,
    syncClipBuffer,
    destroy,
    destroyWindows,
    notify: showOverlayMessage,
    getOverlayWindow,
    prefs: () => prefs,
  };
}

module.exports = { createOverlaySystem, DEFAULT_PREFS };
