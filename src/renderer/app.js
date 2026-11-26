const $ = (id) => document.getElementById(id);

const transfers = new Map();
const pendingChallenges = [];
const PAGE_SIZE = 50;
let allFiles = [];
let visibleLimit = PAGE_SIZE;
let currentQrUrl = '';
let currentState = null;
let activeFilter = 'all';
let searchQuery = '';
let toastTimer = null;

function isSafeHttpUrl(raw) {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function createSvgIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('class', 'item-icon');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  if (kind === 'folder') {
    path.setAttribute('d', 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z');
  } else if (kind === 'video') {
    path.setAttribute('d', 'M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2z');
  } else if (kind === 'image') {
    path.setAttribute('d', 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zm4 10l3-3 4 4 2-2 3 3');
  } else {
    path.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z');
  }
  svg.appendChild(path);
  return svg;
}

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i >= 2 ? 2 : 0)} ${units[i]}`;
}

function getFileKind(file) {
  if (file.isDirectory) return 'folder';
  if (file.mimeType.startsWith('video/')) return 'video';
  if (file.mimeType.startsWith('image/')) return 'image';
  return 'file';
}

function renderState(state) {
  currentState = state;
  currentQrUrl = state.qrUrl || state.url;
  $('qr-img').src = state.qrDataUrl;
  $('qr-large-img').src = state.qrDataUrl;
  $('server-url').textContent = state.url;
  $('qr-large-url').textContent = state.url;
  $('pin-code').textContent = state.pin;
  $('chk-approval').checked = state.requireApproval;
  $('save-dir-path').textContent = state.saveDir;

  const mdnsEl = $('mdns-pill');
  if (state.mdnsUrl) {
    mdnsEl.textContent = state.mdnsUrl;
    mdnsEl.classList.remove('hidden');
  } else {
    mdnsEl.classList.add('hidden');
  }

  const dot = $('lan-status-dot');
  const txt = $('lan-status-text');
  if (!state.lanReachable) {
    dot.classList.add('warn');
    txt.textContent = 'Check Firewall';
  } else if (state.vpnDetected) {
    dot.classList.add('warn');
    txt.textContent = 'VPN Active';
  } else {
    dot.classList.remove('warn');
    txt.textContent = state.useHttps ? 'HTTPS Ready' : 'LAN Ready';
  }

  const select = $('iface-select');
  select.textContent = '';
  for (const iface of state.interfaces) {
    const opt = document.createElement('option');
    opt.value = iface.address;
    opt.textContent = `${iface.name} (${iface.address})`;
    if (iface.address === state.selectedAddress) opt.selected = true;
    select.appendChild(opt);
  }

  renderFiles(state.files);
  renderSessions(state.sessions);
  renderTrusted(state.trustedDevices || []);
  renderClipboard(state.clipboard);
}

function renderFiles(files) {
  allFiles = files;
  $('files-count').textContent = String(files.length);
  const list = $('files-list');
  list.textContent = '';

  const filtered = files.filter((file) => {
    if (activeFilter === 'video' && !file.mimeType.startsWith('video/')) return false;
    if (activeFilter === 'image' && !file.mimeType.startsWith('image/')) return false;
    if (activeFilter === 'folder' && !file.isDirectory) return false;
    if (searchQuery && !file.name.toLowerCase().includes(searchQuery)) return false;
    return true;
  });

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = files.length === 0
      ? 'No shared files yet. Drop videos or folders above to share.'
      : 'No files match the current filter.';
    list.appendChild(empty);
    return;
  }

  const slice = filtered.slice(0, visibleLimit);
  for (const file of slice) {
    const row = document.createElement('div');
    row.className = 'item-row';

    row.appendChild(createSvgIcon(getFileKind(file)));

    const meta = document.createElement('div');
    meta.className = 'item-meta';

    const nameEl = document.createElement('div');
    nameEl.className = 'item-name';
    nameEl.textContent = file.name;

    const subEl = document.createElement('div');
    subEl.className = 'item-sub';
    subEl.textContent = file.isDirectory
      ? `Folder (.zip) · Source: ${file.source.toUpperCase()}`
      : `${formatBytes(file.size)} · Source: ${file.source.toUpperCase()}`;

    meta.appendChild(nameEl);
    meta.appendChild(subEl);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-sm';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => window.beamdrop.removeSharedItem(file.id));

    row.appendChild(meta);
    row.appendChild(removeBtn);
    list.appendChild(row);
  }

  if (filtered.length > visibleLimit) {
    const moreBtn = document.createElement('button');
    moreBtn.className = 'btn btn-sm';
    moreBtn.textContent = `Show More (${filtered.length - visibleLimit} remaining)`;
    moreBtn.addEventListener('click', () => {
      visibleLimit += PAGE_SIZE;
      renderFiles(allFiles);
    });
    list.appendChild(moreBtn);
  }
}

function renderTransfers() {
  const items = Array.from(transfers.values());
  $('transfers-count').textContent = String(items.length);
  const list = $('transfers-list');
  list.textContent = '';

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No active or recent transfers.';
    list.appendChild(empty);
    return;
  }

  for (const t of items.reverse()) {
    const row = document.createElement('div');
    row.className = 'item-row';

    const meta = document.createElement('div');
    meta.className = 'item-meta';

    const nameEl = document.createElement('div');
    nameEl.className = 'item-name';

    const badge = document.createElement('span');
    const isDownload = t.direction === 'download';
    badge.className = `dir-badge ${isDownload ? 'dir-down' : 'dir-up'}`;
    badge.textContent = isDownload ? 'PC -> PHONE' : 'PHONE -> PC';

    nameEl.appendChild(badge);
    nameEl.appendChild(document.createTextNode(t.filename));

    const subEl = document.createElement('div');
    subEl.className = 'item-sub';
    if (t.status === 'completed') {
      subEl.textContent = `Completed · ${formatBytes(t.totalSize)}`;
    } else if (t.status === 'cancelled') {
      subEl.textContent = 'Cancelled';
    } else if (t.status === 'error') {
      subEl.textContent = 'Transfer interrupted';
    } else {
      const mbps = ((t.speedBps || 0) / (1024 * 1024)).toFixed(1);
      subEl.textContent = `${t.percent}% · ${formatBytes(t.receivedBytes)} / ${formatBytes(t.totalSize)} · ${mbps} MB/s · ETA ${t.etaSec}s`;
    }

    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = `${t.percent || 0}%`;
    bar.appendChild(fill);

    meta.appendChild(nameEl);
    meta.appendChild(subEl);
    meta.appendChild(bar);
    row.appendChild(meta);

    if (t.status === 'completed' && t.filePath) {
      const revealBtn = document.createElement('button');
      revealBtn.className = 'btn btn-sm';
      revealBtn.textContent = 'Show in Folder';
      revealBtn.addEventListener('click', () => window.beamdrop.showInFolder(t.filePath));
      row.appendChild(revealBtn);
    }

    list.appendChild(row);
  }
}

function renderSessions(sessions) {
  $('session-count').textContent = String(sessions.length);
  const list = $('sessions-list');
  list.textContent = '';

  if (sessions.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No connected devices';
    list.appendChild(li);
    return;
  }

  for (const s of sessions) {
    const li = document.createElement('li');
    li.className = 'session-item';

    const label = document.createElement('span');
    label.textContent = `${s.deviceName} — ${s.ip}`;

    const kickBtn = document.createElement('button');
    kickBtn.className = 'btn-link danger';
    kickBtn.textContent = 'Kick';
    kickBtn.addEventListener('click', () => {
      window.beamdrop.revokeSession(s.id);
      showToast(`Disconnected ${s.deviceName}`);
    });

    li.appendChild(label);
    li.appendChild(kickBtn);
    list.appendChild(li);
  }
}

function renderTrusted(trusted) {
  const wrap = $('trusted-wrap');
  const list = $('trusted-list');
  $('trusted-count').textContent = String(trusted.length);
  list.textContent = '';
  if (trusted.length === 0) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  for (const td of trusted) {
    const li = document.createElement('li');
    li.className = 'session-item';

    const label = document.createElement('span');
    label.textContent = td.deviceName;

    const forgetBtn = document.createElement('button');
    forgetBtn.className = 'btn-link danger';
    forgetBtn.textContent = 'Forget';
    forgetBtn.addEventListener('click', () => {
      window.beamdrop.revokeTrusted(td.id);
      showToast(`Forgot ${td.deviceName}`);
    });

    li.appendChild(label);
    li.appendChild(forgetBtn);
    list.appendChild(li);
  }
}

function renderClipboard(entries) {
  const list = $('clip-list');
  list.textContent = '';
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'item-row';

    const meta = document.createElement('div');
    meta.className = 'item-meta';

    const textEl = document.createElement('div');
    textEl.className = 'item-name';
    textEl.textContent = entry.text;

    const subEl = document.createElement('div');
    subEl.className = 'item-sub';
    subEl.textContent = `From ${entry.from} · ${new Date(entry.timestamp).toLocaleTimeString()}`;

    meta.appendChild(textEl);
    meta.appendChild(subEl);

    const btns = document.createElement('div');
    btns.className = 'btn-row';

    if (isSafeHttpUrl(entry.text)) {
      const openLink = document.createElement('a');
      openLink.className = 'btn btn-sm';
      openLink.href = entry.text.trim();
      openLink.target = '_blank';
      openLink.rel = 'noopener noreferrer';
      openLink.textContent = 'Open';
      btns.appendChild(openLink);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-sm';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(entry.text);
      showToast('Copied to clipboard');
    });
    btns.appendChild(copyBtn);

    row.appendChild(meta);
    row.appendChild(btns);
    list.appendChild(row);
  }
}

function renderApprovalBanner() {
  const banner = $('approval-banner');
  banner.textContent = '';
  if (pendingChallenges.length === 0) {
    banner.classList.add('hidden');
    return;
  }

  const ch = pendingChallenges[0];
  banner.classList.remove('hidden');

  const msg = document.createElement('span');
  msg.textContent = `Device "${ch.deviceName}" (${ch.ip}) requests access.`;

  const actions = document.createElement('div');
  actions.className = 'btn-row';

  const allowBtn = document.createElement('button');
  allowBtn.className = 'btn btn-primary btn-sm';
  allowBtn.textContent = 'Allow';
  allowBtn.addEventListener('click', async () => {
    await window.beamdrop.approveChallenge(ch.id, true, false);
    pendingChallenges.shift();
    renderApprovalBanner();
    showToast(`${ch.deviceName} connected`);
  });

  const trustBtn = document.createElement('button');
  trustBtn.className = 'btn btn-sm';
  trustBtn.textContent = 'Allow & Trust';
  trustBtn.addEventListener('click', async () => {
    await window.beamdrop.approveChallenge(ch.id, true, true);
    pendingChallenges.shift();
    renderApprovalBanner();
    showToast(`${ch.deviceName} trusted`);
  });

  const blockBtn = document.createElement('button');
  blockBtn.className = 'btn btn-sm danger';
  blockBtn.textContent = 'Block';
  blockBtn.addEventListener('click', async () => {
    await window.beamdrop.approveChallenge(ch.id, false, false);
    pendingChallenges.shift();
    renderApprovalBanner();
  });

  actions.appendChild(allowBtn);
  actions.appendChild(trustBtn);
  actions.appendChild(blockBtn);
  banner.appendChild(msg);
  banner.appendChild(actions);
}

// Custom Window Controls
$('win-min').addEventListener('click', () => window.beamdrop.minimizeWindow());
$('win-max').addEventListener('click', () => window.beamdrop.maximizeWindow());
$('win-close').addEventListener('click', () => window.beamdrop.closeWindow());

// Tabs
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// Filter pills & search
document.querySelectorAll('.pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    activeFilter = pill.dataset.filter;
    renderFiles(allFiles);
  });
});

$('file-search').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderFiles(allFiles);
});

// Controls
$('iface-select').addEventListener('change', (e) => window.beamdrop.selectInterface(e.target.value));
$('btn-refresh-net').addEventListener('click', async () => {
  await window.beamdrop.refreshNetwork();
  showToast('Network adapters refreshed');
});
$('btn-copy-url').addEventListener('click', () => {
  navigator.clipboard.writeText($('server-url').textContent);
  showToast('Server URL copied');
});
$('btn-copy-invite').addEventListener('click', () => {
  if (!currentQrUrl) return;
  navigator.clipboard.writeText(currentQrUrl);
  showToast('Instant connect link copied');
});
$('btn-regen-pin').addEventListener('click', () => {
  window.beamdrop.regeneratePin();
  showToast('New PIN generated');
});
$('chk-approval').addEventListener('change', (e) => window.beamdrop.setRequireApproval(e.target.checked));
$('btn-change-save').addEventListener('click', () => window.beamdrop.pickSaveDir());
$('btn-open-save').addEventListener('click', () => window.beamdrop.openSaveDir());
$('btn-revoke').addEventListener('click', () => {
  window.beamdrop.revokeSessions();
  showToast('All device sessions revoked');
});
$('btn-pick-files').addEventListener('click', () => window.beamdrop.pickFiles());
$('btn-pick-folder').addEventListener('click', () => window.beamdrop.pickFolder());
$('btn-clear-files').addEventListener('click', async () => {
  await window.beamdrop.clearSharedItems();
  showToast('Shared list cleared');
});
$('btn-paste-send').addEventListener('click', async () => {
  const entry = await window.beamdrop.pasteAndSendClipboard();
  if (entry) showToast('OS clipboard sent to phone');
  else showToast('Clipboard is empty');
});
const sendClipboardText = async () => {
  const val = $('clip-input').value.trim();
  if (!val) return;
  await window.beamdrop.sendClipboard(val);
  $('clip-input').value = '';
  showToast('Sent to phone');
};
$('btn-send-clip').addEventListener('click', sendClipboardText);
$('clip-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendClipboardText();
  }
});

// Full-window Drag & Drop
const dropZone = $('drop-zone');
document.body.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('window-drag');
  dropZone.classList.add('drag-over');
});
document.body.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) {
    document.body.classList.remove('window-drag');
    dropZone.classList.remove('drag-over');
  }
});
document.body.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('window-drag');
  dropZone.classList.remove('drag-over');
  const paths = [];
  for (const file of e.dataTransfer.files) {
    const p = window.beamdrop.getDroppedFilePath(file);
    if (p) paths.push(p);
  }
  if (paths.length > 0) {
    await window.beamdrop.addPaths(paths);
    showToast(`Added ${paths.length} item(s)`);
  }
});

// Modals, Network Tools & Keyboard Shortcuts
$('qr-img').addEventListener('click', () => $('qr-modal').classList.remove('hidden'));
$('btn-close-qr').addEventListener('click', () => $('qr-modal').classList.add('hidden'));

$('btn-open-settings').addEventListener('click', () => {
  if (currentState && currentState.settings) {
    const s = currentState.settings;
    $('set-port').value = String(s.port);
    $('set-mdns').checked = Boolean(s.enableMdns);
    $('set-https').checked = Boolean(s.useHttps);
    $('set-login').checked = Boolean(s.launchAtLogin);
    $('set-remux').checked = Boolean(s.ffmpegRemux);
    $('set-remux').disabled = !currentState.ffmpegAvailable;
  }
  $('settings-modal').classList.remove('hidden');
});
$('btn-close-settings').addEventListener('click', () => $('settings-modal').classList.add('hidden'));

$('btn-save-settings').addEventListener('click', async () => {
  const port = Number($('set-port').value);
  await window.beamdrop.updateSettings({
    port,
    enableMdns: $('set-mdns').checked,
    useHttps: $('set-https').checked,
    launchAtLogin: $('set-login').checked,
    ffmpegRemux: $('set-remux').checked
  });
  $('settings-modal').classList.add('hidden');
  showToast('Settings saved');
});

$('btn-copy-diag').addEventListener('click', async () => {
  const report = await window.beamdrop.getDiagnostics();
  navigator.clipboard.writeText(report);
  showToast('Diagnostics copied');
});

$('btn-fix-fw').addEventListener('click', async () => {
  const ok = await window.beamdrop.fixFirewall();
  showToast(ok ? 'Firewall rule added' : 'Firewall prompt cancelled');
});

$('btn-open-hotspot').addEventListener('click', () => window.beamdrop.openHotspot());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('qr-modal').classList.add('hidden');
    $('settings-modal').classList.add('hidden');
  } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    window.beamdrop.pickFolder();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    window.beamdrop.pickFiles();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('file-search').focus();
  }
});

// Events
window.beamdrop.onStateChanged(renderState);
window.beamdrop.onFilesChanged(renderFiles);
window.beamdrop.onSessionsChanged(renderSessions);
window.beamdrop.onClipboardChanged(renderClipboard);
window.beamdrop.onTransferUpdate((t) => {
  transfers.set(t.id, t);
  renderTransfers();
});
window.beamdrop.onAuthChallenge((ch) => {
  pendingChallenges.push(ch);
  renderApprovalBanner();
});

window.beamdrop.getState().then(renderState);
