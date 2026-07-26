const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { GameTracker } = require('./game-tracker');

const AUTH_PORT = 17890;
const AUTH_HOST = '127.0.0.1';
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'nfaxokwpmaxyhnvatrwf.supabase.co',
  'github.com',
  'www.github.com',
]);

let mainWindow = null;
let authServer = null;
let pendingAuthTokens = null;
let authNonce = null;
const gameTracker = new GameTracker();

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

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('No update available. Current version:', app.getVersion(), 'Remote:', info && info.version);
  });

  autoUpdater.on('update-downloaded', async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: 'A new version of NexForge has been downloaded.',
      detail: 'Restart now to install the update?',
      buttons: ['Restart', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('Update check failed:', err);
  });
}

function getAuthFile(name) {
  return path.join(__dirname, name);
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
    authServer = http.createServer((req, res) => {
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

    authServer.listen(AUTH_PORT, AUTH_HOST, () => resolve(authServer));
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

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'NexForge',
    icon: path.join(__dirname, 'build', 'icon.png'),
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
  await startAuthServer();
  rotateAuthNonce();
  const tab = mode === 'signup' ? 'signup' : 'login';
  await shell.openExternal(`http://${AUTH_HOST}:${AUTH_PORT}/auth?mode=${tab}`);
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await startAuthServer();
  createWindow();
  setupGameTracker();
  setupAutoUpdater();
  if (process.platform === 'win32') {
    gameTracker.start();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  gameTracker.stop();
  if (authServer) {
    authServer.close();
    authServer = null;
  }
});
