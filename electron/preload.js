const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  hideWindow: () => ipcRenderer.send('hide-window'),
  showWindow: () => ipcRenderer.send('show-window'),
  onAppEvent: (callback) => ipcRenderer.on('app-event', (_event, { type, payload }) => callback(type, payload)),
  speak: (text, voiceId) => ipcRenderer.invoke('speak-text', text, voiceId),
  getApiToken: () => ipcRenderer.invoke('get-api-token'),
});
