const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  hideWindow: () => ipcRenderer.send('hide-window'),
  onAppEvent: (callback) => ipcRenderer.on('app-event', (_event, { type, payload }) => callback(type, payload)),
});
