// BeamDrop — Copyright (C) 2026 Atharva Patil (p4inz-code) | https://github.com/p4inz-code/beamdrop
// Licensed under GNU GPL-3.0-or-later. See LICENSE and NOTICE for details.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('beamdrop', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  getState: () => ipcRenderer.invoke('app:get-state'),
  selectInterface: (address) => ipcRenderer.invoke('app:select-interface', address),
  regeneratePin: () => ipcRenderer.invoke('app:regenerate-pin'),
  setRequireApproval: (enabled) => ipcRenderer.invoke('app:set-approval', enabled),
  updateSettings: (patch) => ipcRenderer.invoke('app:update-settings', patch),
  approveChallenge: (challengeId, allow, trust = false) => ipcRenderer.invoke('app:approve-challenge', { challengeId, allow, trust }),
  revokeSessions: () => ipcRenderer.invoke('app:revoke-sessions'),
  revokeSession: (sessionId) => ipcRenderer.invoke('app:revoke-session', sessionId),
  revokeTrusted: (id) => ipcRenderer.invoke('app:revoke-trusted', id),
  refreshNetwork: () => ipcRenderer.invoke('app:refresh-network'),
  fixFirewall: () => ipcRenderer.invoke('app:fix-firewall'),
  openHotspot: () => ipcRenderer.invoke('app:open-hotspot'),
  getDiagnostics: () => ipcRenderer.invoke('app:get-diagnostics'),
  pickFiles: () => ipcRenderer.invoke('app:pick-files'),
  pickFolder: () => ipcRenderer.invoke('app:pick-folder'),
  pickSaveDir: () => ipcRenderer.invoke('app:pick-save-dir'),
  openSaveDir: () => ipcRenderer.invoke('app:open-save-dir'),
  showInFolder: (filePath) => ipcRenderer.invoke('app:show-in-folder', filePath),
  addPaths: (paths) => ipcRenderer.invoke('app:add-paths', paths),
  removeSharedItem: (id) => ipcRenderer.invoke('app:remove-shared', id),
  clearSharedItems: () => ipcRenderer.invoke('app:clear-shared'),
  sendClipboard: (text) => ipcRenderer.invoke('app:send-clipboard', text),
  pasteAndSendClipboard: () => ipcRenderer.invoke('app:paste-send-clipboard'),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),

  checkUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  cancelUpdate: () => ipcRenderer.invoke('updater:cancel'),
  installUpdateNow: () => ipcRenderer.invoke('updater:install-now'),
  installUpdateOnQuit: () => ipcRenderer.invoke('updater:install-on-quit'),

  onStateChanged: (cb) => ipcRenderer.on('event:state', (_e, data) => cb(data)),
  onFilesChanged: (cb) => ipcRenderer.on('event:files', (_e, files) => cb(files)),
  onTransferUpdate: (cb) => ipcRenderer.on('event:transfer', (_e, transfer) => cb(transfer)),
  onAuthChallenge: (cb) => ipcRenderer.on('event:challenge', (_e, ch) => cb(ch)),
  onSessionsChanged: (cb) => ipcRenderer.on('event:sessions', (_e, sessions) => cb(sessions)),
  onClipboardChanged: (cb) => ipcRenderer.on('event:clipboard', (_e, entries) => cb(entries)),
  onUpdaterStatus: (cb) => ipcRenderer.on('event:updater-status', (_e, st) => cb(st)),
  onUpdaterProgress: (cb) => ipcRenderer.on('event:updater-progress', (_e, pr) => cb(pr))
});
