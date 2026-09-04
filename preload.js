'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// A narrow, explicit bridge. The renderer never touches Node or ipcRenderer directly.
contextBridge.exposeInMainWorld('wall', {
  // --- data ---
  load: () => ipcRenderer.invoke('data:load'),
  save: (doc) => ipcRenderer.invoke('data:save', doc),

  // --- settings ---
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickBackground: () => ipcRenderer.invoke('bg:pick'),
  backgroundUrl: (filePath) => ipcRenderer.invoke('bg:url', filePath),

  // --- window ---
  setIgnoreMouse: (ignore, opts) => ipcRenderer.send('window:set-ignore-mouse', ignore, opts),
  getBounds: () => ipcRenderer.invoke('window:get-bounds'),
  setBounds: (bounds) => ipcRenderer.send('window:set-bounds', bounds),
  closeApp: () => ipcRenderer.send('window:close'),
  minimize: () => ipcRenderer.send('window:minimize'),
  savePreset: (index) => ipcRenderer.invoke('window:save-preset', index),
  loadPreset: (index) => ipcRenderer.invoke('window:load-preset', index),

  // --- events from main ---
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
  onBoundsDirty: (cb) => ipcRenderer.on('window:bounds-dirty', () => cb()),
  onAddNote: (cb) => ipcRenderer.on('cmd:add-note', () => cb()),
  onAddHeader: (cb) => ipcRenderer.on('cmd:add-header', () => cb())
});
