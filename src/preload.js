const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('beamdrop', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  getState: () => ipcRenderer.invoke('app:get-state'),
  selectInterface: (address) => ipcRenderer.invoke('app:select-interface', address),
  regeneratePin: () => ipcRenderer.invoke('app:regenerate-pin'),
  setRequireApproval: (enabled) => ipcRenderer.invoke('app:set-approval', enabled),
  approveChallenge: (challengeId, allow) => ipcRenderer.invoke('app:approve-challenge', { challengeId, allow }),
  revokeSessions: () => ipcRenderer.invoke('app:revoke-sessions'),
  pickFiles: () => ipcRenderer.invoke('app:pick-files'),
  pickFolder: () => ipcRenderer.invoke('app:pick-folder'),
  pickSaveDir: () => ipcRenderer.invoke('app:pick-save-dir'),
  openSaveDir: () => ipcRenderer.invoke('app:open-save-dir'),
  addPaths: (paths) => ipcRenderer.invoke('app:add-paths', paths),
  removeSharedItem: (id) => ipcRenderer.invoke('app:remove-shared', id),
  sendClipboard: (text) => ipcRenderer.invoke('app:send-clipboard', text),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),

  onStateChanged: (cb) => ipcRenderer.on('event:state', (_e, data) => cb(data)),
  onFilesChanged: (cb) => ipcRenderer.on('event:files', (_e, files) => cb(files)),
  onTransferUpdate: (cb) => ipcRenderer.on('event:transfer', (_e, transfer) => cb(transfer)),
  onAuthChallenge: (cb) => ipcRenderer.on('event:challenge', (_e, ch) => cb(ch)),
  onSessionsChanged: (cb) => ipcRenderer.on('event:sessions', (_e, sessions) => cb(sessions)),
  onClipboardChanged: (cb) => ipcRenderer.on('event:clipboard', (_e, entries) => cb(entries))
});
