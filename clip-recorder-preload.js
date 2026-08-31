const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipRecorder', {
  onStart: (cb) => ipcRenderer.on('clip-recorder-start', (_e, payload) => cb(payload)),
  onStop: (cb) => ipcRenderer.on('clip-recorder-stop', () => cb()),
  onSave: (cb) => ipcRenderer.on('clip-recorder-save', (_e, payload) => cb(payload)),
  ready: (payload) => ipcRenderer.send('clip-recorder-ready', payload),
  error: (message) => ipcRenderer.send('clip-recorder-error', String(message || 'Clip buffer failed')),
  write: (buffer) => ipcRenderer.invoke('clip-write', buffer),
});
