const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexforgeOverlay', {
  onMessage: (callback) => {
    ipcRenderer.on('overlay-message', (_event, payload) => callback(payload));
  },
  empty: () => ipcRenderer.send('overlay-empty'),
});
