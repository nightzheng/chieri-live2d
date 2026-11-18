'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dataAPI', {
  onLocale: cb => ipcRenderer.on('settings:locale', (_, locale) => cb(locale)),
  memory: (operation, value) => ipcRenderer.invoke('memory:operate', operation, value),
});
