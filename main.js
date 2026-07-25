const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const AUTH_PORT = 17890;
const AUTH_HOST = '127.0.0.1';

let mainWindow = null;
let authServer = null;
let pendingAuthTokens = null;

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('electron-updater not available:', err);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

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
            deliverAuthTokens(tokens);
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

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(getAuthFile(fileName)));
    });

    authServer.listen(AUTH_PORT, AUTH_HOST, () => resolve(authServer));
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'NexForge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingAuthTokens) {
      mainWindow.webContents.send('auth-callback', pendingAuthTokens);
      pendingAuthTokens = null;
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('get-pending-auth', () => {
  const tokens = pendingAuthTokens;
  pendingAuthTokens = null;
  return tokens;
});

ipcMain.handle('open-auth-browser', async (_event, mode) => {
  await startAuthServer();
  const tab = mode === 'signup' ? 'signup' : 'login';
  await shell.openExternal(`http://${AUTH_HOST}:${AUTH_PORT}/auth?mode=${tab}`);
});

app.whenReady().then(async () => {
  await startAuthServer();
  createWindow();
  setupAutoUpdater();

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
  if (authServer) {
    authServer.close();
    authServer = null;
  }
});
