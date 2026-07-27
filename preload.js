const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('nexforge', {
  platform: process.platform,
  openAuthBrowser: (mode) => ipcRenderer.invoke('open-auth-browser', mode),
  getPendingAuth: () => ipcRenderer.invoke('get-pending-auth'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  onAuthCallback: (callback) => subscribe('auth-callback', callback),
  startGameTracking: () => ipcRenderer.invoke('start-game-tracking'),
  stopGameTracking: () => ipcRenderer.invoke('stop-game-tracking'),
  getActiveGameSession: () => ipcRenderer.invoke('get-active-game-session'),
  setPingProbeHost: (host) => ipcRenderer.invoke('set-ping-probe-host', host),
  onGameSessionStarted: (callback) => subscribe('game-session-started', callback),
  onGameSessionSample: (callback) => subscribe('game-session-sample', callback),
  onGameSessionEnded: (callback) => subscribe('game-session-ended', callback),
  onGameSessionCancelled: (callback) => subscribe('game-session-cancelled', callback),
});
