const $ = (id) => document.getElementById(id);

const transfers = new Map();
const pendingChallenges = [];
const selectedFileIds = new Set();
const PAGE_SIZE = 50;
let allFiles = [];
let visibleLimit = PAGE_SIZE;
let currentQrUrl = '';
let currentState = null;
let currentPreviewFile = null;
let selectedTheme = 'dark';
let shareLayout = localStorage.getItem('bd_layout') || 'grid';
let activeFilter = 'all';
let searchQuery = '';
let toastTimer = null;
let lastFilesSig = '';
let lastSessionsSig = '';
let lastTrustedSig = '';
let lastClipSig = '';
let lastIfacesSig = '';

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

function createSvgIcon(kind, cls = 'item-icon') {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', cls);

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
  } else if (kind === 'image') {
    add('rect', { width: 18, height: 18, x: 3, y: 3, rx: 2, ry: 2 });
    add('circle', { cx: 9, cy: 9, r: 2 });
    add('path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' });
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

const TEXT_EXT_RE = /\.(txt|md|log|json|csv|ya?ml|xml|js|mjs|cjs|ts|py|css|html?|sh|ps1|ini|conf|env)$/i;

function getFileKind(file) {
  if (file.isDirectory) return 'folder';
  if (file.mimeType.startsWith('video/')) return 'video';
  if (file.mimeType.startsWith('image/')) return 'image';
  if (file.mimeType.startsWith('audio/')) return 'audio';
  if (file.mimeType.startsWith('text/') || file.mimeType === 'application/json' || TEXT_EXT_RE.test(file.name)) return 'text';
  return 'file';
}

function getExtLabel(file) {
  if (file.isDirectory) return 'FOLDER';
  const dot = file.name.lastIndexOf('.');
  return dot > 0 ? file.name.slice(dot + 1, dot + 6).toUpperCase() : 'FILE';
}

function previewStreamUrl(file) {
  if (!currentState || !currentState.localBaseUrl) return '';
  return `${currentState.localBaseUrl}/api/files/${encodeURIComponent(file.id)}/stream?token=${encodeURIComponent(currentState.localPreviewToken)}`;
}

function applyTheme(theme) {
  selectedTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', selectedTheme);
  $('rail-theme-label').textContent = selectedTheme === 'dark' ? 'Light Mode' : 'Dark Mode';
  document.querySelectorAll('#theme-seg .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeVal === selectedTheme);
  });
}

function applyShareLayout(layout) {
  shareLayout = layout === 'list' ? 'list' : 'grid';
  localStorage.setItem('bd_layout', shareLayout);
  document.querySelectorAll('#layout-seg .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.layout === shareLayout);
  });
  const container = $('files-container');
  container.className = shareLayout === 'grid' ? 'gallery-grid' : 'item-list';
}

function switchView(viewName) {
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === viewName));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${viewName}`));
}

function renderState(state) {
  currentState = state;
  currentQrUrl = state.qrUrl || state.url;

  if (state.settings && state.settings.theme) {
    applyTheme(state.settings.theme);
  }
  applyShareLayout(shareLayout);

  if ($('qr-img').src !== state.qrDataUrl) {
    $('qr-img').src = state.qrDataUrl;
    $('qr-large-img').src = state.qrDataUrl;
  }

  $('server-url').textContent = state.url;
  $('qr-large-url').textContent = state.url;
  $('pin-code').textContent = state.pin;
  $('chk-approval').checked = state.requireApproval;
  $('chk-room-mode').checked = Boolean(state.roomMode);
  $('save-dir-path').textContent = state.saveDir;
  $('rail-save-label').textContent = state.saveDir.split(/[/\\]/).pop() || 'Save Folder';

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
  } else if (state.wellbeing?.storage?.lowDisk) {
    dot.classList.add('warn');
    txt.textContent = 'Low Disk';
  } else {
    dot.classList.remove('warn');
    const count = Array.isArray(state.sessions) ? state.sessions.length : 0;
    if (count > 0) {
      txt.textContent = state.useHttps ? `Secured · ${count}` : `Connected · ${count}`;
    } else {
      txt.textContent = state.useHttps ? 'Secured' : 'Active';
    }
  }
  if (state.wellbeing) renderWellbeing(state.wellbeing);
  renderNetworkBanner(state);

  const ifacesSig = `${state.selectedAddress}|${JSON.stringify(state.interfaces)}`;
  if (ifacesSig !== lastIfacesSig) {
    lastIfacesSig = ifacesSig;
    const activeIface = state.interfaces.find((i) => i.address === state.selectedAddress);
    const fmtIface = (i) => `${i.isUsbTether ? '[USB] ' : ''}${i.name} (${i.address})`;
    $('iface-current').textContent = activeIface ? fmtIface(activeIface) : state.selectedAddress;

    const menu = $('iface-menu');
    menu.textContent = '';
    for (const iface of state.interfaces) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `custom-select-opt${iface.address === state.selectedAddress ? ' active' : ''}`;
      btn.textContent = fmtIface(iface);
      btn.addEventListener('click', () => {
        menu.classList.add('hidden');
        window.beamdrop.selectInterface(iface.address);
      });
      menu.appendChild(btn);
    }
  }

  renderFiles(state.files);
  renderSessions(state.sessions);
  renderTrusted(state.trustedDevices || []);
  renderClipboard(state.clipboard);
}

let networkBannerDismissed = false;
function renderNetworkBanner(state) {
  const banner = $('network-alert-banner');
  if (!banner) return;
  if (state.lanReachable || networkBannerDismissed) {
    banner.classList.add('hidden');
    banner.textContent = '';
    return;
  }
  banner.classList.remove('hidden');
  banner.textContent = '';

  const msg = document.createElement('span');
  msg.textContent = state.platform === 'win32'
    ? `Local Wi-Fi port ${state.port} looks blocked. Phones may not connect until Firewall or Hotspot is enabled.`
    : `Local Wi-Fi port ${state.port} looks unreachable. Allow port ${state.port} in your firewall or switch adapters in Connect.`;

  const actions = document.createElement('div');
  actions.className = 'btn-row';

  if (state.platform === 'win32') {
    const fwBtn = document.createElement('button');
    fwBtn.className = 'btn btn-primary btn-sm';
    fwBtn.textContent = 'Fix Firewall';
    fwBtn.addEventListener('click', async () => {
      const ok = await window.beamdrop.fixFirewall();
      showToast(ok ? 'Firewall rule added' : 'Firewall prompt cancelled');
      await window.beamdrop.refreshNetwork();
    });
    actions.appendChild(fwBtn);

    const hsBtn = document.createElement('button');
    hsBtn.className = 'btn btn-sm';
    hsBtn.textContent = 'Hotspot';
    hsBtn.addEventListener('click', () => window.beamdrop.openHotspot());
    actions.appendChild(hsBtn);
  }

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'btn btn-sm';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', () => {
    networkBannerDismissed = true;
    banner.classList.add('hidden');
  });
  actions.appendChild(dismissBtn);

  banner.appendChild(msg);
  banner.appendChild(actions);
}

function updatePcBatchBar() {
  const bar = $('pc-batch-bar');
  if (selectedFileIds.size === 0) {
    bar.classList.add('hidden');
  } else {
    bar.classList.remove('hidden');
    $('pc-sel-count').textContent = `${selectedFileIds.size} selected`;
  }
}

async function openMediaPreview(file) {
  if (file.isDirectory) return;
  const kind = getFileKind(file);
  if (!['video', 'image', 'audio', 'text'].includes(kind)) return;

  currentPreviewFile = file;
  $('media-title').textContent = file.name;
  const videoEl = $('pc-video-player');
  const imgEl = $('pc-image-player');
  const audioEl = $('pc-audio-player');
  const textEl = $('pc-text-player');
  const url = previewStreamUrl(file);

  videoEl.pause();
  videoEl.classList.add('hidden');
  videoEl.removeAttribute('src');
  videoEl.querySelectorAll('track').forEach((t) => t.remove());
  imgEl.classList.add('hidden');
  imgEl.removeAttribute('src');
  audioEl.pause();
  audioEl.classList.add('hidden');
  audioEl.removeAttribute('src');
  textEl.classList.add('hidden');
  textEl.textContent = '';

  if (kind === 'video') {
    videoEl.classList.remove('hidden');
    videoEl.src = url;
    if (currentState?.localBaseUrl && currentState?.localPreviewToken) {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = 'en';
      track.label = 'Subtitles';
      track.default = true;
      track.src = `${currentState.localBaseUrl}/api/files/${encodeURIComponent(file.id)}/subtitles?token=${encodeURIComponent(currentState.localPreviewToken)}`;
      videoEl.appendChild(track);
    }
  } else if (kind === 'image') {
    imgEl.classList.remove('hidden');
    imgEl.src = url;
  } else if (kind === 'audio') {
    audioEl.classList.remove('hidden');
    audioEl.src = url;
  } else if (kind === 'text') {
    textEl.textContent = 'Loading preview...';
    textEl.classList.remove('hidden');
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-524287' } });
      const txt = await res.text();
      textEl.textContent = file.size > 524288 ? `${txt}\n\n... (preview capped at 512 KB)` : txt;
    } catch {
      textEl.textContent = 'Could not load text preview.';
    }
  }
  $('media-modal').classList.remove('hidden');
}

function renderFiles(files, force = false) {
  const sig = JSON.stringify(files);
  if (!force && sig === lastFilesSig) return;
  lastFilesSig = sig;
  allFiles = files;

  const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
  $('nav-files-count').textContent = String(files.length);
  $('share-summary').textContent = `${files.length} item${files.length === 1 ? '' : 's'} · ${formatBytes(totalBytes)} · Up to 64 GB per file`;

  const container = $('files-container');
  container.textContent = '';

  const filtered = files.filter((file) => {
    if (activeFilter === 'video' && !file.mimeType.startsWith('video/')) return false;
    if (activeFilter === 'image' && !file.mimeType.startsWith('image/')) return false;
    if (activeFilter === 'folder' && !file.isDirectory) return false;
    if (searchQuery && !file.name.toLowerCase().includes(searchQuery)) return false;
    return true;
  });

  if (filtered.length === 0) {
    if (files.length === 0) {
      const card = document.createElement('div');
      card.className = 'onboarding-card';
      const h = document.createElement('strong');
      h.textContent = 'Ready to share';
      const steps = document.createElement('div');
      steps.className = 'onboarding-steps';
      [
        ['01', 'Drop Files or Folders', 'Drag videos, photos, or folders anywhere on this window.'],
        ['02', 'Connect Phone', 'Open the Connect tab to scan the QR code or copy the link.'],
        ['03', 'Stream or Download', 'Play videos or download files directly on your phone.']
      ].forEach(([num, title, desc]) => {
        const b = document.createElement('div');
        b.className = 'step-box';
        const n = document.createElement('div');
        n.className = 'step-num';
        n.textContent = num;
        const t = document.createElement('strong');
        t.textContent = title;
        const p = document.createElement('p');
        p.textContent = desc;
        b.appendChild(n);
        b.appendChild(t);
        b.appendChild(p);
        steps.appendChild(b);
      });
      card.appendChild(h);
      card.appendChild(steps);
      container.appendChild(card);
    } else {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No files match the current filter.';
      container.appendChild(empty);
    }
    updatePcBatchBar();
    return;
  }

  const slice = filtered.slice(0, visibleLimit);
  for (const file of slice) {
    const kind = getFileKind(file);
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = shareLayout === 'grid' ? 'custom-chk card-chk' : 'custom-chk';
    chk.checked = selectedFileIds.has(file.id);
    chk.addEventListener('change', () => {
      if (chk.checked) selectedFileIds.add(file.id);
      else selectedFileIds.delete(file.id);
      updatePcBatchBar();
    });

    if (shareLayout === 'grid') {
      const card = document.createElement('div');
      card.className = 'gallery-card';

      const thumbBox = document.createElement('div');
      thumbBox.className = 'gallery-thumb-box';
      thumbBox.appendChild(chk);

      if (kind === 'image' && currentState?.localPreviewToken) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = previewStreamUrl(file);
        img.alt = file.name;
        thumbBox.appendChild(img);
      } else if (kind === 'video' && currentState?.localPreviewToken) {
        const vid = document.createElement('video');
        vid.preload = 'metadata';
        vid.muted = true;
        vid.src = `${previewStreamUrl(file)}#t=0.5`;
        thumbBox.appendChild(vid);
      } else {
        thumbBox.appendChild(createSvgIcon(kind, 'gallery-placeholder'));
      }

      const extBadge = document.createElement('span');
      extBadge.className = 'ext-badge';
      extBadge.textContent = getExtLabel(file);
      thumbBox.appendChild(extBadge);
      thumbBox.addEventListener('click', (e) => {
        if (e.target !== chk) openMediaPreview(file);
      });

      const body = document.createElement('div');
      body.className = 'gallery-body';

      const nameEl = document.createElement('div');
      nameEl.className = 'item-name';
      nameEl.textContent = file.name;

      const subEl = document.createElement('div');
      subEl.className = 'item-sub';
      subEl.textContent = file.isDirectory ? `Folder (.zip) · ${file.source.toUpperCase()}` : `${formatBytes(file.size)} · ${file.source.toUpperCase()}`;

      const actions = document.createElement('div');
      actions.className = 'gallery-actions';
      if (['video', 'image', 'audio', 'text'].includes(kind)) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'btn btn-sm';
        prevBtn.textContent = kind === 'video' ? 'Play' : kind === 'audio' ? 'Listen' : kind === 'text' ? 'Read' : 'View';
        prevBtn.addEventListener('click', () => openMediaPreview(file));
        actions.appendChild(prevBtn);
      } else {
        const spacer = document.createElement('span');
        actions.appendChild(spacer);
      }

      const remBtn = document.createElement('button');
      remBtn.className = 'btn btn-sm';
      remBtn.textContent = 'Remove';
      remBtn.addEventListener('click', () => window.beamdrop.removeSharedItem(file.id));
      actions.appendChild(remBtn);

      body.appendChild(nameEl);
      body.appendChild(subEl);
      body.appendChild(actions);
      card.appendChild(thumbBox);
      card.appendChild(body);
      container.appendChild(card);
    } else {
      const row = document.createElement('div');
      row.className = 'item-row';
      row.appendChild(chk);
      row.appendChild(createSvgIcon(kind));

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      const nameEl = document.createElement('div');
      nameEl.className = 'item-name';
      nameEl.textContent = file.name;
      const subEl = document.createElement('div');
      subEl.className = 'item-sub';
      subEl.textContent = file.isDirectory
        ? `Folder (.zip) · From ${file.source.toUpperCase()}`
        : `${getExtLabel(file)} · ${formatBytes(file.size)} · From ${file.source.toUpperCase()}`;
      meta.appendChild(nameEl);
      meta.appendChild(subEl);
      row.appendChild(meta);

      const btns = document.createElement('div');
      btns.className = 'btn-row';
      if (kind === 'video' || kind === 'image') {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'btn btn-sm';
        prevBtn.textContent = kind === 'video' ? 'Play' : 'View';
        prevBtn.addEventListener('click', () => openMediaPreview(file));
        btns.appendChild(prevBtn);
      }
      const remBtn = document.createElement('button');
      remBtn.className = 'btn btn-sm';
      remBtn.textContent = 'Remove';
      remBtn.addEventListener('click', () => window.beamdrop.removeSharedItem(file.id));
      btns.appendChild(remBtn);

      row.appendChild(btns);
      container.appendChild(row);
    }
  }

  if (filtered.length > visibleLimit) {
    const moreBtn = document.createElement('button');
    moreBtn.className = 'btn btn-sm';
    moreBtn.textContent = `Show More (${filtered.length - visibleLimit} remaining)`;
    moreBtn.addEventListener('click', () => {
      visibleLimit += PAGE_SIZE;
      renderFiles(allFiles, true);
    });
    container.appendChild(moreBtn);
  }
  updatePcBatchBar();
}

function renderTransfers() {
  const items = Array.from(transfers.values());
  const active = items.filter((t) => t.status === 'active');
  const speedSum = active.reduce((acc, t) => acc + (t.speedBps || 0), 0);
  $('nav-transfers-count').textContent = String(active.length || items.length);
  $('transfers-summary').textContent = active.length > 0
    ? `${active.length} active · ${(speedSum / (1024 * 1024)).toFixed(1)} MB/s`
    : `${items.length} recent transfer${items.length === 1 ? '' : 's'}`;

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
    badge.textContent = isDownload ? 'PC -> DEVICE' : 'DEVICE -> PC';

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
  const sig = JSON.stringify(sessions);
  if (sig === lastSessionsSig) return;
  lastSessionsSig = sig;
  $('session-count').textContent = String(sessions.length);
  $('nav-devices-count').textContent = String(sessions.length);
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
    label.className = 'truncate';
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
  const sig = JSON.stringify(trusted);
  if (sig === lastTrustedSig) return;
  lastTrustedSig = sig;
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
    label.className = 'truncate';
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
  const sig = JSON.stringify(entries);
  if (sig === lastClipSig) return;
  lastClipSig = sig;
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
      showToast('Copied');
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
  msg.textContent = `${ch.deviceName} (${ch.ip}) wants to connect.`;
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
  trustBtn.textContent = 'Allow & Remember';
  trustBtn.addEventListener('click', async () => {
    await window.beamdrop.approveChallenge(ch.id, true, true);
    pendingChallenges.shift();
    renderApprovalBanner();
    showToast(`${ch.deviceName} remembered`);
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

// Window Controls & Nav Rail
$('win-min').addEventListener('click', () => window.beamdrop.minimizeWindow());
$('win-max').addEventListener('click', () => window.beamdrop.maximizeWindow());
$('win-close').addEventListener('click', () => window.beamdrop.closeWindow());

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

$('btn-rail-save').addEventListener('click', () => window.beamdrop.openSaveDir());
$('btn-rail-theme').addEventListener('click', async () => {
  const next = selectedTheme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await window.beamdrop.updateSettings({ theme: next });
});

// Layout & Filter Controls
document.querySelectorAll('#layout-seg .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    applyShareLayout(btn.dataset.layout);
    renderFiles(allFiles, true);
  });
});

document.querySelectorAll('.pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    activeFilter = pill.dataset.filter;
    renderFiles(allFiles, true);
  });
});

$('file-search').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  $('btn-clear-search').classList.toggle('hidden', !searchQuery);
  renderFiles(allFiles, true);
});
$('btn-clear-search').addEventListener('click', () => {
  $('file-search').value = '';
  searchQuery = '';
  $('btn-clear-search').classList.add('hidden');
  renderFiles(allFiles, true);
});

// Batch controls on PC
$('btn-pc-sel-all').addEventListener('click', () => {
  for (const f of allFiles) selectedFileIds.add(f.id);
  renderFiles(allFiles, true);
});
$('btn-pc-clear-sel').addEventListener('click', () => {
  selectedFileIds.clear();
  renderFiles(allFiles, true);
});
$('btn-pc-batch-remove').addEventListener('click', async () => {
  for (const id of Array.from(selectedFileIds)) {
    await window.beamdrop.removeSharedItem(id);
    selectedFileIds.delete(id);
  }
  updatePcBatchBar();
  showToast('Removed selected files');
});

// Adapter Dropdown & Connect View
$('iface-trigger').addEventListener('click', (e) => {
  e.stopPropagation();
  $('iface-menu').classList.toggle('hidden');
});
document.addEventListener('click', () => $('iface-menu').classList.add('hidden'));

$('btn-refresh-net').addEventListener('click', async () => {
  await window.beamdrop.refreshNetwork();
  showToast('Networks refreshed');
});
$('btn-copy-url').addEventListener('click', () => {
  navigator.clipboard.writeText($('server-url').textContent);
  showToast('Address copied');
});
$('btn-copy-invite').addEventListener('click', () => {
  if (!currentQrUrl) return;
  navigator.clipboard.writeText(currentQrUrl);
  showToast('One-tap link copied');
});
$('btn-regen-pin').addEventListener('click', () => {
  window.beamdrop.regeneratePin();
  showToast('New PIN generated');
});
$('chk-approval').addEventListener('change', (e) => window.beamdrop.setRequireApproval(e.target.checked));
$('chk-room-mode').addEventListener('change', (e) => window.beamdrop.setRoomMode(e.target.checked));
$('btn-change-save').addEventListener('click', () => window.beamdrop.pickSaveDir());
$('btn-open-save').addEventListener('click', () => window.beamdrop.openSaveDir());
$('btn-revoke').addEventListener('click', () => {
  window.beamdrop.revokeSessions();
  showToast('All devices disconnected');
});
$('btn-pick-files').addEventListener('click', () => window.beamdrop.pickFiles());
$('btn-pick-folder').addEventListener('click', () => window.beamdrop.pickFolder());
$('btn-clear-files').addEventListener('click', async () => {
  selectedFileIds.clear();
  await window.beamdrop.clearSharedItems();
  showToast('Shared list cleared');
});
$('btn-clear-transfers').addEventListener('click', () => {
  const now = Date.now();
  let removed = 0;
  for (const [id, t] of Array.from(transfers.entries())) {
    const isLive = t.status === 'active' && t._updatedAt && (now - t._updatedAt) < 15_000;
    if (!isLive) {
      transfers.delete(id);
      removed += 1;
    }
  }
  clearTimeout(transferRenderTimer);
  transferRenderTimer = null;
  renderTransfers();
  showToast(removed > 0 ? 'Transfer history cleared' : 'No completed transfers to clear');
});
$('btn-paste-send').addEventListener('click', async () => {
  const entry = await window.beamdrop.pasteAndSendClipboard();
  if (entry) showToast('Clipboard sent');
  else showToast('Clipboard is empty');
});

const sendClipboardText = async () => {
  const val = $('clip-input').value.trim();
  if (!val) return;
  await window.beamdrop.sendClipboard(val);
  $('clip-input').value = '';
  showToast('Sent');
};
$('btn-send-clip').addEventListener('click', sendClipboardText);
$('clip-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendClipboardText();
  }
});

// Full-window Drag & Drop
const dropBar = $('drop-zone');
document.body.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('window-drag');
  dropBar.classList.add('drag-over');
});
document.body.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) {
    document.body.classList.remove('window-drag');
    dropBar.classList.remove('drag-over');
  }
});
document.body.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('window-drag');
  dropBar.classList.remove('drag-over');
  const paths = [];
  for (const file of e.dataTransfer.files) {
    const p = window.beamdrop.getDroppedFilePath(file);
    if (p) paths.push(p);
  }
  if (paths.length > 0) {
    await window.beamdrop.addPaths(paths);
    switchView('share');
    showToast(`Added ${paths.length} item(s)`);
  }
});

// Modals: Media, QR, Help, Settings, Auto-Updater
function closeMediaModal() {
  const v = $('pc-video-player');
  v.pause();
  v.removeAttribute('src');
  v.querySelectorAll('track').forEach((t) => t.remove());
  v.load();
  const a = $('pc-audio-player');
  a.pause();
  a.removeAttribute('src');
  a.load();
  $('pc-image-player').removeAttribute('src');
  $('pc-text-player').textContent = '';
  $('media-modal').classList.add('hidden');
}

$('btn-close-media').addEventListener('click', closeMediaModal);

document.querySelectorAll('.modal').forEach((modalEl) => {
  modalEl.addEventListener('click', (e) => {
    if (e.target !== modalEl) return;
    if (modalEl.id === 'media-modal') closeMediaModal();
    else modalEl.classList.add('hidden');
  });
});
$('btn-media-reveal').addEventListener('click', () => {
  if (currentPreviewFile) {
    window.beamdrop.openSaveDir();
  }
});

$('qr-img').addEventListener('click', () => $('qr-modal').classList.remove('hidden'));
$('btn-close-qr').addEventListener('click', () => $('qr-modal').classList.add('hidden'));

$('btn-open-help').addEventListener('click', () => $('help-modal').classList.remove('hidden'));
$('btn-close-help').addEventListener('click', () => $('help-modal').classList.add('hidden'));

document.querySelectorAll('#theme-seg .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.themeVal));
});

$('btn-port-dec').addEventListener('click', () => {
  $('set-port').value = String(Math.max(1024, (Number($('set-port').value) || 5050) - 1));
});
$('btn-port-inc').addEventListener('click', () => {
  $('set-port').value = String(Math.min(65535, (Number($('set-port').value) || 5050) + 1));
});

$('btn-open-settings').addEventListener('click', () => {
  if (currentState && currentState.settings) {
    const s = currentState.settings;
    applyTheme(s.theme || 'dark');
    $('set-port').value = String(s.port);
    $('set-mdns').checked = Boolean(s.enableMdns);
    $('set-https').checked = Boolean(s.useHttps);
    $('set-autoupdate').checked = s.checkUpdatesOnStartup !== false;
    $('set-login').checked = Boolean(s.launchAtLogin);
    $('set-remux').checked = Boolean(s.ffmpegRemux);
    $('set-remux').disabled = !currentState.ffmpegAvailable;
    $('set-clear-quit').checked = Boolean(s.clearOnQuit);
  }
  $('settings-modal').classList.remove('hidden');
});
$('btn-close-settings').addEventListener('click', () => $('settings-modal').classList.add('hidden'));

$('btn-save-settings').addEventListener('click', async () => {
  const port = Number($('set-port').value);
  await window.beamdrop.updateSettings({
    theme: selectedTheme,
    port,
    enableMdns: $('set-mdns').checked,
    useHttps: $('set-https').checked,
    checkUpdatesOnStartup: $('set-autoupdate').checked,
    launchAtLogin: $('set-login').checked,
    ffmpegRemux: $('set-remux').checked,
    clearOnQuit: $('set-clear-quit').checked
  });
  $('settings-modal').classList.add('hidden');
  showToast('Settings saved');
});

$('btn-copy-diag').addEventListener('click', async () => {
  const report = await window.beamdrop.getDiagnostics();
  navigator.clipboard.writeText(report);
  showToast('Support info copied');
});

$('btn-fix-fw').addEventListener('click', async () => {
  const ok = await window.beamdrop.fixFirewall();
  showToast(ok ? 'Firewall rule added' : 'Firewall prompt cancelled');
});
$('btn-open-hotspot').addEventListener('click', () => window.beamdrop.openHotspot());

// System Wellbeing UI
function renderWellbeing(wb) {
  const grid = $('wellbeing-grid');
  if (!grid || !wb) return;
  grid.textContent = '';

  const freeText = wb.storage?.freeBytes != null ? formatBytes(wb.storage.freeBytes) : 'Unknown';
  const rows = [
    {
      name: 'Transfer Server',
      level: wb.server?.ok ? 'ok' : 'bad',
      val: wb.server?.ok
        ? `Online · Port ${wb.server.port}${wb.server.https ? ' (HTTPS)' : ''} · ${wb.server.activeSessions}/${wb.server.maxSessions} devices`
        : 'Offline'
    },
    {
      name: 'LAN & Firewall',
      level: wb.lanReachable ? (wb.vpnDetected ? 'warn' : 'ok') : 'bad',
      val: wb.lanReachable
        ? (wb.vpnDetected ? 'Reachable (VPN active)' : 'Reachable on local Wi-Fi')
        : 'Blocked — click Fix Firewall'
    },
    {
      name: 'Save Folder Storage',
      level: wb.storage?.ok ? 'ok' : (wb.storage?.writable ? 'warn' : 'bad'),
      val: !wb.storage?.writable
        ? 'Folder not writable'
        : wb.storage?.lowDisk
          ? `Low space (${freeText} free)`
          : `Writable · ${freeText} free`
    },
    {
      name: 'Upload Pipeline',
      level: wb.uploads?.ok ? 'ok' : 'warn',
      val: `${wb.uploads?.active || 0} / ${wb.uploads?.max || 16} active uploads`
    },
    {
      name: 'Discovery & Remux',
      level: wb.mdnsEnabled ? 'ok' : 'warn',
      val: `mDNS ${wb.mdnsEnabled ? 'On' : 'Off'} · FFmpeg ${wb.ffmpeg?.available ? 'Ready' : 'Not installed'}`
    },
    {
      name: 'Process Memory',
      level: (wb.memory?.rssMb || 0) < 512 ? 'ok' : 'warn',
      val: `${wb.memory?.rssMb || 0} MB RSS`
    }
  ];

  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'wellbeing-row';
    const left = document.createElement('div');
    left.className = 'wellbeing-left';
    const dot = document.createElement('span');
    dot.className = `wellbeing-dot${r.level === 'ok' ? '' : ` ${r.level}`}`;
    const name = document.createElement('span');
    name.className = 'wellbeing-name';
    name.textContent = r.name;
    left.appendChild(dot);
    left.appendChild(name);

    const val = document.createElement('span');
    val.className = 'wellbeing-val';
    val.textContent = r.val;

    row.appendChild(left);
    row.appendChild(val);
    grid.appendChild(row);
  }
  if (wb.timestamp) {
    $('wellbeing-checked-at').textContent = `Checked at ${new Date(wb.timestamp).toLocaleTimeString()}`;
  }
}

$('lan-status-badge').addEventListener('click', async () => {
  $('wellbeing-modal').classList.remove('hidden');
  if (window.beamdrop.getWellbeing) {
    const wb = await window.beamdrop.getWellbeing();
    renderWellbeing(wb);
  }
});
$('btn-close-wellbeing').addEventListener('click', () => $('wellbeing-modal').classList.add('hidden'));
$('btn-recheck-wellbeing').addEventListener('click', async () => {
  if (!window.beamdrop.getWellbeing) return;
  const wb = await window.beamdrop.getWellbeing();
  renderWellbeing(wb);
  showToast(wb.ok && wb.lanReachable ? 'All systems healthy' : 'Check warnings above');
});

// Auto-Updater UI
async function runUpdateCheck() {
  $('btn-updater-check').disabled = true;
  $('updater-status-text').textContent = 'Checking GitHub Releases...';
  $('updater-meta-row').classList.add('hidden');
  $('updater-verify-pill').classList.add('hidden');
  $('updater-notes').classList.add('hidden');
  $('updater-progress-wrap').classList.add('hidden');
  $('btn-updater-download').classList.add('hidden');
  $('btn-updater-now').classList.add('hidden');
  $('btn-updater-quit').classList.add('hidden');
  try {
    await window.beamdrop.checkUpdates();
    $('updater-checked-at').textContent = `Last checked: ${new Date().toLocaleTimeString()}`;
    $('updater-checked-at').classList.remove('hidden');
  } catch (err) {
    $('updater-status-text').textContent = `Could not check for updates: ${err.message}`;
  } finally {
    $('btn-updater-check').disabled = false;
  }
}

$('btn-open-updater').addEventListener('click', () => {
  $('updater-modal').classList.remove('hidden');
  runUpdateCheck();
});
$('btn-close-updater').addEventListener('click', () => $('updater-modal').classList.add('hidden'));
$('btn-updater-check').addEventListener('click', runUpdateCheck);

$('btn-updater-download').addEventListener('click', async () => {
  $('btn-updater-download').classList.add('hidden');
  $('btn-updater-check').disabled = true;
  $('btn-updater-cancel').classList.remove('hidden');
  $('updater-progress-wrap').classList.remove('hidden');
  $('updater-progress-fill').style.width = '0%';
  $('updater-status-text').textContent = 'Downloading update package...';
  try {
    await window.beamdrop.downloadUpdate();
  } catch (err) {
    $('updater-status-text').textContent = `Update failed: ${err.message}`;
    $('btn-updater-cancel').classList.add('hidden');
    $('btn-updater-download').classList.remove('hidden');
  } finally {
    $('btn-updater-check').disabled = false;
  }
});

$('btn-updater-cancel').addEventListener('click', () => window.beamdrop.cancelUpdate());
$('btn-updater-now').addEventListener('click', () => window.beamdrop.installUpdateNow());
$('btn-updater-quit').addEventListener('click', () => {
  window.beamdrop.installUpdateOnQuit();
  $('updater-modal').classList.add('hidden');
  showToast('Update will install when you quit');
});

window.beamdrop.onUpdaterStatus((st) => {
  if (st.state === 'available' && st.release) {
    $('updater-dot').classList.remove('hidden');
    $('updater-rail-label').textContent = `Update v${st.release.latestVersion}`;
    $('updater-version-pill').textContent = `v${st.release.currentVersion} → v${st.release.latestVersion}`;
    if (st.release.installer?.size) {
      $('updater-size-pill').textContent = formatBytes(st.release.installer.size);
      $('updater-size-pill').classList.remove('hidden');
    } else {
      $('updater-size-pill').classList.add('hidden');
    }
    $('updater-meta-row').classList.remove('hidden');
    $('updater-status-text').textContent = `BeamDrop v${st.release.latestVersion} is ready to download.`;
    if (st.release.notes) {
      $('updater-notes').textContent = st.release.notes;
      $('updater-notes').classList.remove('hidden');
    }
    if (st.release.installer) {
      $('btn-updater-download').classList.remove('hidden');
    }
  } else if (st.state === 'up-to-date' && st.release) {
    $('updater-dot').classList.add('hidden');
    $('updater-rail-label').textContent = 'Up to Date';
    $('updater-version-pill').textContent = `v${st.release.currentVersion}`;
    $('updater-size-pill').classList.add('hidden');
    $('updater-meta-row').classList.remove('hidden');
    $('updater-status-text').textContent = `You are running the latest version of BeamDrop.`;
  } else if (st.state === 'downloaded') {
    $('btn-updater-cancel').classList.add('hidden');
    $('btn-updater-now').classList.remove('hidden');
    $('btn-updater-quit').classList.remove('hidden');
    if (st.sha256Verified) $('updater-verify-pill').classList.remove('hidden');
    $('updater-status-text').textContent = st.sha256Verified
      ? 'Download complete and SHA-256 verified. Ready to install.'
      : 'Download complete. Ready to install.';
  } else if (st.state === 'cancelled') {
    $('btn-updater-cancel').classList.add('hidden');
    $('btn-updater-download').classList.remove('hidden');
    $('updater-progress-wrap').classList.add('hidden');
    $('updater-status-text').textContent = 'Download cancelled.';
  }
});

window.beamdrop.onUpdaterProgress((pr) => {
  $('updater-progress-fill').style.width = `${pr.percent}%`;
  const dlMb = (pr.downloadedBytes / (1024 * 1024)).toFixed(1);
  const totMb = pr.totalBytes ? (pr.totalBytes / (1024 * 1024)).toFixed(1) : '?';
  const mbps = (pr.speedBps / (1024 * 1024)).toFixed(1);
  const remBytes = pr.totalBytes ? Math.max(0, pr.totalBytes - pr.downloadedBytes) : 0;
  const eta = pr.speedBps > 0 && remBytes > 0 ? ` · ${Math.ceil(remBytes / pr.speedBps)}s left` : '';
  $('updater-progress-meta').textContent = `${pr.percent}% · ${dlMb} / ${totMb} MB · ${mbps} MB/s${eta}`;
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('media-modal').classList.add('hidden');
    const v = $('pc-video-player');
    v.pause();
    v.removeAttribute('src');
    v.load();
    $('qr-modal').classList.add('hidden');
    $('settings-modal').classList.add('hidden');
    $('help-modal').classList.add('hidden');
    $('updater-modal').classList.add('hidden');
    $('wellbeing-modal').classList.add('hidden');
    $('iface-menu').classList.add('hidden');
  } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    window.beamdrop.pickFolder();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    window.beamdrop.pickFiles();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    switchView('share');
    $('file-search').focus();
  }
});

// Events
window.beamdrop.onStateChanged(renderState);
window.beamdrop.onFilesChanged((files) => renderFiles(files));
window.beamdrop.onSessionsChanged(renderSessions);
window.beamdrop.onClipboardChanged(renderClipboard);
let transferRenderTimer = null;
function scheduleRenderTransfers() {
  if (transferRenderTimer) return;
  transferRenderTimer = setTimeout(() => {
    transferRenderTimer = null;
    renderTransfers();
  }, 120);
}

window.beamdrop.onTransferUpdate((t) => {
  transfers.set(t.id, { ...t, _updatedAt: Date.now() });
  if (transfers.size > 100) {
    const oldest = transfers.keys().next().value;
    if (oldest) transfers.delete(oldest);
  }
  if (t.status !== 'active') {
    clearTimeout(transferRenderTimer);
    transferRenderTimer = null;
    renderTransfers();
  } else {
    scheduleRenderTransfers();
  }
});
window.beamdrop.onAuthChallenge((ch) => {
  pendingChallenges.push(ch);
  renderApprovalBanner();
});

window.beamdrop.getState().then(renderState);
