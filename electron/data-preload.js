'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dataAPI', {
  memory: (operation, value) => ipcRenderer.invoke('memory:operate', operation, value),
});
