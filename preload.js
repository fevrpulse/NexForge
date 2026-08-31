const { contextBridge, ipcRenderer } = require('electron');

/** Subscribe to an IPC channel and return an unsubscribe function. */
function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('nexforge', {
  platform: process.platform,
  openAuthBrowser: (mode) => ipcRenderer.invoke('open-auth-browser', mode),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  openCheckoutWindow: (url) => ipcRenderer.invoke('open-checkout-window', url),
  getPendingAuth: () => ipcRenderer.invoke('get-pending-auth'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onAuthCallback: (callback) => subscribe('auth-callback', callback),
  onUpdateStatus: (callback) => subscribe('update-status', callback),
  overlayNotify: (payload) => ipcRenderer.invoke('overlay-notify', payload),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
  onOverlayHotkey: (callback) => subscribe('overlay-hotkey', callback),
  onOverlayHotkeyBlocked: (callback) => subscribe('overlay-hotkey-blocked', callback),
  onOverlayAiAsk: (callback) => subscribe('overlay-ai-ask', callback),
  overlayAiReply: (payload) => ipcRenderer.send('overlay-ai-reply', payload),
  overlaySyncState: (state) => ipcRenderer.invoke('overlay-sync-state', state),
  getOverlayPrefs: () => ipcRenderer.invoke('get-overlay-prefs'),
  setOverlayPrefs: (prefs) => ipcRenderer.invoke('set-overlay-prefs', prefs),
  setOverlayHotkey: (payload) => ipcRenderer.invoke('set-overlay-hotkey', payload),
  openClipsFolder: () => ipcRenderer.invoke('open-clips-folder'),
  clipNow: () => ipcRenderer.invoke('overlay-clip-now'),
  onOverlayClipSaved: (callback) => subscribe('overlay-clip-saved', callback),
  onOverlayClipError: (callback) => subscribe('overlay-clip-error', callback),
  onOverlayClipStatus: (callback) => subscribe('overlay-clip-status', callback),
  startGameTracking: () => ipcRenderer.invoke('start-game-tracking'),
  stopGameTracking: () => ipcRenderer.invoke('stop-game-tracking'),
  getActiveGameSession: () => ipcRenderer.invoke('get-active-game-session'),
  setPingProbeHost: (host) => ipcRenderer.invoke('set-ping-probe-host', host),
  onGameSessionStarted: (callback) => subscribe('game-session-started', callback),
  onGameSessionSample: (callback) => subscribe('game-session-sample', callback),
  onGameSessionEnded: (callback) => subscribe('game-session-ended', callback),
  onGameSessionCancelled: (callback) => subscribe('game-session-cancelled', callback),
  onPresenceTick: (callback) => subscribe('presence-tick', callback),
});
