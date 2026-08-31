const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('nexforgeOverlay', {
  onMessage: (cb) => subscribe('overlay-message', cb),
  onHud: (cb) => subscribe('overlay-hud', cb),
  onPrefs: (cb) => subscribe('overlay-prefs', cb),
  onState: (cb) => subscribe('overlay-state', cb),
  onAiReply: (cb) => subscribe('overlay-ai-reply', cb),
  onClipStatus: (cb) => subscribe('overlay-clip-status', cb),
  onClipSaved: (cb) => subscribe('overlay-clip-saved', cb),
  empty: () => ipcRenderer.send('overlay-empty'),
  closeHud: () => ipcRenderer.send('overlay-hud-close'),
  askAi: (payload) => ipcRenderer.send('overlay-ai-ask', payload),
  clipNow: () => ipcRenderer.invoke('overlay-clip-now'),
});
