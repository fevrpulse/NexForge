const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexforge', {
  platform: process.platform,
  openAuthBrowser: (mode) => ipcRenderer.invoke('open-auth-browser', mode),
  getPendingAuth: () => ipcRenderer.invoke('get-pending-auth'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  onAuthCallback: (callback) => {
    ipcRenderer.on('auth-callback', (_event, tokens) => callback(tokens));
  },
  startGameTracking: () => ipcRenderer.invoke('start-game-tracking'),
  stopGameTracking: () => ipcRenderer.invoke('stop-game-tracking'),
  getActiveGameSession: () => ipcRenderer.invoke('get-active-game-session'),
  setPingProbeHost: (host) => ipcRenderer.invoke('set-ping-probe-host', host),
  onGameSessionStarted: (callback) => {
    ipcRenderer.on('game-session-started', (_event, session) => callback(session));
  },
  onGameSessionSample: (callback) => {
    ipcRenderer.on('game-session-sample', (_event, payload) => callback(payload));
  },
  onGameSessionEnded: (callback) => {
    ipcRenderer.on('game-session-ended', (_event, summary) => callback(summary));
  },
  onGameSessionCancelled: (callback) => {
    ipcRenderer.on('game-session-cancelled', (_event, payload) => callback(payload));
  },
});
