// BeamDrop — Copyright (C) 2026 Atharva Patil (p4inz-code) | https://github.com/p4inz-code/beamdrop
// Licensed under GNU GPL-3.0-or-later. See LICENSE and NOTICE for details.

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, powerSaveBlocker, clipboard, Notification } = require('electron');
const path = require('path');
const os = require('os');
const { BeamDropServer } = require('./server');
const { getNetworkInterfaces } = require('./network');

let mainWindow = null;
let tray = null;
let server = null;
let selectedAddress = null;
let isQuitting = false;
let powerSaveId = null;
const activeTransferIds = new Set();

function createTrayIcon() {
  // Minimal 16x16 SVG icon rendered to nativeImage so no external icon asset is required
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7" fill="#0f172a"/>
    <path d="M16 6v14m0-14l-5 5m5-5l5 5M8 22v3h16v-3" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

async function buildAppState() {
  const net = getNetworkInterfaces();
  const activeAddr =
    selectedAddress && net.interfaces.some((i) => i.address === selectedAddress)
      ? selectedAddress
      : net.recommended.address;
  selectedAddress = activeAddr;

  const url = `http://${activeAddr}:${server.port}`;
  const qrUrl = `${url}/?q=${encodeURIComponent(server.qrSecret)}`;
  const qrDataUrl = await server.getQrDataUrl(qrUrl);

  return {
    url,
    qrUrl,
    qrDataUrl,
    pin: server.pin,
    port: server.port,
    requireApproval: server.requireApproval,
    saveDir: server.saveDir,
    interfaces: net.interfaces,
    selectedAddress: activeAddr,
    files: server.getPublicFileList(),
    sessions: server.getActiveSessions(),
    trustedDevices: server.getTrustedDevices(),
    clipboard: server.clipboard
  };
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 840,
    minHeight: 580,
    frame: false,
    backgroundColor: '#090d16',
    title: 'BeamDrop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  // Block unexpected navigation or popups inside Electron
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('BeamDrop — Wireless File & Video Share');
  const menu = Menu.buildFromTemplate([
    { label: 'Open BeamDrop', click: () => mainWindow?.show() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.focus();
      else mainWindow.show();
    }
  });
}

function registerIpc() {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());

  ipcMain.handle('app:get-state', () => buildAppState());

  ipcMain.handle('app:select-interface', async (_e, addr) => {
    selectedAddress = addr;
    const state = await buildAppState();
    sendToRenderer('event:state', state);
    return state;
  });

  ipcMain.handle('app:regenerate-pin', async () => {
    server.regeneratePin();
    const state = await buildAppState();
    sendToRenderer('event:state', state);
    return state;
  });

  ipcMain.handle('app:set-approval', async (_e, enabled) => {
    server.setRequireApproval(enabled);
    const state = await buildAppState();
    sendToRenderer('event:state', state);
    return state;
  });

  ipcMain.handle('app:approve-challenge', (_e, { challengeId, allow, trust }) => {
    return server.approveChallenge(challengeId, allow, Boolean(trust));
  });

  ipcMain.handle('app:revoke-trusted', (_e, id) => {
    return server.revokeTrustedDevice(id);
  });

  ipcMain.handle('app:clear-shared', () => {
    server.clearSharedItems();
    return true;
  });

  ipcMain.handle('app:show-in-folder', (_e, filePath) => {
    if (typeof filePath === 'string' && filePath) {
      shell.showItemInFolder(filePath);
    }
  });

  ipcMain.handle('app:paste-send-clipboard', () => {
    const text = clipboard.readText();
    if (!text || !text.trim()) return null;
    return server.addClipboardEntry(text, 'PC');
  });

  ipcMain.handle('app:revoke-sessions', () => {
    server.revokeAllSessions();
    return true;
  });

  ipcMain.handle('app:revoke-session', (_e, sessionId) => {
    return server.revokeSessionById(sessionId);
  });

  ipcMain.handle('app:refresh-network', async () => {
    const state = await buildAppState();
    sendToRenderer('event:state', state);
    return state;
  });

  ipcMain.handle('app:pick-files', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections']
    });
    if (!res.canceled && res.filePaths.length > 0) {
      await server.addSharedPaths(res.filePaths, 'pc');
    }
    return server.getPublicFileList();
  });

  ipcMain.handle('app:pick-folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'multiSelections']
    });
    if (!res.canceled && res.filePaths.length > 0) {
      await server.addSharedPaths(res.filePaths, 'pc');
    }
    return server.getPublicFileList();
  });

  ipcMain.handle('app:pick-save-dir', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (!res.canceled && res.filePaths[0]) {
      await server.setSaveDir(res.filePaths[0]);
      const state = await buildAppState();
      sendToRenderer('event:state', state);
    }
    return server.saveDir;
  });

  ipcMain.handle('app:open-save-dir', () => {
    return shell.openPath(server.saveDir);
  });

  ipcMain.handle('app:add-paths', async (_e, paths) => {
    if (Array.isArray(paths)) {
      await server.addSharedPaths(paths, 'pc');
    }
    return server.getPublicFileList();
  });

  ipcMain.handle('app:remove-shared', (_e, id) => {
    return server.removeSharedItem(id);
  });

  ipcMain.handle('app:send-clipboard', (_e, text) => {
    return server.addClipboardEntry(text, 'PC');
  });
}

process.on('uncaughtException', (err) => {
  console.error('[BeamDrop Main Error]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[BeamDrop Unhandled Rejection]', err);
});

app.whenReady().then(async () => {
  const defaultSaveDir = path.join(os.homedir(), 'Downloads', 'BeamDrop');
  const trustedStorePath = path.join(app.getPath('userData'), 'trusted_devices.json');
  server = new BeamDropServer({
    port: Number(process.env.BEAMDROP_PORT || 5050),
    saveDir: defaultSaveDir,
    trustedStorePath,
    requireApproval: true
  });

  server.on('files:changed', (files) => sendToRenderer('event:files', files));
  server.on('state:changed', async () => sendToRenderer('event:state', await buildAppState()));
  server.on('transfer:update', (t) => {
    if (t.status === 'active') {
      activeTransferIds.add(t.id);
      if (powerSaveId === null) {
        powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
      }
    } else {
      activeTransferIds.delete(t.id);
      if (activeTransferIds.size === 0 && powerSaveId !== null) {
        powerSaveBlocker.stop(powerSaveId);
        powerSaveId = null;
      }
      if (t.status === 'completed' && t.direction === 'upload' && (t.totalSize || 0) >= 10 * 1024 * 1024) {
        if (mainWindow && (!mainWindow.isVisible() || !mainWindow.isFocused()) && Notification.isSupported()) {
          new Notification({ title: 'BeamDrop Transfer Complete', body: `${t.filename} saved to PC.` }).show();
        }
      }
    }
    sendToRenderer('event:transfer', t);
  });
  server.on('auth:challenge', (ch) => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
    sendToRenderer('event:challenge', ch);
  });
  server.on('sessions:changed', (s) => sendToRenderer('event:sessions', s));
  server.on('clipboard:changed', (c) => sendToRenderer('event:clipboard', c));

  await server.start();
  registerIpc();
  createTray();
  await createWindow();
});

app.on('before-quit', async () => {
  isQuitting = true;
  if (server) {
    await server.stop();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});
