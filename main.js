const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, screen, globalShortcut, session } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { GameTracker, MIN_SESSION_SEC } = require('./game-tracker');
const { createOverlaySystem } = require('./overlay-system');

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
const QUIT_SESSION_FLUSH_MS = 4000;
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const UPDATE_FIRST_RECHECK_MS = 15 * 1000;
const UPDATE_INSTALL_DELAY_MS = 2500;
const GENERIC_UPDATE_FEED = 'https://github.com/fevrpulse/NexForge/releases/latest/download';

let mainWindow = null;
let overlaySystem = null;
let checkoutWindow = null;
let tray = null;
let isQuitting = false;
let authServer = null;
let pendingAuthTokens = null;
let authNonce = null;
let updater = null;
let quitSessionFlushStarted = false;
let sessionFlushDone = null;
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

/**
 * The renderer owns the game_sessions insert, so a session still in progress
 * has to be finalized while the main window is alive. will-quit is far too
 * late: the window is gone by then and the summary lands nowhere.
 */
function flushGameSessionForQuit() {
  const active = gameTracker.getActiveSession();
  if (!active) return Promise.resolve();

  const rendererAlive = !!(
    mainWindow
    && !mainWindow.isDestroyed()
    && !mainWindow.webContents.isDestroyed()
    && !mainWindow.webContents.isLoading()
  );
  // Below the minimum length the tracker discards the session, so there is no
  // row to write and nothing to wait for.
  if (!rendererAlive || active.durationSec < MIN_SESSION_SEC) {
    gameTracker.stop();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      sessionFlushDone = null;
      resolve();
    };
    timer = setTimeout(finish, QUIT_SESSION_FLUSH_MS);
    sessionFlushDone = finish;
    // Emits 'ended' -> renderer writes the row -> acks on 'game-session-saved'.
    gameTracker.stop();
  });
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

/** Overlay HUD + clip buffer (created in app.whenReady). */
function ensureOverlaySystem() {
  if (overlaySystem) return overlaySystem;
  overlaySystem = createOverlaySystem({
    getMainWindow: () => mainWindow,
    sendToRenderer,
  });
  overlaySystem.setupIpc();
  return overlaySystem;
}

function deliverAuthTokens(tokens) {
  pendingAuthTokens = tokens;

  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('auth-callback', tokens);
    pendingAuthTokens = null;
    // Closed to tray means hidden, not minimized: without show() the app
    // signs in invisibly and the user assumes it failed.
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
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

function isCheckoutReturnUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'https:'
      && url.hostname === 'nfaxokwpmaxyhnvatrwf.supabase.co'
      && url.pathname.includes('/functions/v1/stripe-checkout-return');
  } catch {
    return false;
  }
}

function isSafeCheckoutNav(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'https:' || url.protocol === 'http:';
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
      return;
    }
    // Quitting mid-game: hold the close just long enough for the renderer to
    // save the session, then let the quit carry on. Preventing the close also
    // cancels the quit, so it has to be restarted once the write lands.
    if (!quitSessionFlushStarted && gameTracker.hasActiveSession()) {
      quitSessionFlushStarted = true;
      e.preventDefault();
      flushGameSessionForQuit().then(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
        else app.quit();
      });
    }
  });
  // The hidden overlay must not keep the app alive after the main window closes.
  mainWindow.on('closed', () => {
    mainWindow = null;
    overlaySystem?.destroyWindows();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // isAllowedNavigation() accepts any file: URL, which has no business being
    // handed to the OS shell — only the vetted https hosts may open externally.
    if (isAllowedExternalUrl(url)) {
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

ipcMain.handle('open-checkout-window', async (_event, url) => {
  if (!isAllowedExternalUrl(url)) {
    throw new Error('Blocked untrusted checkout URL');
  }
  if (checkoutWindow && !checkoutWindow.isDestroyed()) {
    checkoutWindow.focus();
    return { ok: true, reason: 'already-open' };
  }

  checkoutWindow = new BrowserWindow({
    width: 520,
    height: 780,
    title: 'NexForge Checkout',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  checkoutWindow.setMenu(null);

  const outcome = new Promise((resolve) => {
    let settled = false;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      resolve({ ok: true, reason });
    };

    checkoutWindow.on('closed', () => {
      checkoutWindow = null;
      finish('closed');
    });

    const handleReturn = (navUrl) => {
      if (!isCheckoutReturnUrl(navUrl)) return false;
      const cancelled = /[?&]status=cancelled(?:&|$)/.test(navUrl);
      finish(cancelled ? 'cancelled' : 'returned');
      if (checkoutWindow && !checkoutWindow.isDestroyed()) {
        checkoutWindow.close();
      }
      return true;
    };

    checkoutWindow.webContents.on('will-navigate', (event, navUrl) => {
      if (handleReturn(navUrl)) {
        event.preventDefault();
        return;
      }
      if (!isSafeCheckoutNav(navUrl)) event.preventDefault();
    });
    checkoutWindow.webContents.on('will-redirect', (event, navUrl) => {
      if (handleReturn(navUrl)) {
        event.preventDefault();
        return;
      }
      if (!isSafeCheckoutNav(navUrl)) event.preventDefault();
    });
    checkoutWindow.webContents.setWindowOpenHandler(({ url: popUrl }) => {
      if (!isSafeCheckoutNav(popUrl)) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
        },
      };
    });
  });

  try {
    await checkoutWindow.loadURL(url);
  } catch (err) {
    if (checkoutWindow && !checkoutWindow.isDestroyed()) checkoutWindow.destroy();
    checkoutWindow = null;
    throw err;
  }
  return outcome;
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

// Renderer confirms the finished session has been written (or definitively
// failed), which releases the quit that is waiting on it.
ipcMain.on('game-session-saved', () => {
  sessionFlushDone?.();
});

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
      // The callback must always run: skipping it leaves the renderer's
      // getDisplayMedia() promise pending forever with nothing to report.
      try {
        const screens = await desktopCapturer.getSources({ types: ['screen'] });
        const source = screens[0] || (await desktopCapturer.getSources({ types: ['window'] }))[0];
        if (!source) {
          callback({});
          return;
        }
        callback({ video: source, audio: 'loopback' });
      } catch (err) {
        console.error('Display capture source lookup failed:', err);
        callback({});
      }
    });
  } catch (err) {
    console.warn('Display media handler unavailable:', err);
  }

  await startAuthServer();
  ensureOverlaySystem();
  createWindow();
  setupTray();
  setupGameTracker();
  setupAutoUpdater();
  overlaySystem.registerHotkeys();
  setTimeout(() => overlaySystem?.syncClipBuffer(), 1800);
  const presenceTimer = setInterval(() => sendToRenderer('presence-tick'), 45000);
  if (presenceTimer.unref) presenceTimer.unref();
  if (process.platform === 'win32') {
    gameTracker.start();
  }

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
  overlaySystem?.destroy();
  overlaySystem = null;
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
