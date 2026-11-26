const $ = (id) => document.getElementById(id);

const transfers = new Map();
const pendingChallenges = [];
let allFiles = [];
let activeFilter = 'all';
let searchQuery = '';
let toastTimer = null;

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
  $('qr-img').src = state.qrDataUrl;
  $('server-url').textContent = state.url;
  $('pin-code').textContent = state.pin;
  $('chk-approval').checked = state.requireApproval;
  $('save-dir-path').textContent = state.saveDir;

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

  for (const file of filtered) {
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
    li.textContent = `${s.deviceName} — ${s.ip}`;
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

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-sm';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(entry.text);
      showToast('Copied to clipboard');
    });

    row.appendChild(meta);
    row.appendChild(copyBtn);
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
    await window.beamdrop.approveChallenge(ch.id, true);
    pendingChallenges.shift();
    renderApprovalBanner();
    showToast(`${ch.deviceName} connected`);
  });

  const blockBtn = document.createElement('button');
  blockBtn.className = 'btn btn-sm danger';
  blockBtn.textContent = 'Block';
  blockBtn.addEventListener('click', async () => {
    await window.beamdrop.approveChallenge(ch.id, false);
    pendingChallenges.shift();
    renderApprovalBanner();
  });

  actions.appendChild(allowBtn);
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
$('btn-copy-url').addEventListener('click', () => {
  navigator.clipboard.writeText($('server-url').textContent);
  showToast('Server URL copied');
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
$('btn-send-clip').addEventListener('click', async () => {
  const val = $('clip-input').value.trim();
  if (!val) return;
  await window.beamdrop.sendClipboard(val);
  $('clip-input').value = '';
  showToast('Sent to phone');
});

// Drag & Drop
const dropZone = $('drop-zone');
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
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
