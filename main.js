const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, screen, globalShortcut, session } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { GameTracker } = require('./game-tracker');

// Packaged builds stamp the .exe as NexForge; set these so app.getName() / process
// title match even when running unpackaged.
app.setName('NexForge');
process.title = 'NexForge';
if (process.platform === 'win32') {
  // Groups the taskbar icon under NexForge instead of Electron.
  app.setAppUserModelId('com.nexforge.app');
}

const AUTH_PORT = 17890;
const AUTH_HOST = '127.0.0.1';
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'nfaxokwpmaxyhnvatrwf.supabase.co',
  'checkout.stripe.com',
  'billing.stripe.com',
  'connect.stripe.com',
  'github.com',
  'www.github.com',
  'fevrpulse.github.io',
]);
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const UPDATE_FIRST_RECHECK_MS = 15 * 1000;
const UPDATE_INSTALL_DELAY_MS = 2500;
const GENERIC_UPDATE_FEED = 'https://github.com/fevrpulse/NexForge/releases/latest/download';

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let isQuitting = false;
let authServer = null;
let pendingAuthTokens = null;
let authNonce = null;
let updater = null;
const gameTracker = new GameTracker();

// Second launches focus the existing window instead of fighting over the auth port.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function rotateAuthNonce() {
  authNonce = crypto.randomBytes(24).toString('hex');
  return authNonce;
}

function setupGameTracker() {
  gameTracker.on('started', (session) => sendToRenderer('game-session-started', session));
  gameTracker.on('sample', (payload) => sendToRenderer('game-session-sample', payload));
  gameTracker.on('ended', (summary) => sendToRenderer('game-session-ended', summary));
  gameTracker.on('cancelled', (payload) => sendToRenderer('game-session-cancelled', payload || {}));
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log('Auto-updater skipped (dev / unpackaged build)');
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('electron-updater not available:', err);
    return;
  }
  updater = autoUpdater;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.logger = console;
  try {
    // Generic feed skips the GitHub API (rate limits / pagination) so every
    // packaged build can read latest.yml from the current GitHub latest release.
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: GENERIC_UPDATE_FEED,
    });
  } catch (err) {
    console.error('Generic update feed failed; using GitHub provider:', err);
  }

  let installingUpdate = false;
  let updateReadyVersion = null;

  function forceQuitForUpdate() {
    isQuitting = true;
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (err) {
      console.error('quitAndInstall failed; forcing app quit for install-on-quit:', err);
      sendToRenderer('update-status', {
        state: 'error',
        message: 'Update ready — restarting to finish install…',
        version: updateReadyVersion,
      });
      // Ensure close-to-tray cannot strand a downloaded update.
      setTimeout(() => {
        isQuitting = true;
        app.quit();
      }, 400);
    }
  }

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
    sendToRenderer('update-status', { state: 'checking', localVersion: app.getVersion() });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    sendToRenderer('update-status', {
      state: 'available',
      version: info && info.version,
      localVersion: app.getVersion(),
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('No update available. Current version:', app.getVersion(), 'Remote:', info && info.version);
    sendToRenderer('update-status', {
      state: 'not-available',
      version: app.getVersion(),
      remoteVersion: info && info.version,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update-status', {
      state: 'downloading',
      percent: Math.round(progress && progress.percent != null ? progress.percent : 0),
      version: updateReadyVersion,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const version = info && info.version;
    updateReadyVersion = version || null;
    console.log('Update downloaded:', version);
    sendToRenderer('update-status', {
      state: 'downloaded',
      version,
      localVersion: app.getVersion(),
    });
    if (installingUpdate) return;
    installingUpdate = true;

    // Always install the latest build — brief delay so the UI can show a toast.
    setTimeout(() => {
      forceQuitForUpdate();
    }, UPDATE_INSTALL_DELAY_MS);
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
    sendToRenderer('update-status', { state: 'error', message: err && err.message });
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('Update check failed:', err);
  });

  // Catch releases that publish shortly after launch.
  const firstRecheck = setTimeout(() => {
    if (installingUpdate) return;
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('First recheck update failed:', err);
    });
  }, UPDATE_FIRST_RECHECK_MS);
  if (firstRecheck.unref) firstRecheck.unref();

  // Long-running sessions still pick up new releases without a restart.
  const timer = setInterval(() => {
    if (installingUpdate) return;
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('Periodic update check failed:', err);
    });
  }, UPDATE_CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

function getWindowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(getWindowStateFile(), 'utf8'));
    if (!state || typeof state.width !== 'number' || typeof state.height !== 'number') return null;
    return state;
  } catch {
    return null;
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getNormalBounds();
    fs.writeFileSync(getWindowStateFile(), JSON.stringify({
      ...bounds,
      maximized: mainWindow.isMaximized(),
    }));
  } catch {
    /* window state is best-effort */
  }
}

/** Only restore a position that is still visible on a connected display. */
function isOnScreen(state) {
  if (typeof state.x !== 'number' || typeof state.y !== 'number') return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      state.x >= a.x - 100 &&
      state.y >= a.y - 40 &&
      state.x < a.x + a.width - 100 &&
      state.y < a.y + a.height - 100
    );
  });
}

function getAuthFile(name) {
  return path.join(__dirname, name);
}

const OVERLAY_WIDTH = 360;
const OVERLAY_HEIGHT = 380;

function positionOverlay(win) {
  const area = screen.getPrimaryDisplay().workArea;
  win.setBounds({
    x: area.x + area.width - OVERLAY_WIDTH - 8,
    y: area.y + 8,
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
  });
}

/**
 * Transparent, click-through, always-on-top window used for in-game message
 * toasts. Draws over borderless/windowed-fullscreen games (exclusive
 * fullscreen bypasses the desktop compositor and cannot be drawn over).
 */
function getOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;

  overlayWindow = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
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
    title: 'NexForge Overlay',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.setMenu(null);
  positionOverlay(overlayWindow);
  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.on('closed', () => { overlayWindow = null; });
  return overlayWindow;
}

function showOverlayMessage(payload) {
  const win = getOverlayWindow();
  const deliver = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('overlay-message', payload);
    if (!win.isVisible()) {
      positionOverlay(win);
      win.showInactive();
    }
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', deliver);
  } else {
    deliver();
  }
}

function deliverAuthTokens(tokens) {
  pendingAuthTokens = tokens;

  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('auth-callback', tokens);
    pendingAuthTokens = null;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

function startAuthServer() {
  if (authServer) return Promise.resolve(authServer);

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${AUTH_HOST}:${AUTH_PORT}`);

      if (url.pathname === '/callback' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const tokens = JSON.parse(body);
            if (!authNonce || tokens.nonce !== authNonce) {
              res.writeHead(403, { 'Content-Type': 'text/plain' });
              res.end('Invalid auth nonce');
              return;
            }
            if (!tokens.access_token || !tokens.refresh_token) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Missing tokens');
              return;
            }
            // One-time use
            authNonce = null;
            deliverAuthTokens({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              needs_onboarding: !!tokens.needs_onboarding,
            });
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(getAuthFile('auth-success.html')));
          } catch {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid auth payload');
          }
        });
        return;
      }

      const fileMap = {
        '/': 'auth.html',
        '/auth': 'auth.html',
        '/success': 'auth-success.html',
      };

      const fileName = fileMap[url.pathname];
      if (!fileName) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      // Inject current nonce into auth.html so the browser page can prove it was opened by this app
      let html = fs.readFileSync(getAuthFile(fileName), 'utf8');
      if (fileName === 'auth.html') {
        const nonce = authNonce || rotateAuthNonce();
        html = html.replace(
          '/*__NEXFORGE_AUTH_NONCE__*/',
          `window.__NEXFORGE_AUTH_NONCE__ = ${JSON.stringify(nonce)};`
        );
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });

    server.once('error', (err) => {
      console.error('Auth server failed to start:', err);
      if (authServer === server) authServer = null;
      resolve(null);
    });

    server.listen(AUTH_PORT, AUTH_HOST, () => {
      authServer = server;
      resolve(server);
    });
  });
}

function isAllowedNavigation(urlString) {
  try {
    const u = new URL(urlString);
    if (u.protocol === 'file:') return true;
    if (u.hostname === AUTH_HOST && String(u.port) === String(AUTH_PORT)) return true;
    if (
      !app.isPackaged &&
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
      (u.port === '5173' || u.port === '')
    ) {
      return true;
    }
    if (u.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function setupTray() {
  const iconIco = path.join(__dirname, 'build', 'icon.ico');
  const iconPng = path.join(__dirname, 'build', 'icon.png');
  const iconPath = fs.existsSync(iconIco) ? iconIco : iconPng;
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('NexForge');

  const showMain = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  };

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show NexForge', click: showMain },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', showMain);
}

function createWindow() {
  Menu.setApplicationMenu(null);
  const state = loadWindowState();
  const restorePosition = state && isOnScreen(state);
  const iconIco = path.join(__dirname, 'build', 'icon.ico');
  const iconPng = path.join(__dirname, 'build', 'icon.png');
  const windowIcon = process.platform === 'win32' && fs.existsSync(iconIco) ? iconIco : iconPng;
  mainWindow = new BrowserWindow({
    width: Math.max(1100, state?.width || 1400),
    height: Math.max(700, state?.height || 900),
    ...(restorePosition ? { x: state.x, y: state.y } : {}),
    minWidth: 1100,
    minHeight: 700,
    title: 'NexForge',
    icon: windowIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox kept false: GameTracker + native process polling need Node in main;
      // renderer stays isolated via contextIsolation + preload bridge.
      sandbox: false,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);
  if (state?.maximized) mainWindow.maximize();
  mainWindow.on('close', (e) => {
    saveWindowState();
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  // The hidden overlay must not keep the app alive after the main window closes.
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
    overlayWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingAuthTokens) {
      mainWindow.webContents.send('auth-callback', pendingAuthTokens);
      pendingAuthTokens = null;
    }
  });

  const isDev = !app.isPackaged && process.env.NEXFORGE_DEV === '1';
  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist-renderer', 'index.html'));
  }
}

ipcMain.handle('get-pending-auth', () => {
  const tokens = pendingAuthTokens;
  pendingAuthTokens = null;
  return tokens;
});

ipcMain.handle('open-auth-browser', async (_event, mode) => {
  const server = await startAuthServer();
  if (!server) {
    throw new Error(`Could not start the sign-in helper on port ${AUTH_PORT}. Close the app using that port and try again.`);
  }
  rotateAuthNonce();
  const tab = mode === 'signup' ? 'signup' : 'login';
  await shell.openExternal(`http://${AUTH_HOST}:${AUTH_PORT}/auth?mode=${tab}`);
});

ipcMain.handle('open-external-url', async (_event, url) => {
  if (!isAllowedExternalUrl(url)) {
    throw new Error('Blocked untrusted external URL');
  }
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('check-for-updates', async () => {
  if (!updater) return { ok: false, reason: 'dev', localVersion: app.getVersion() };
  try {
    const result = await updater.checkForUpdates();
    const remoteVersion = result?.updateInfo?.version || null;
    return {
      ok: true,
      localVersion: app.getVersion(),
      remoteVersion,
      updateAvailable: !!(remoteVersion && remoteVersion !== app.getVersion()),
    };
  } catch (err) {
    return { ok: false, reason: err?.message || 'Update check failed', localVersion: app.getVersion() };
  }
});

ipcMain.handle('start-game-tracking', () => {
  gameTracker.start();
  return { ok: true, platform: process.platform };
});

ipcMain.handle('stop-game-tracking', () => {
  gameTracker.stop();
  return { ok: true };
});

ipcMain.handle('get-active-game-session', () => gameTracker.getActiveSession());

ipcMain.handle('set-ping-probe-host', (_event, host) => {
  gameTracker.setPingProbeHost(host);
  return { ok: true, host: host || null };
});

ipcMain.handle('get-app-info', () => ({
  platform: process.platform,
  version: app.getVersion(),
  packaged: app.isPackaged,
}));

ipcMain.handle('show-main-window', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return { ok: true };
});

ipcMain.handle('overlay-notify', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'bad-payload' };
  const force = !!payload.force;
  // No point drawing the overlay while the user is already looking at the app
  // (unless they hit the overlay hotkey).
  if (!force && mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
    return { ok: false, reason: 'app-focused' };
  }
  showOverlayMessage({
    kind: String(payload.kind || 'message').slice(0, 24),
    sender: String(payload.sender || 'Friend').slice(0, 40),
    body: String(payload.body || '').slice(0, 120),
    image: !!payload.image,
    unread: Math.max(0, Number(payload.unread) || 0),
  });
  return { ok: true };
});

ipcMain.on('overlay-empty', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  // Allow microphone + display capture for calls / screen share.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (
      permission === 'media'
      || permission === 'microphone'
      || permission === 'audioCapture'
      || permission === 'display-capture'
    ) {
      callback(true);
      return;
    }
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => (
    permission === 'media'
    || permission === 'microphone'
    || permission === 'audioCapture'
    || permission === 'display-capture'
  ));
  try {
    const { desktopCapturer } = require('electron');
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      callback({ video: sources[0], audio: 'loopback' });
    });
  } catch (err) {
    console.warn('Display media handler unavailable:', err);
  }

  await startAuthServer();
  createWindow();
  setupTray();
  setupGameTracker();
  setupAutoUpdater();
  if (process.platform === 'win32') {
    gameTracker.start();
  }

  // Ctrl+Shift+O — peek unread messages on the in-game overlay.
  globalShortcut.register('CommandOrControl+Shift+O', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('overlay-hotkey');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  globalShortcut.unregisterAll();
  gameTracker.stop();
  if (authServer) {
    try { authServer.close(); } catch { /* ignore */ }
    authServer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});
