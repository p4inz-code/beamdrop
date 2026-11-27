const $ = (id) => document.getElementById(id);

const CHUNK_SIZE = 8 * 1024 * 1024;
const PAGE_SIZE = 50;
let authToken = localStorage.getItem('bd_token') || '';
let trustKey = localStorage.getItem('bd_trust_key') || '';
let currentTheme = localStorage.getItem('bd_theme') || 'dark';
let ws = null;
let reconnectTimer = null;
let syncTimer = null;
let reconnectDelay = 1000;
let isLoggedIn = false;
let filesCache = [];
let ffmpegAvailable = false;
let visibleLimit = PAGE_SIZE;
let activeFilter = 'all';
let searchQuery = '';
let wakeLock = null;
let toastTimer = null;
let lastFilesSig = '';
let lastClipSig = '';
const selectedIds = new Set();
const activeUploads = new Map();

document.documentElement.setAttribute('data-theme', currentTheme);

// Protect sensitive auth & session UI from casual right-click / long-press inspect
$('auth-screen').addEventListener('contextmenu', (e) => e.preventDefault());
document.querySelector('.topbar').addEventListener('contextmenu', (e) => e.preventDefault());
document.querySelector('.bottom-nav').addEventListener('contextmenu', (e) => e.preventDefault());

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
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'item-icon');

  const add = (tag, attrs) => {
    const el = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.appendChild(el);
  };

  if (kind === 'folder') {
    add('path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' });
  } else if (kind === 'video') {
    add('path', { d: 'm16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5' });
    add('rect', { x: 2, y: 6, width: 14, height: 12, rx: 2 });
  } else if (kind === 'audio') {
    add('path', { d: 'M21 16V3a1 1 0 0 0-1.28-.96l-10 2.917a1 1 0 0 0-.72.96V19' });
    add('circle', { cx: 18, cy: 16, r: 3 });
    add('circle', { cx: 6, cy: 19, r: 3 });
  } else {
    add('path', { d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' });
    add('path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' });
    add('path', { d: 'M10 9H8' });
    add('path', { d: 'M16 13H8' });
    add('path', { d: 'M16 17H8' });
  }
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
  const ua = navigator.userAgent || '';
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Firefox\//i.test(ua)
      ? 'Firefox'
      : /Chrome\//i.test(ua)
        ? 'Chrome'
        : /Safari\//i.test(ua)
          ? 'Safari'
          : 'Browser';

  if (/iPhone/i.test(ua)) return `iPhone (${browser})`;
  if (/iPad/i.test(ua)) return `iPad (${browser})`;
  if (/Android/i.test(ua)) return `Android Phone (${browser})`;
  if (/Windows/i.test(ua)) return `Windows PC (${browser})`;
  if (/Macintosh|Mac OS X/i.test(ua)) return `Mac (${browser})`;
  if (/Linux/i.test(ua)) return `Linux PC (${browser})`;
  return `Web (${browser})`;
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
  clearInterval(syncTimer);
  syncTimer = setInterval(() => {
    if (isLoggedIn) loadInitialData(true);
  }, 5000);
}

function logout() {
  isLoggedIn = false;
  authToken = '';
  localStorage.removeItem('bd_token');
  clearTimeout(reconnectTimer);
  clearInterval(syncTimer);
  if (ws) ws.close();
  $('app-screen').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
}

async function loadInitialData(silent = false) {
  try {
    const [healthRes, filesRes, clipRes] = await Promise.all([
      fetch('/api/health').catch(() => null),
      apiFetch('/api/files'),
      apiFetch('/api/clipboard')
    ]);
    if (healthRes && healthRes.ok) {
      const h = await healthRes.json();
      ffmpegAvailable = Boolean(h.ffmpegAvailable);
    }
    const filesData = await filesRes.json();
    const clipData = await clipRes.json();
    renderFiles(filesData.files || []);
    renderClipboard(clipData.entries || []);
  } catch {
    if (!silent) showToast('Could not reach PC');
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

// 4-Digit Segmented PIN Input
const pinDigits = Array.from(document.querySelectorAll('.pin-digit'));
function getPinValue() {
  return pinDigits.map((el) => el.value).join('');
}

pinDigits.forEach((input, idx) => {
  input.addEventListener('input', (e) => {
    const val = e.target.value.replace(/\D/g, '');
    e.target.value = val.slice(0, 1);
    if (e.target.value && idx < pinDigits.length - 1) {
      pinDigits[idx + 1].focus();
    }
    if (getPinValue().length === 4) {
      submitPinInput();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !e.target.value && idx > 0) {
      pinDigits[idx - 1].focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submitPinInput();
    }
  });

  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 4);
    pasted.split('').forEach((ch, i) => {
      if (pinDigits[i]) pinDigits[i].value = ch;
    });
    if (pasted.length === 4) submitPinInput();
  });
});

// Pairing
async function submitPair({ pin = '', qrSecret = '', trust = '' }) {
  $('btn-pair').disabled = true;
  $('auth-status').textContent = trust ? 'Reconnecting...' : qrSecret ? 'Connecting via QR...' : 'Checking PIN...';

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
      $('auth-status').textContent = trust ? 'Enter PIN to reconnect.' : (data.error || 'Could not connect');
      $('btn-pair').disabled = false;
      return;
    }

    if (data.status === 'approved') {
      authToken = data.token;
      localStorage.setItem('bd_token', authToken);
      showApp();
      return;
    }

    $('auth-status').textContent = 'Check your PC screen and click Allow...';
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
          $('auth-status').textContent = 'Connection blocked on PC.';
          $('btn-pair').disabled = false;
        }
      } catch {
        clearInterval(poll);
        $('auth-status').textContent = 'Connection lost.';
        $('btn-pair').disabled = false;
      }
    }, 1000);
  } catch {
    $('auth-status').textContent = 'Could not reach PC. Check Wi-Fi.';
    $('btn-pair').disabled = false;
  }
}

const submitPinInput = () => {
  const pin = getPinValue();
  if (pin.length !== 4) {
    $('auth-status').textContent = 'Enter all 4 digits.';
    return;
  }
  submitPair({ pin });
};
$('btn-pair').addEventListener('click', submitPinInput);

$('btn-theme').addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('bd_theme', currentTheme);
  document.documentElement.setAttribute('data-theme', currentTheme);
});

$('btn-refresh').addEventListener('click', async () => {
  await loadInitialData();
  showToast('Up to date');
});

// Filter pills & custom search clear
document.querySelectorAll('.pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    activeFilter = pill.dataset.filter;
    renderFiles(filesCache, true);
  });
});

$('file-search').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  $('btn-clear-search').classList.toggle('hidden', !searchQuery);
  renderFiles(filesCache, true);
});
$('btn-clear-search').addEventListener('click', () => {
  $('file-search').value = '';
  searchQuery = '';
  $('btn-clear-search').classList.add('hidden');
  renderFiles(filesCache, true);
});

const TEXT_EXT_RE = /\.(txt|md|log|json|csv|ya?ml|xml|js|mjs|cjs|ts|py|css|html?|sh|ps1|ini|conf|env)$/i;

function getFormatLabel(file) {
  if (file.isDirectory) return 'FOLDER';
  const dot = file.name.lastIndexOf('.');
  if (dot > 0 && dot < file.name.length - 1) {
    return file.name.slice(dot + 1).toUpperCase().slice(0, 6);
  }
  return 'FILE';
}

function renderFiles(files, force = false) {
  const sig = JSON.stringify(files);
  if (!force && sig === lastFilesSig) return; // zero-jitter refresh
  lastFilesSig = sig;
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
    empty.className = 'mobile-empty-card';
    empty.appendChild(createSvgIcon(files.length === 0 ? 'folder' : 'file'));

    const emptyTitle = document.createElement('div');
    emptyTitle.className = 'mobile-empty-title';
    emptyTitle.textContent = files.length === 0 ? 'No files shared from PC yet' : 'No files match this filter';
    empty.appendChild(emptyTitle);

    const emptySub = document.createElement('div');
    emptySub.className = 'mobile-empty-sub';
    emptySub.textContent = files.length === 0
      ? 'Drop files onto BeamDrop on your PC, or tap below to send files from your phone.'
      : 'Try clearing the search box or switching the category filter.';
    empty.appendChild(emptySub);

    if (files.length === 0) {
      const sendShortcut = document.createElement('button');
      sendShortcut.type = 'button';
      sendShortcut.className = 'btn btn-primary btn-sm';
      sendShortcut.textContent = 'Send Files to PC';
      sendShortcut.addEventListener('click', () => {
        const sendNav = document.querySelector('.nav-btn[data-tab="send"]');
        if (sendNav) sendNav.click();
      });
      empty.appendChild(sendShortcut);
    }

    list.appendChild(empty);
    updateBatchBar();
    return;
  }

  const slice = filtered.slice(0, visibleLimit);
  for (const file of slice) {
    const card = document.createElement('div');
    card.className = 'media-card';

    const isVideo = !file.isDirectory && file.mimeType.startsWith('video/');
    const isImage = !file.isDirectory && file.mimeType.startsWith('image/');
    const isAudio = !file.isDirectory && file.mimeType.startsWith('audio/');
    const isText = !file.isDirectory && (file.mimeType.startsWith('text/') || file.mimeType === 'application/json' || TEXT_EXT_RE.test(file.name));
    const isNonNative = isVideo && /\.(mkv|avi|flv|ts)$/i.test(file.name);
    const streamUrl = `/api/files/${encodeURIComponent(file.id)}/stream?token=${encodeURIComponent(authToken)}`;
    const downloadUrl = `/api/files/${encodeURIComponent(file.id)}/download?token=${encodeURIComponent(authToken)}`;

    const banner = document.createElement('div');
    banner.className = 'media-banner';

    const chkWrap = document.createElement('label');
    chkWrap.className = 'media-chk-wrap';
    chkWrap.addEventListener('click', (e) => e.stopPropagation());
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'custom-chk';
    chk.checked = selectedIds.has(file.id);
    chk.addEventListener('change', () => {
      if (chk.checked) selectedIds.add(file.id);
      else selectedIds.delete(file.id);
      updateBatchBar();
    });
    chkWrap.appendChild(chk);
    banner.appendChild(chkWrap);

    const fmtPill = document.createElement('span');
    fmtPill.className = 'media-format-pill';
    fmtPill.textContent = getFormatLabel(file);
    banner.appendChild(fmtPill);

    if (isImage) {
      const thumb = document.createElement('img');
      thumb.loading = 'lazy';
      thumb.src = streamUrl;
      thumb.alt = file.name;
      banner.appendChild(thumb);
      banner.addEventListener('click', () => openImageModal(file));
    } else if (isVideo) {
      if (!isNonNative) {
        const vid = document.createElement('video');
        vid.preload = 'metadata';
        vid.muted = true;
        vid.playsInline = true;
        vid.src = `${streamUrl}#t=0.5`;
        banner.appendChild(vid);
      } else {
        const holder = document.createElement('div');
        holder.className = 'media-banner-placeholder';
        holder.appendChild(createSvgIcon('video'));
        banner.appendChild(holder);
      }
      const playBadge = document.createElement('div');
      playBadge.className = 'media-play-badge';
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'currentColor');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      const playPath = document.createElementNS(svgNS, 'path');
      playPath.setAttribute('d', 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z');
      svg.appendChild(playPath);
      playBadge.appendChild(svg);
      banner.appendChild(playBadge);
      banner.addEventListener('click', () => openVideoModal(file, isNonNative && ffmpegAvailable));
    } else if (isAudio) {
      const holder = document.createElement('div');
      holder.className = 'media-banner-placeholder';
      holder.appendChild(createSvgIcon('audio'));
      banner.appendChild(holder);
      banner.addEventListener('click', () => openAudioModal(file));
    } else if (isText) {
      const holder = document.createElement('div');
      holder.className = 'media-banner-placeholder';
      holder.appendChild(createSvgIcon('file'));
      banner.appendChild(holder);
      banner.addEventListener('click', () => openTextModal(file));
    } else {
      const holder = document.createElement('div');
      holder.className = 'media-banner-placeholder';
      holder.appendChild(createSvgIcon(file.isDirectory ? 'folder' : 'file'));
      banner.appendChild(holder);
      banner.addEventListener('click', () => {
        location.href = downloadUrl;
      });
    }

    const body = document.createElement('div');
    body.className = 'media-card-body';

    const info = document.createElement('div');
    info.className = 'row-info';

    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = file.name;

    const sub = document.createElement('div');
    sub.className = 'row-sub';
    sub.textContent = file.isDirectory
      ? 'FOLDER · .ZIP Archive'
      : `${getFormatLabel(file)} · ${formatBytes(file.size)}`;

    info.appendChild(title);
    info.appendChild(sub);

    const actions = document.createElement('div');
    actions.className = 'row-actions';

    if (isVideo) {
      const playBtn = document.createElement('button');
      playBtn.className = 'btn btn-primary btn-sm';
      playBtn.textContent = 'Play Video';
      playBtn.addEventListener('click', () => openVideoModal(file, isNonNative && ffmpegAvailable));
      actions.appendChild(playBtn);

      if (isNonNative) {
        const vlcLink = document.createElement('a');
        vlcLink.className = 'btn btn-sm';
        vlcLink.href = `vlc://${location.origin}${streamUrl}`;
        vlcLink.textContent = 'Open in VLC';
        actions.appendChild(vlcLink);
      }
    } else if (isImage) {
      const previewBtn = document.createElement('button');
      previewBtn.className = 'btn btn-primary btn-sm';
      previewBtn.textContent = 'View Image';
      previewBtn.addEventListener('click', () => openImageModal(file));
      actions.appendChild(previewBtn);
    } else if (isAudio) {
      const audioBtn = document.createElement('button');
      audioBtn.className = 'btn btn-primary btn-sm';
      audioBtn.textContent = 'Listen';
      audioBtn.addEventListener('click', () => openAudioModal(file));
      actions.appendChild(audioBtn);
    } else if (isText) {
      const readBtn = document.createElement('button');
      readBtn.className = 'btn btn-primary btn-sm';
      readBtn.textContent = 'Read';
      readBtn.addEventListener('click', () => openTextModal(file));
      actions.appendChild(readBtn);
    }

    const dlLink = document.createElement('a');
    dlLink.className = isVideo || isImage || isAudio || isText ? 'btn btn-sm' : 'btn btn-primary btn-sm';
    dlLink.href = downloadUrl;
    dlLink.setAttribute('download', file.isDirectory ? `${file.name}.zip` : file.name);
    dlLink.textContent = file.isDirectory ? 'Download .ZIP' : 'Download';
    actions.appendChild(dlLink);

    body.appendChild(info);
    body.appendChild(actions);

    card.appendChild(banner);
    card.appendChild(body);
    list.appendChild(card);
  }
  if (filtered.length > visibleLimit) {
    const moreBtn = document.createElement('button');
    moreBtn.className = 'btn btn-sm';
    moreBtn.textContent = `Show More (${filtered.length - visibleLimit} remaining)`;
    moreBtn.addEventListener('click', () => {
      visibleLimit += PAGE_SIZE;
      renderFiles(filesCache, true);
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

$('btn-select-all').addEventListener('click', () => {
  for (const f of filesCache) selectedIds.add(f.id);
  renderFiles(filesCache, true);
});

$('btn-clear-sel').addEventListener('click', () => {
  selectedIds.clear();
  renderFiles(filesCache, true);
});

$('btn-download-zip').addEventListener('click', () => {
  if (selectedIds.size === 0) return;
  const ids = Array.from(selectedIds).join(',');
  location.href = `/api/zip?ids=${encodeURIComponent(ids)}&token=${encodeURIComponent(authToken)}`;
});

// Video & Image Modals
function openVideoModal(file, useRemux = false) {
  $('video-title').textContent = file.name;
  const player = $('video-player');
  player.querySelectorAll('track').forEach((t) => t.remove());
  const ep = useRemux ? 'remux' : 'stream';
  player.src = `/api/files/${encodeURIComponent(file.id)}/${ep}?token=${encodeURIComponent(authToken)}`;
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.srclang = 'en';
  track.label = 'Subtitles';
  track.default = true;
  track.src = `/api/files/${encodeURIComponent(file.id)}/subtitles?token=${encodeURIComponent(authToken)}`;
  player.appendChild(track);
  $('video-modal').classList.remove('hidden');
}

$('btn-close-video').addEventListener('click', () => {
  const player = $('video-player');
  player.pause();
  player.querySelectorAll('track').forEach((t) => t.remove());
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

function openAudioModal(file) {
  $('audio-title').textContent = file.name;
  $('audio-player').src = `/api/files/${encodeURIComponent(file.id)}/stream?token=${encodeURIComponent(authToken)}`;
  $('audio-modal').classList.remove('hidden');
}

$('btn-close-audio').addEventListener('click', () => {
  const player = $('audio-player');
  player.pause();
  player.removeAttribute('src');
  player.load();
  $('audio-modal').classList.add('hidden');
});

async function openTextModal(file) {
  $('text-title').textContent = file.name;
  $('text-preview').textContent = 'Loading preview...';
  $('text-modal').classList.remove('hidden');
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(file.id)}/stream?token=${encodeURIComponent(authToken)}`, {
      headers: { Range: 'bytes=0-524287' }
    });
    const txt = await res.text();
    $('text-preview').textContent = file.size > 524288 ? `${txt}\n\n... (preview capped at 512 KB)` : txt;
  } catch {
    $('text-preview').textContent = 'Could not load text preview.';
  }
}

$('btn-close-text').addEventListener('click', () => {
  $('text-preview').textContent = '';
  $('text-modal').classList.add('hidden');
});

document.querySelectorAll('.modal').forEach((modalEl) => {
  modalEl.addEventListener('click', (e) => {
    if (e.target !== modalEl) return;
    if (modalEl.id === 'video-modal') $('btn-close-video').click();
    else if (modalEl.id === 'audio-modal') $('btn-close-audio').click();
    else if (modalEl.id === 'image-modal') $('btn-close-image').click();
    else if (modalEl.id === 'text-modal') $('btn-close-text').click();
  });
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
    status: 'Starting...'
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
    if (!initRes.ok) throw new Error(initData.error || 'Could not start upload');

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
    const CONCURRENCY = Math.min(4, Math.max(1, pendingIndices.length));

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
            if (!chunkRes.ok) throw new Error('Part failed');
            break;
          } catch (err) {
            attempt += 1;
            if (attempt >= 4) throw err;
            state.status = `Retrying (${attempt}/3)...`;
            renderUploads();
            await new Promise((r) => setTimeout(r, 600 * attempt));
          }
        }

        uploadedBytes = Math.min(file.size, uploadedBytes + (end - start));
        const elapsed = Math.max(0.1, (Date.now() - startedAt) / 1000);
        state.speedBps = uploadedBytes / elapsed;
        state.percent = file.size === 0 ? 100 : Math.round((uploadedBytes / file.size) * 100);
        state.status = `${state.percent}% · ${(state.speedBps / (1024 * 1024)).toFixed(1)} MB/s`;
        renderUploads();
      }
    };

    if (pendingIndices.length > 0) {
      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    }
    if (state.cancelled) return;

    const compRes = await apiFetch(`/api/upload/complete/${state.uploadId}`, { method: 'POST' });
    if (!compRes.ok) throw new Error('Could not finish upload');
    state.status = 'Done';
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
  const totalBytes = items.reduce((acc, u) => acc + u.file.size, 0);
  const avgPct = items.length ? Math.round(items.reduce((acc, u) => acc + u.percent, 0) / items.length) : 0;
  $('queue-summary').textContent = items.length > 0 ? `${activeCount} active · ${avgPct}% · ${formatBytes(totalBytes)}` : '';

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
  const sig = JSON.stringify(entries);
  if (sig === lastClipSig) return; // zero-jitter refresh
  lastClipSig = sig;
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
      showToast('Copied');
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
