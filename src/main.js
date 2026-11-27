// BeamDrop — Copyright (C) 2026 Atharva Patil (p4inz-code) | https://github.com/p4inz-code/beamdrop
// Licensed under GNU GPL-3.0-or-later. See LICENSE and NOTICE for details.

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  dialog,
  shell,
  nativeImage,
  powerSaveBlocker,
  clipboard,
  Notification
} = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { BeamDropServer } = require('./server');
const {
  getNetworkInterfaces,
  probeLanReachability,
  MdnsAdvertiser,
  getOrCreateLocalCert
} = require('./network');
const { SettingsStore } = require('./settings');
const { DiagnosticsLogger } = require('./logger');
const { AppUpdater } = require('./updater');

let mainWindow = null;
let tray = null;
let server = null;
let settingsStore = null;
let logger = null;
let mdns = null;
let updater = null;
let selectedAddress = null;
let isQuitting = false;
let powerSaveId = null;
let adapterWatchTimer = null;
let lastAdapterSig = '';
let lastReachable = true;
let probeTick = 0;
let cachedQrUrl = '';
let cachedQrDataUrl = '';
const activeTransferIds = new Set();

function getAppIcon() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7" fill="#090d14"/>
    <path d="M17 5L9 17h6l-1 10 9-12h-6l1-10z" fill="#38bdf8"/>
  </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

async function buildAppState() {
  const settings = settingsStore.get();
  const net = getNetworkInterfaces();
  const activeAddr =
    selectedAddress && net.interfaces.some((i) => i.address === selectedAddress)
      ? selectedAddress
      : net.recommended.address;
  selectedAddress = activeAddr;

  const proto = settings.useHttps ? 'https' : 'http';
  const url = `${proto}://${activeAddr}:${server.port}`;
  const mdnsUrl = settings.enableMdns ? `${proto}://beamdrop.local:${server.port}` : null;
  const qrUrl = `${url}/?q=${encodeURIComponent(server.qrSecret)}`;
  if (qrUrl !== cachedQrUrl) {
    cachedQrUrl = qrUrl;
    cachedQrDataUrl = await server.getQrDataUrl(qrUrl);
  }
  const lanReachable = await probeLanReachability(activeAddr, server.port, settings.useHttps);
  const wellbeing = await server.getWellbeingReport();
  const qrDataUrl = cachedQrDataUrl;

  return {
    url,
    localBaseUrl: `${proto}://127.0.0.1:${server.port}`,
    localPreviewToken: server.localPreviewToken,
    mdnsUrl,
    qrUrl,
    qrDataUrl,
    pin: server.pin,
    port: server.port,
    useHttps: settings.useHttps,
    lanReachable,
    wellbeing: {
      ...wellbeing,
      lanReachable,
      mdnsEnabled: Boolean(settings.enableMdns),
      vpnDetected: net.vpnDetected
    },
    vpnDetected: net.vpnDetected,
    vpnNames: net.vpnNames,
    ffmpegAvailable: server.ffmpegAvailable,
    settings,
    platform: process.platform,
    requireApproval: server.requireApproval,
    roomMode: server.roomMode,
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
  const wb = settingsStore.get().windowBounds || { width: 1240, height: 820 };
  mainWindow = new BrowserWindow({
    width: wb.width,
    height: wb.height,
    x: wb.x,
    y: wb.y,
    minWidth: 940,
    minHeight: 640,
    frame: false,
    icon: getAppIcon(),
    backgroundColor: '#0c0c0e',
    title: 'BeamDrop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  let boundsTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
        settingsStore.update({ windowBounds: mainWindow.getBounds() }).catch(() => {});
      }
    }, 400);
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function createTray() {
  tray = new Tray(getAppIcon().resize({ width: 16, height: 16 }));
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

async function startServerFromSettings() {
  const settings = settingsStore.get();
  const net = getNetworkInterfaces();
  let tlsOptions = null;
  if (settings.useHttps) {
    const certDir = path.join(app.getPath('userData'), 'certs');
    tlsOptions = await getOrCreateLocalCert(certDir, net.interfaces.map((i) => i.address));
  }

  const trustedStorePath = path.join(app.getPath('userData'), 'trusted_devices.json');
  const port = process.env.BEAMDROP_PORT !== undefined ? Number(process.env.BEAMDROP_PORT) : settings.port;

  server = new BeamDropServer({
    port,
    saveDir: settings.saveDir,
    trustedStorePath,
    tlsOptions,
    logger,
    ffmpegRemux: settings.ffmpegRemux,
    requireApproval: settings.requireApproval,
    roomMode: settings.roomMode
  });

  server.on('files:changed', (files) => sendToRenderer('event:files', files));
  server.on('state:changed', async () => sendToRenderer('event:state', await buildAppState()));
  server.on('sessions:changed', (s) => sendToRenderer('event:sessions', s));
  server.on('clipboard:changed', (c) => sendToRenderer('event:clipboard', c));
  server.on('auth:challenge', (ch) => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
    sendToRenderer('event:challenge', ch);
  });
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

  await server.start();
  if (settings.enableMdns) {
    mdns.start({ port: server.port, useHttps: settings.useHttps });
  } else {
    mdns.stop();
  }
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
  ipcMain.handle('app:get-wellbeing', async () => {
    const net = getNetworkInterfaces();
    const addr = selectedAddress || net.recommended.address;
    const settings = settingsStore.get();
    const lanReachable = await probeLanReachability(addr, server.port, settings.useHttps);
    const report = await server.getWellbeingReport();
    return {
      ...report,
      lanReachable,
      mdnsEnabled: Boolean(settings.enableMdns),
      vpnDetected: net.vpnDetected
    };
  });

  ipcMain.handle('app:select-interface', async (_e, addr) => {
    if (typeof addr === 'string' && addr.length <= 64) {
      selectedAddress = addr;
    }
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
    await settingsStore.update({ requireApproval: Boolean(enabled) });
    const state = await buildAppState();
    sendToRenderer('event:state', state);
    return state;
  });

  ipcMain.handle('app:set-room-mode', async (_e, enabled) => {
    server.setRoomMode(enabled);
    await settingsStore.update({ roomMode: Boolean(enabled) });
    const state = await buildAppState();
    sendToRenderer('event:state', state);
    return state;
  });

  ipcMain.handle('app:update-settings', async (_e, patch) => {
    const prev = settingsStore.get();
    const next = await settingsStore.update(patch);
    if (prev.launchAtLogin !== next.launchAtLogin && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
    }
    if (prev.saveDir !== next.saveDir) {
      await server.setSaveDir(next.saveDir);
    }
    server.ffmpegRemux = next.ffmpegRemux;

    const needsRestart = prev.port !== next.port || prev.useHttps !== next.useHttps;
    if (needsRestart) {
      await server.stop();
      await startServerFromSettings();
    } else if (prev.enableMdns !== next.enableMdns) {
      if (next.enableMdns) mdns.start({ port: server.port, useHttps: next.useHttps });
      else mdns.stop();
    }
    const state = await buildAppState();
    sendToRenderer('event:state', state);
    return state;
  });

  ipcMain.handle('app:approve-challenge', (_e, { challengeId, allow, trust }) => {
    return server.approveChallenge(challengeId, allow, Boolean(trust));
  });

  ipcMain.handle('app:revoke-trusted', (_e, id) => server.revokeTrustedDevice(id));
  ipcMain.handle('app:clear-shared', () => {
    server.clearSharedItems();
    return true;
  });

  ipcMain.handle('app:show-in-folder', (_e, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return;
    const resolved = path.resolve(filePath);
    const saveBase = path.resolve(server.saveDir);
    const inSaveDir = resolved.startsWith(saveBase + path.sep);
    const isShared = Array.from(server.sharedItems.values()).some((i) => i.filePath === resolved);
    if (inSaveDir || isShared) {
      shell.showItemInFolder(resolved);
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

  ipcMain.handle('app:revoke-session', (_e, sessionId) => server.revokeSessionById(sessionId));

  ipcMain.handle('app:refresh-network', async () => {
    const state = await buildAppState();
    sendToRenderer('event:state', state);
    return state;
  });

  ipcMain.handle('app:fix-firewall', () => {
    if (process.platform !== 'win32') return false;
    const port = Number(server.port);
    if (!Number.isInteger(port) || port <= 0) return false;
    const cmd = `Start-Process netsh -Verb RunAs -ArgumentList 'advfirewall','firewall','add','rule','name=BeamDrop','dir=in','action=allow','protocol=TCP','localport=${port}'`;
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-Command', cmd], (err) => {
        if (err) logger.warn('Firewall', `Firewall rule error: ${err.message}`);
        else logger.info('Firewall', `Requested allow rule for TCP ${port}`);
        resolve(!err);
      });
    });
  });

  ipcMain.handle('app:open-hotspot', () => {
    if (process.platform === 'win32') {
      return shell.openExternal('ms-settings:network-mobilehotspot');
    }
    return false;
  });

  ipcMain.handle('app:get-diagnostics', async () => {
    const net = getNetworkInterfaces();
    return logger.getDiagnosticsReport({
      version: app.getVersion(),
      port: server.port,
      useHttps: settingsStore.get().useHttps,
      interfaces: net.interfaces
    });
  });

  ipcMain.handle('app:pick-files', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
    if (!res.canceled && res.filePaths.length > 0) await server.addSharedPaths(res.filePaths, 'pc');
    return server.getPublicFileList();
  });

  ipcMain.handle('app:pick-folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'multiSelections'] });
    if (!res.canceled && res.filePaths.length > 0) await server.addSharedPaths(res.filePaths, 'pc');
    return server.getPublicFileList();
  });

  ipcMain.handle('app:pick-save-dir', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (!res.canceled && res.filePaths[0]) {
      await settingsStore.update({ saveDir: res.filePaths[0] });
      await server.setSaveDir(res.filePaths[0]);
      const state = await buildAppState();
      sendToRenderer('event:state', state);
    }
    return server.saveDir;
  });

  ipcMain.handle('app:open-save-dir', () => shell.openPath(server.saveDir));
  ipcMain.handle('app:add-paths', async (_e, paths) => {
    if (Array.isArray(paths)) {
      const safePaths = paths.filter((p) => typeof p === 'string' && p.length > 0).slice(0, 500);
      await server.addSharedPaths(safePaths, 'pc');
    }
    return server.getPublicFileList();
  });
  ipcMain.handle('app:remove-shared', (_e, id) => server.removeSharedItem(id));
  ipcMain.handle('app:send-clipboard', (_e, text) => server.addClipboardEntry(text, 'PC'));

  // Auto-Updater IPC
  ipcMain.handle('updater:check', () => updater.checkForUpdates());
  ipcMain.handle('updater:download', () => updater.downloadUpdate());
  ipcMain.handle('updater:cancel', () => {
    updater.cancelDownload();
    return true;
  });
  ipcMain.handle('updater:install-now', async () => {
    if (!updater.downloadedPath) return false;
    await shell.openPath(updater.downloadedPath);
    isQuitting = true;
    app.quit();
    return true;
  });
  ipcMain.handle('updater:install-on-quit', () => {
    if (!updater.downloadedPath) return false;
    updater.pendingInstallOnQuit = true;
    return true;
  });
}

process.on('uncaughtException', (err) => {
  logger?.error('Main', `Uncaught exception: ${err.message}`);
  console.error('[BeamDrop Main Error]', err);
});
process.on('unhandledRejection', (err) => {
  logger?.error('Main', `Unhandled rejection: ${err}`);
  console.error('[BeamDrop Unhandled Rejection]', err);
});

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

function extractCliFilePaths(argv = []) {
  const results = [];
  const appPath = path.resolve(app.getAppPath());
  for (const raw of argv.slice(1)) {
    if (!raw || raw.startsWith('-') || raw === '.') continue;
    const resolved = path.resolve(raw);
    if (resolved === appPath || resolved === path.resolve(process.execPath)) continue;
    if (fs.existsSync(resolved)) results.push(resolved);
  }
  return results;
}

const gotSingleInstanceLock =
  process.env.BEAMDROP_PORT !== undefined ? true : app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', async (_event, argv) => {
    const cliPaths = extractCliFilePaths(argv);
    if (cliPaths.length > 0 && server) {
      await server.addSharedPaths(cliPaths, 'pc').catch(() => {});
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  const userData = app.getPath('userData');
  logger = new DiagnosticsLogger(path.join(userData, 'logs'));
  await logger.init();

  settingsStore = new SettingsStore(path.join(userData, 'settings.json'));
  await settingsStore.load();
  mdns = new MdnsAdvertiser();
  updater = new AppUpdater({
    repo: 'p4inz-code/beamdrop',
    currentVersion: app.getVersion(),
    downloadDir: path.join(app.getPath('temp'), 'BeamDropUpdates')
  });
  updater.on('status', (st) => sendToRenderer('event:updater-status', st));
  updater.on('progress', (pr) => sendToRenderer('event:updater-progress', pr));

  await startServerFromSettings();
  const initialPaths = extractCliFilePaths(process.argv);
  if (initialPaths.length > 0) {
    await server.addSharedPaths(initialPaths, 'pc').catch(() => {});
  }
  registerIpc();
  createTray();
  await createWindow();

  if (settingsStore.get().checkUpdatesOnStartup) {
    setTimeout(() => {
      updater.checkForUpdates().catch(() => {});
    }, 3500);
  }

  // 5-second shared-file & adapter sync (only pushes IPC when state actually changes)
  lastAdapterSig = getNetworkInterfaces().interfaces.map((i) => `${i.name}:${i.address}`).join('|');
  adapterWatchTimer = setInterval(async () => {
    probeTick += 1;
    const pruned = await server.pruneMissingSharedItems();
    const sig = getNetworkInterfaces().interfaces.map((i) => `${i.name}:${i.address}`).join('|');
    const adapterChanged = sig !== lastAdapterSig;
    if (adapterChanged) {
      lastAdapterSig = sig;
      logger.info('Network', 'Adapter configuration changed');
    }
    if (adapterChanged || probeTick % 6 === 0) {
      const addr = selectedAddress || getNetworkInterfaces().recommended.address;
      const reachable = await probeLanReachability(addr, server.port, settingsStore.get().useHttps);
      const reachChanged = reachable !== lastReachable;
      lastReachable = reachable;
      if (adapterChanged || reachChanged || pruned) {
        sendToRenderer('event:state', await buildAppState());
      }
    }
  }, 5000);
  adapterWatchTimer.unref();
});

app.on('before-quit', async () => {
  isQuitting = true;
  if (adapterWatchTimer) clearInterval(adapterWatchTimer);
  mdns?.stop();
  if (settingsStore?.get().clearOnQuit && server) {
    server.clearSharedItems();
  }
  if (server) await server.stop();
  if (updater?.pendingInstallOnQuit && updater.downloadedPath) {
    await shell.openPath(updater.downloadedPath).catch(() => {});
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});
