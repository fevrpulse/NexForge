const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexforge', {
  platform: process.platform,
  openAuthBrowser: (mode) => ipcRenderer.invoke('open-auth-browser', mode),
  getPendingAuth: () => ipcRenderer.invoke('get-pending-auth'),
  onAuthCallback: (callback) => {
    ipcRenderer.on('auth-callback', (_event, tokens) => callback(tokens));
  },
});
