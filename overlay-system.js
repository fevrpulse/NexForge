const { BrowserWindow, ipcMain, screen, globalShortcut, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_PREFS = {
  overlayEnabled: true,
  clipEnabled: true,
  clipSeconds: 20,
  hotkeys: {
    overlay: 'CommandOrControl+Shift+O',
    clip: 'CommandOrControl+F8',
  },
};

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
      hotkeys: {
        overlay: String(raw.hotkeys?.overlay || DEFAULT_PREFS.hotkeys.overlay),
        clip: String(raw.hotkeys?.clip || DEFAULT_PREFS.hotkeys.clip),
      },
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
  let clipWindow = null;
  let hudOpen = false;
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
    overlayWindow.on('closed', () => {
      overlayWindow = null;
      hudOpen = false;
      toastLive = false;
    });
    overlayWindow.on('blur', () => {
      if (hudOpen && overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    });
    return overlayWindow;
  }

  function showOverlay() {
    const win = getOverlayWindow();
    const deliver = () => {
      if (!win || win.isDestroyed()) return;
      positionOverlay(win);
      if (!win.isVisible()) win.showInactive();
    };
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', deliver);
    } else {
      deliver();
    }
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
    const deliver = () => {
      if (!win || win.isDestroyed()) return;
      toastLive = true;
      win.webContents.send('overlay-message', payload);
    };
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', deliver);
    } else {
      deliver();
    }
    return { ok: true };
  }

  function setHudOpen(open) {
    hudOpen = !!open;
    const win = showOverlay();
    const apply = () => {
      if (!win || win.isDestroyed()) return;
      sendOverlay('overlay-hud', {
        open: hudOpen,
        prefs,
        lastClipPath,
        clipStatus,
      });
      if (hudOpen) {
        setClickThrough(false);
        win.show();
        win.focus();
      } else {
        setClickThrough(true);
        hideIfIdle();
      }
    };
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', apply);
    } else {
      apply();
    }
    sendToRenderer('overlay-hotkey', { open: hudOpen });
  }

  function toggleHud() {
    if (!prefs.overlayEnabled) {
      sendToRenderer('overlay-hotkey-blocked', { reason: 'disabled' });
      return;
    }
    setHudOpen(!hudOpen);
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
    const overlayAcc = prefs.hotkeys.overlay || DEFAULT_PREFS.hotkeys.overlay;
    const clipAcc = prefs.hotkeys.clip || DEFAULT_PREFS.hotkeys.clip;
    try {
      globalShortcut.register(overlayAcc, () => toggleHud());
    } catch (err) {
      console.warn('Overlay hotkey failed:', overlayAcc, err);
    }
    try {
      globalShortcut.register(clipAcc, () => saveClip('highlight'));
    } catch (err) {
      console.warn('Clip hotkey failed:', clipAcc, err);
    }
  }

  function applyPrefs(next) {
    prefs = {
      overlayEnabled: next.overlayEnabled !== false,
      clipEnabled: next.clipEnabled !== false,
      clipSeconds: Math.max(8, Math.min(45, Number(next.clipSeconds) || 20)),
      hotkeys: {
        overlay: String(next.hotkeys?.overlay || prefs.hotkeys.overlay),
        clip: String(next.hotkeys?.clip || prefs.hotkeys.clip),
      },
    };
    if (prefs.hotkeys.overlay === prefs.hotkeys.clip) {
      prefs.hotkeys.clip = DEFAULT_PREFS.hotkeys.clip;
      if (prefs.hotkeys.overlay === prefs.hotkeys.clip) {
        prefs.hotkeys.clip = 'CommandOrControl+F9';
      }
    }
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
      if (action !== 'overlay' && action !== 'clip') {
        return { ok: false, reason: 'bad-action' };
      }
      const acc = String(accelerator || '').trim();
      if (!acc) return { ok: false, reason: 'empty' };
      const next = {
        ...prefs,
        hotkeys: { ...prefs.hotkeys, [action]: acc },
      };
      applyPrefs(next);
      if (!globalShortcut.isRegistered(acc)) {
        return { ok: false, reason: 'could-not-register', prefs };
      }
      return { ok: true, prefs };
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
