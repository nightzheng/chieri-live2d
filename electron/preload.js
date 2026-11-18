'use strict';
// The page's only bridge to the desktop shell.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setLocale: locale => ipcRenderer.invoke('settings:locale', locale),
  onLocale: cb => ipcRenderer.on('settings:locale', (_, locale) => cb(locale)),
  setSettings: s => ipcRenderer.invoke('settings:set', s),
  memory: (operation, value) => ipcRenderer.invoke('memory:operate', operation, value),
  openDataManager: () => ipcRenderer.invoke('memory:manager'),
  onHistoryChanged: cb => ipcRenderer.on('memory:historyChanged', () => cb()),
  companion: (operation, value) => ipcRenderer.invoke('companion:operate', operation, value),
  onAgenda: cb => ipcRenderer.on('companion:agenda', () => cb()),
  onProactivePaused: cb => ipcRenderer.on('companion:paused', () => cb()),
  vision: (operation, value) => ipcRenderer.invoke('vision:operate', operation, value),
  onVision: cb => ipcRenderer.on('vision:update', (_, state) => cb(state)),
  aiRequest: r => ipcRenderer.invoke('ai:request', r),
  setIgnoreMouse: v => ipcRenderer.send('pet:ignore', !!v),
  applyPet: p => ipcRenderer.send('pet:apply', p),
  toPet: () => ipcRenderer.send('win:toPet'),
  toStudio: () => ipcRenderer.send('win:toStudio'),
  showMenu: () => ipcRenderer.send('pet:menu'),
  onSettings: cb => ipcRenderer.on('settings:changed', () => cb()),
  onCmd: cb => ipcRenderer.on('cmd', (_, c) => cb(c)),
  // the system cursor anywhere on screen, relative to this window's content ({x, y}, ~30 Hz while it moves)
  onCursor: cb => ipcRenderer.on('cursor', (_, p) => cb(p)),
  // carry the pet window along with the cursor until drag(false)
  drag: on => ipcRenderer.send('pet:drag', !!on),
  // widen the pet window leftwards for the chat / settings panel
  side: on => ipcRenderer.send('pet:side', !!on),
  setScale: k => ipcRenderer.send('pet:scale', k),
  // start with Windows: autoStart() reads, autoStart(true / false) sets; -> { on, blocked, dev }
  autoStart: on => ipcRenderer.invoke('app:autoStart', on === undefined ? null : !!on),
  // her voice (electron/voice.js): capabilities, online requests, the local Chieri model and its environment
  ttsInfo: () => ipcRenderer.invoke('tts:info'),
  ttsFetch: r => ipcRenderer.invoke('tts:fetch', r),
  chieri: o => ipcRenderer.invoke('tts:chieri', o),
  chieriStart: o => ipcRenderer.invoke('tts:start', o || {}),
  chieriCheck: o => ipcRenderer.invoke('tts:check', o || {}),
  chieriSetup: o => ipcRenderer.invoke('tts:setup', o || {}),
  chieriSetupCancel: () => ipcRenderer.send('tts:setupCancel'),
  pickPython: () => ipcRenderer.invoke('tts:pickPython'),
  pythonPage: () => ipcRenderer.send('tts:pythonPage'),
  onTtsState: cb => ipcRenderer.on('tts:state', (_, s) => cb(s)),
  onTtsLog: cb => ipcRenderer.on('tts:log', (_, l) => cb(l)),
  // environment setup: {pct, step, steps, title, detail, pulse, done, ok}
  onTtsProgress: cb => ipcRenderer.on('tts:progress', (_, p) => cb(p)),
});
