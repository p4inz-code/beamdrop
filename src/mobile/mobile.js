const $ = (id) => document.getElementById(id);

const CHUNK_SIZE = 8 * 1024 * 1024;
const PAGE_SIZE = 50;
let authToken = localStorage.getItem('bd_token') || '';
let trustKey = localStorage.getItem('bd_trust_key') || '';
let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let isLoggedIn = false;
let filesCache = [];
let visibleLimit = PAGE_SIZE;
let activeFilter = 'all';
let searchQuery = '';
let wakeLock = null;
let toastTimer = null;
const selectedIds = new Set();
const activeUploads = new Map();

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

function isEmbeddedWebView() {
  const ua = navigator.userAgent || '';
  return /\b(FBAN|FBAV|Instagram|Snapchat|Line|MicroMessenger|GSA\/|wv)\b/i.test(ua);
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
  } else {
    path.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z');
  }
  svg.appendChild(path);
  return svg;
}

function copyTextFallback(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  return legacyCopy(text);
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    // ignore
  }
  document.body.removeChild(ta);
}

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

async function acquireWakeLock() {
  if (!wakeLock && 'wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // ignore
    }
  }
}

function releaseWakeLockIfIdle() {
  const hasActive = Array.from(activeUploads.values()).some((u) => u.percent < 100 && !u.cancelled);
  if (!hasActive && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i >= 2 ? 2 : 0)} ${units[i]}`;
}

function detectDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android Phone';
  return 'Mobile Browser';
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    logout();
    throw new Error('Session expired');
  }
  return res;
}

function showApp() {
  isLoggedIn = true;
  $('auth-screen').classList.add('hidden');
  $('app-screen').classList.remove('hidden');
  connectWebSocket();
  loadInitialData();
}

function logout() {
  isLoggedIn = false;
  authToken = '';
  localStorage.removeItem('bd_token');
  clearTimeout(reconnectTimer);
  if (ws) ws.close();
  $('app-screen').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
}

async function loadInitialData() {
  try {
    const [filesRes, clipRes] = await Promise.all([
      apiFetch('/api/files'),
      apiFetch('/api/clipboard')
    ]);
    const filesData = await filesRes.json();
    const clipData = await clipRes.json();
    renderFiles(filesData.files || []);
    renderClipboard(clipData.entries || []);
  } catch {
    // handled by apiFetch
  }
}

function setConnectionUi(connected) {
  const dot = $('conn-dot');
  const label = $('conn-label');
  if (connected) {
    dot.classList.remove('reconnecting');
    label.textContent = 'Connected';
  } else {
    dot.classList.add('reconnecting');
    label.textContent = 'Reconnecting...';
  }
}

function connectWebSocket() {
  if (!isLoggedIn || !authToken) return;
  if (ws) ws.close();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(authToken)}`);

  ws.onopen = () => {
    reconnectDelay = 1000;
    setConnectionUi(true);
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'init') {
      renderFiles(msg.payload.files || []);
      renderClipboard(msg.payload.clipboard || []);
    } else if (msg.type === 'files:updated') {
      renderFiles(msg.payload || []);
    } else if (msg.type === 'clipboard:updated') {
      renderClipboard(msg.payload || []);
    } else if (msg.type === 'session:revoked') {
      logout();
      $('auth-status').textContent = 'Disconnected by PC.';
    }
  };

  ws.onclose = () => {
    if (!isLoggedIn) return;
    setConnectionUi(false);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 1.5, 8000);
      connectWebSocket();
    }, reconnectDelay);
  };
}

// Pairing
async function submitPair({ pin = '', qrSecret = '', trust = '' }) {
  $('btn-pair').disabled = true;
  $('auth-status').textContent = trust ? 'Reconnecting trusted device...' : qrSecret ? 'Verifying QR code...' : 'Verifying PIN...';

  try {
    const res = await fetch('/api/auth/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, qrSecret, trustKey: trust, deviceName: detectDeviceName() })
    });
    const data = await res.json();
    if (!res.ok) {
      if (trust) {
        trustKey = '';
        localStorage.removeItem('bd_trust_key');
      }
      $('auth-status').textContent = trust ? 'Enter PIN to reconnect.' : (data.error || 'Pairing failed');
      $('btn-pair').disabled = false;
      return;
    }

    if (data.status === 'approved') {
      authToken = data.token;
      localStorage.setItem('bd_token', authToken);
      showApp();
      return;
    }

    $('auth-status').textContent = 'Waiting for PC approval...';
    const poll = setInterval(async () => {
      try {
        const stRes = await fetch(`/api/auth/status?challengeId=${encodeURIComponent(data.challengeId)}`);
        const stData = await stRes.json();
        if (stData.status === 'approved') {
          clearInterval(poll);
          authToken = stData.token;
          localStorage.setItem('bd_token', authToken);
          if (stData.trustKey) {
            trustKey = stData.trustKey;
            localStorage.setItem('bd_trust_key', trustKey);
          }
          showApp();
        } else if (stData.status === 'rejected') {
          clearInterval(poll);
          $('auth-status').textContent = 'Connection blocked by PC.';
          $('btn-pair').disabled = false;
        }
      } catch {
        clearInterval(poll);
        $('auth-status').textContent = 'Connection lost.';
        $('btn-pair').disabled = false;
      }
    }, 1000);
  } catch {
    $('auth-status').textContent = 'Network error.';
    $('btn-pair').disabled = false;
  }
}

const submitPinInput = () => {
  const pin = $('pin-input').value.trim();
  if (pin.length !== 4) {
    $('auth-status').textContent = 'Enter 4-digit PIN.';
    return;
  }
  submitPair({ pin });
};
$('btn-pair').addEventListener('click', submitPinInput);
$('pin-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitPinInput();
  }
});

$('btn-refresh').addEventListener('click', () => {
  loadInitialData();
  showToast('Refreshed');
});

// Filter pills & search
document.querySelectorAll('.pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    activeFilter = pill.dataset.filter;
    renderFiles(filesCache);
  });
});

$('file-search').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderFiles(filesCache);
});

function renderFiles(files) {
  filesCache = files;
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
    empty.className = 'muted';
    empty.style.textAlign = 'center';
    empty.style.padding = '32px 12px';
    empty.textContent = files.length === 0 ? 'No files shared from PC yet.' : 'No files match this filter.';
    list.appendChild(empty);
    return;
  }

  const slice = filtered.slice(0, visibleLimit);
  for (const file of slice) {
    const card = document.createElement('div');
    card.className = 'card-row';

    const top = document.createElement('div');
    top.className = 'row-top';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'custom-chk';
    chk.checked = selectedIds.has(file.id);
    chk.addEventListener('change', () => {
      if (chk.checked) selectedIds.add(file.id);
      else selectedIds.delete(file.id);
      updateBatchBar();
    });
    top.appendChild(chk);

    if (!file.isDirectory && file.mimeType.startsWith('image/')) {
      const thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.loading = 'lazy';
      thumb.src = `/api/files/${encodeURIComponent(file.id)}/stream?token=${encodeURIComponent(authToken)}`;
      thumb.alt = file.name;
      thumb.addEventListener('click', () => openImageModal(file));
      top.appendChild(thumb);
    } else {
      const kind = file.isDirectory ? 'folder' : file.mimeType.startsWith('video/') ? 'video' : 'file';
      top.appendChild(createSvgIcon(kind));
    }

    const info = document.createElement('div');
    info.className = 'row-info';

    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = file.name;

    const sub = document.createElement('div');
    sub.className = 'row-sub';
    sub.textContent = file.isDirectory ? 'Folder (.zip)' : formatBytes(file.size);

    info.appendChild(title);
    info.appendChild(sub);
    top.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'row-actions';

    if (!file.isDirectory && file.mimeType.startsWith('video/')) {
      const playBtn = document.createElement('button');
      playBtn.className = 'btn btn-primary btn-sm';
      playBtn.textContent = 'Stream Video';
      playBtn.addEventListener('click', () => openVideoModal(file));
      actions.appendChild(playBtn);
    } else if (!file.isDirectory && file.mimeType.startsWith('image/')) {
      const previewBtn = document.createElement('button');
      previewBtn.className = 'btn btn-primary btn-sm';
      previewBtn.textContent = 'Preview';
      previewBtn.addEventListener('click', () => openImageModal(file));
      actions.appendChild(previewBtn);
    }

    const dlLink = document.createElement('a');
    dlLink.className = 'btn btn-sm';
    dlLink.href = `/api/files/${encodeURIComponent(file.id)}/download?token=${encodeURIComponent(authToken)}`;
    dlLink.setAttribute('download', file.isDirectory ? `${file.name}.zip` : file.name);
    dlLink.textContent = file.isDirectory ? 'Download .ZIP' : 'Download';
    actions.appendChild(dlLink);

    card.appendChild(top);
    card.appendChild(actions);
    list.appendChild(card);
  }
  if (filtered.length > visibleLimit) {
    const moreBtn = document.createElement('button');
    moreBtn.className = 'btn btn-sm';
    moreBtn.textContent = `Show More (${filtered.length - visibleLimit} remaining)`;
    moreBtn.addEventListener('click', () => {
      visibleLimit += PAGE_SIZE;
      renderFiles(filesCache);
    });
    list.appendChild(moreBtn);
  }
  updateBatchBar();
}

function updateBatchBar() {
  const bar = $('batch-bar');
  if (selectedIds.size === 0) {
    bar.classList.add('hidden');
  } else {
    bar.classList.remove('hidden');
    $('selected-count').textContent = `${selectedIds.size} selected`;
  }
}

$('btn-clear-sel').addEventListener('click', () => {
  selectedIds.clear();
  renderFiles(filesCache);
});

$('btn-download-zip').addEventListener('click', () => {
  if (selectedIds.size === 0) return;
  const ids = Array.from(selectedIds).join(',');
  location.href = `/api/zip?ids=${encodeURIComponent(ids)}&token=${encodeURIComponent(authToken)}`;
});

// Video & Image Modals
function openVideoModal(file) {
  $('video-title').textContent = file.name;
  $('video-player').src = `/api/files/${encodeURIComponent(file.id)}/stream?token=${encodeURIComponent(authToken)}`;
  $('video-modal').classList.remove('hidden');
}

$('btn-close-video').addEventListener('click', () => {
  const player = $('video-player');
  player.pause();
  player.removeAttribute('src');
  player.load();
  $('video-modal').classList.add('hidden');
});

function openImageModal(file) {
  $('image-title').textContent = file.name;
  $('image-preview').src = `/api/files/${encodeURIComponent(file.id)}/stream?token=${encodeURIComponent(authToken)}`;
  $('image-modal').classList.remove('hidden');
}

$('btn-close-image').addEventListener('click', () => {
  $('image-preview').removeAttribute('src');
  $('image-modal').classList.add('hidden');
});

// Chunked Upload Engine (3x parallel + resume)
$('btn-send-files').addEventListener('click', () => $('file-picker').click());
$('file-picker').addEventListener('change', (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for (const file of files) {
    startChunkedUpload(file);
  }
});

async function startChunkedUpload(file) {
  const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
  const state = {
    localId,
    uploadId: null,
    file,
    paused: false,
    cancelled: false,
    percent: 0,
    speedBps: 0,
    status: 'Initializing...'
  };
  activeUploads.set(localId, state);
  renderUploads();
  acquireWakeLock();

  try {
    const initRes = await apiFetch('/api/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        totalSize: file.size,
        chunkSize: CHUNK_SIZE,
        fingerprint
      })
    });
    const initData = await initRes.json();
    if (!initRes.ok) throw new Error(initData.error || 'Init failed');

    state.uploadId = initData.uploadId;
    const chunkSize = initData.chunkSize;
    const totalChunks = initData.totalChunks;
    const completedSet = new Set(initData.receivedChunks || []);
    const startedAt = Date.now();
    let uploadedBytes = completedSet.size * chunkSize;
    const pendingIndices = [];
    for (let idx = 0; idx < totalChunks; idx++) {
      if (!completedSet.has(idx)) pendingIndices.push(idx);
    }

    let cursor = 0;
    const CONCURRENCY = Math.min(3, Math.max(1, pendingIndices.length));

    const worker = async () => {
      while (cursor < pendingIndices.length) {
        while (state.paused && !state.cancelled) {
          state.status = 'Paused';
          renderUploads();
          await new Promise((r) => setTimeout(r, 300));
        }
        if (state.cancelled) return;

        const pos = cursor++;
        if (pos >= pendingIndices.length) return;
        const idx = pendingIndices[pos];

        const start = idx * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const blob = file.slice(start, end);

        let attempt = 0;
        while (attempt < 4) {
          try {
            const chunkRes = await apiFetch(`/api/upload/chunk/${state.uploadId}/${idx}`, {
              method: 'PUT',
              body: blob
            });
            if (!chunkRes.ok) throw new Error('Chunk failed');
            break;
          } catch (err) {
            attempt += 1;
            if (attempt >= 4) throw err;
            state.status = `Retrying chunk (${attempt}/3)...`;
            renderUploads();
            await new Promise((r) => setTimeout(r, 600 * attempt));
          }
        }

        uploadedBytes = Math.min(file.size, uploadedBytes + (end - start));
        const elapsed = Math.max(0.1, (Date.now() - startedAt) / 1000);
        state.speedBps = uploadedBytes / elapsed;
        state.percent = Math.round((uploadedBytes / file.size) * 100);
        state.status = `${state.percent}% · ${(state.speedBps / (1024 * 1024)).toFixed(1)} MB/s`;
        renderUploads();
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    if (state.cancelled) return;

    const compRes = await apiFetch(`/api/upload/complete/${state.uploadId}`, { method: 'POST' });
    if (!compRes.ok) throw new Error('Finalize failed');
    state.status = 'Completed';
    state.percent = 100;
    renderUploads();
    showToast(`Sent ${file.name}`);
  } catch (err) {
    state.status = `Error: ${err.message}`;
    renderUploads();
  } finally {
    releaseWakeLockIfIdle();
  }
}

function renderUploads() {
  const sec = $('uploads-section');
  const list = $('uploads-list');
  const badge = $('uploads-badge');
  const items = Array.from(activeUploads.values());
  const activeCount = items.filter((u) => u.percent < 100 && !u.cancelled).length;

  if (activeCount > 0) {
    badge.textContent = String(activeCount);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  if (items.length === 0) {
    sec.classList.add('hidden');
    return;
  }
  sec.classList.remove('hidden');
  list.textContent = '';

  for (const u of items) {
    const card = document.createElement('div');
    card.className = 'card-row';

    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = u.file.name;

    const sub = document.createElement('div');
    sub.className = 'row-sub';
    sub.textContent = `${formatBytes(u.file.size)} · ${u.status}`;

    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = `${u.percent}%`;
    bar.appendChild(fill);

    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(bar);

    if (u.percent < 100 && !u.cancelled) {
      const actions = document.createElement('div');
      actions.className = 'row-actions';

      const pauseBtn = document.createElement('button');
      pauseBtn.className = 'btn btn-sm';
      pauseBtn.textContent = u.paused ? 'Resume' : 'Pause';
      pauseBtn.addEventListener('click', () => {
        u.paused = !u.paused;
        renderUploads();
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-sm';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', async () => {
        u.cancelled = true;
        if (u.uploadId) {
          await apiFetch(`/api/upload/${u.uploadId}`, { method: 'DELETE' }).catch(() => {});
        }
        activeUploads.delete(u.localId);
        renderUploads();
        releaseWakeLockIfIdle();
      });

      actions.appendChild(pauseBtn);
      actions.appendChild(cancelBtn);
      card.appendChild(actions);
    }

    list.appendChild(card);
  }
}

// Clipboard
function renderClipboard(entries) {
  const list = $('clip-list');
  list.textContent = '';
  for (const entry of entries) {
    const card = document.createElement('div');
    card.className = 'card-row';

    const text = document.createElement('div');
    text.className = 'row-title';
    text.style.whiteSpace = 'pre-wrap';
    text.textContent = entry.text;

    const sub = document.createElement('div');
    sub.className = 'row-sub';
    sub.textContent = `From ${entry.from}`;

    const actions = document.createElement('div');
    actions.className = 'row-actions';

    if (isSafeHttpUrl(entry.text)) {
      const openLink = document.createElement('a');
      openLink.className = 'btn btn-primary btn-sm';
      openLink.href = entry.text.trim();
      openLink.target = '_blank';
      openLink.rel = 'noopener noreferrer';
      openLink.textContent = 'Open Link';
      actions.appendChild(openLink);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-sm';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      copyTextFallback(entry.text);
      showToast('Copied to clipboard');
    });
    actions.appendChild(copyBtn);

    card.appendChild(text);
    card.appendChild(sub);
    card.appendChild(actions);
    list.appendChild(card);
  }
}

const sendMobileClip = async () => {
  const text = $('clip-input').value.trim();
  if (!text) return;
  await apiFetch('/api/clipboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  $('clip-input').value = '';
  showToast('Sent to PC');
};
$('btn-send-clip').addEventListener('click', sendMobileClip);
$('clip-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMobileClip();
  }
});

// Bottom Navigation Tabs
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

$('btn-disconnect').addEventListener('click', logout);

if (isEmbeddedWebView()) {
  $('webview-banner').classList.remove('hidden');
}
$('btn-dismiss-wv').addEventListener('click', () => $('webview-banner').classList.add('hidden'));

const urlParams = new URLSearchParams(location.search);
const qrSecretParam = urlParams.get('q');
if (qrSecretParam) {
  history.replaceState({}, '', '/');
}

const fallbackConnect = () => {
  if (qrSecretParam) submitPair({ qrSecret: qrSecretParam });
  else if (trustKey) submitPair({ trust: trustKey });
};

if (authToken) {
  apiFetch('/api/auth/me')
    .then((r) => (r.ok ? showApp() : fallbackConnect()))
    .catch(() => fallbackConnect());
} else {
  fallbackConnect();
}
