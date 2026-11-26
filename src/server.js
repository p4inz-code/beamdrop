// BeamDrop — Copyright (C) 2026 Atharva Patil (p4inz-code) | https://github.com/p4inz-code/beamdrop
// Licensed under GNU GPL-3.0-or-later. See LICENSE and NOTICE for details.

const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');
const archiver = require('archiver');
const QRCode = require('qrcode');
const {
  sanitizeFilename,
  resolveSafePath,
  generatePin,
  generateToken,
  timingSafeEqualStr,
  PinRateLimiter
} = require('./security');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8'
};

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function parseCookies(cookieHeader = '') {
  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function toLongPath(p) {
  if (process.platform === 'win32' && p.length >= 240 && !p.startsWith('\\\\?\\')) {
    return `\\\\?\\${path.resolve(p)}`;
  }
  return p;
}

function checkFfmpegAvailable() {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 2000 }, (err) => {
      resolve(!err);
    });
  });
}

function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const s = fs.createReadStream(toLongPath(filePath), { highWaterMark: 512 * 1024 });
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
    s.on('error', reject);
  });
}

class BeamDropServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port ?? 5050;
    this.host = options.host ?? '0.0.0.0';
    this.saveDir = options.saveDir;
    this.mobileDir = options.mobileDir || path.join(__dirname, 'mobile');
    this.trustedStorePath = options.trustedStorePath || null;
    this.tlsOptions = options.tlsOptions || null;
    this.logger = options.logger || null;
    this.ffmpegRemux = Boolean(options.ffmpegRemux);
    this.ffmpegAvailable = false;
    this.maxFileSize = options.maxFileSize ?? 10 * 1024 * 1024 * 1024; // 10 GB
    this.requireApproval = options.requireApproval ?? true;

    this.pin = options.pin || generatePin();
    this.qrSecret = crypto.randomBytes(16).toString('hex');
    this.rateLimiter = new PinRateLimiter({
      maxAttempts: options.maxPinAttempts ?? 5,
      windowMs: 60_000,
      lockoutMs: 120_000
    });

    this.sessions = new Map();
    this.challenges = new Map();
    this.trustedDevices = new Map(); // id -> { id, deviceName, trustKey, createdAt }
    this.sharedItems = new Map();
    this.uploads = new Map();
    this.clipboard = [];
    this.wsClients = new Set();

    this.httpServer = null;
    this.wss = null;
    this.cleanupTimer = null;
  }

  async init() {
    await fsp.mkdir(this.saveDir, { recursive: true });
    await fsp.mkdir(this.getTempDir(), { recursive: true });
    await this.loadTrustedDevices();
    this.ffmpegAvailable = await checkFfmpegAvailable();
    this.logger?.info('Server', `Initialized (ffmpeg=${this.ffmpegAvailable})`);
    // Clean up orphaned .part files from any previous unclean shutdown
    try {
      const entries = await fsp.readdir(this.getTempDir());
      for (const name of entries) {
        if (name.endsWith('.part')) {
          await fsp.rm(path.join(this.getTempDir(), name), { force: true }).catch(() => {});
        }
      }
    } catch {
      // ignore
    }
  }

  getTempDir() {
    return path.join(this.saveDir, '.beamdrop_tmp');
  }

  async setSaveDir(newDir) {
    this.saveDir = newDir;
    await this.init();
    this.emit('state:changed');
  }

  async loadTrustedDevices() {
    if (!this.trustedStorePath) return;
    try {
      const raw = await fsp.readFile(this.trustedStorePath, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const d of list) {
          if (d && d.id && d.trustKey) this.trustedDevices.set(d.id, d);
        }
      }
    } catch {
      // ignore if file does not exist yet
    }
  }

  async saveTrustedDevices() {
    if (!this.trustedStorePath) return;
    try {
      await fsp.mkdir(path.dirname(this.trustedStorePath), { recursive: true });
      const data = JSON.stringify(Array.from(this.trustedDevices.values()), null, 2);
      await fsp.writeFile(this.trustedStorePath, data, 'utf8');
    } catch {
      // ignore
    }
  }

  getTrustedDevices() {
    return Array.from(this.trustedDevices.values()).map((d) => ({
      id: d.id,
      deviceName: d.deviceName,
      createdAt: d.createdAt
    }));
  }

  async revokeTrustedDevice(id) {
    if (this.trustedDevices.delete(id)) {
      await this.saveTrustedDevices();
      this.emit('state:changed');
      return true;
    }
    return false;
  }

  regeneratePin() {
    this.pin = generatePin();
    this.qrSecret = crypto.randomBytes(16).toString('hex');
    for (const ch of this.challenges.values()) {
      if (ch.status === 'pending') ch.status = 'rejected';
    }
    this.emit('state:changed');
    return this.pin;
  }

  setRequireApproval(enabled) {
    this.requireApproval = Boolean(enabled);
    this.emit('state:changed');
  }

  revokeSessionById(sessionId) {
    for (const [token, s] of this.sessions.entries()) {
      if (s.id === sessionId) {
        this.sessions.delete(token);
        for (const ws of this.wsClients) {
          if (ws._bdSessionId === sessionId) {
            try {
              ws.send(JSON.stringify({ type: 'session:revoked' }));
              ws.close(4001, 'Session revoked');
            } catch {
              // ignore
            }
          }
        }
        this.emit('sessions:changed', this.getActiveSessions());
        return true;
      }
    }
    return false;
  }

  revokeAllSessions() {
    this.sessions.clear();
    this.challenges.clear();
    for (const ws of this.wsClients) {
      try {
        ws.send(JSON.stringify({ type: 'session:revoked' }));
        ws.close(4001, 'Session revoked');
      } catch {
        // ignore
      }
    }
    this.emit('sessions:changed', []);
  }

  approveChallenge(challengeId, allow, trust = false) {
    const ch = this.challenges.get(challengeId);
    if (!ch || ch.status !== 'pending') return false;

    if (allow) {
      const token = generateToken();
      const sessionId = crypto.randomUUID();
      ch.status = 'approved';
      ch.token = token;
      if (trust) {
        const trustKey = generateToken();
        const trustedId = crypto.randomUUID();
        this.trustedDevices.set(trustedId, {
          id: trustedId,
          deviceName: ch.deviceName,
          trustKey,
          createdAt: Date.now()
        });
        ch.trustKey = trustKey;
        this.saveTrustedDevices();
        this.emit('state:changed');
      }
      this.sessions.set(token, {
        id: sessionId,
        token,
        deviceName: ch.deviceName,
        ip: ch.ip,
        createdAt: Date.now()
      });
      this.emit('sessions:changed', this.getActiveSessions());
    } else {
      ch.status = 'rejected';
    }
    return true;
  }

  getActiveSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      ip: s.ip,
      createdAt: s.createdAt
    }));
  }

  async addSharedPaths(filePaths, source = 'pc') {
    const added = [];
    for (const rawPath of filePaths) {
      try {
        const resolved = path.resolve(rawPath);
        const stat = await fsp.stat(resolved);
        const name = path.basename(resolved);

        let existing = null;
        for (const item of this.sharedItems.values()) {
          if (item.filePath === resolved) {
            existing = item;
            break;
          }
        }
        if (existing) {
          added.push(existing);
          continue;
        }

        const id = crypto.randomUUID();
        const item = {
          id,
          name,
          filePath: resolved,
          size: stat.isDirectory() ? 0 : stat.size,
          mimeType: stat.isDirectory() ? 'inode/directory' : getMimeType(name),
          isDirectory: stat.isDirectory(),
          source,
          addedAt: Date.now()
        };
        this.sharedItems.set(id, item);
        added.push(item);
      } catch {
        // skip inaccessible paths
      }
    }
    if (added.length > 0) {
      this.broadcast('files:updated', this.getPublicFileList());
      this.emit('files:changed', this.getPublicFileList());
    }
    return added;
  }

  removeSharedItem(id) {
    if (this.sharedItems.delete(id)) {
      this.broadcast('files:updated', this.getPublicFileList());
      this.emit('files:changed', this.getPublicFileList());
      return true;
    }
    return false;
  }

  clearSharedItems() {
    this.sharedItems.clear();
    this.broadcast('files:updated', []);
    this.emit('files:changed', []);
  }

  getPublicFileList() {
    return Array.from(this.sharedItems.values()).map((item) => ({
      id: item.id,
      name: item.name,
      size: item.size,
      mimeType: item.mimeType,
      isDirectory: item.isDirectory,
      source: item.source,
      addedAt: item.addedAt
    }));
  }

  addClipboardEntry(text, from = 'PC') {
    if (typeof text !== 'string' || !text.trim()) return null;
    const entry = {
      id: crypto.randomUUID(),
      text: text.slice(0, 65536),
      from: sanitizeFilename(String(from)).slice(0, 40),
      timestamp: Date.now()
    };
    this.clipboard.unshift(entry);
    if (this.clipboard.length > 50) this.clipboard.length = 50;
    this.broadcast('clipboard:updated', this.clipboard);
    this.emit('clipboard:changed', this.clipboard);
    return entry;
  }

  async getQrDataUrl(url) {
    return QRCode.toDataURL(url, {
      errorCorrectionLevel: 'Q',
      width: 280,
      margin: 2,
      color: { dark: '#090d14', light: '#ffffff' }
    });
  }

  getTokenFromRequest(req) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return auth.slice(7).trim();
    }
    const cookie = parseCookies(req.headers.cookie).bd_token;
    if (cookie) return cookie;
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const qToken = url.searchParams.get('token');
      if (qToken) return qToken;
    } catch {
      // ignore
    }
    return null;
  }

  authenticateRequest(req) {
    const token = this.getTokenFromRequest(req);
    if (!token) return null;
    return this.sessions.get(token) || null;
  }

  validateSameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const originHost = new URL(origin).host;
      return originHost === req.headers.host;
    } catch {
      return false;
    }
  }

  broadcast(type, payload) {
    const msg = JSON.stringify({ type, payload });
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        ws.send(msg);
      }
    }
  }

  async resolveUniqueDestination(filename) {
    const clean = sanitizeFilename(filename);
    const ext = path.extname(clean);
    const stem = path.basename(clean, ext);
    let candidate = clean;
    let counter = 1;

    while (true) {
      const target = resolveSafePath(this.saveDir, candidate);
      try {
        await fsp.access(target);
        candidate = `${stem} (${counter})${ext}`;
        counter += 1;
      } catch {
        return { filename: candidate, fullPath: target };
      }
    }
  }

  async handleRequest(req, res) {
    req.socket?.setNoDelay?.(true);
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const remoteIp = req.socket.remoteAddress || 'unknown';

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, ffmpegAvailable: this.ffmpegAvailable });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD' && !this.validateSameOrigin(req)) {
      return sendJson(res, 403, { error: 'Cross-origin request blocked' });
    }

    try {
      // Static mobile PWA routes
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        return this.serveStatic(res, path.join(this.mobileDir, 'index.html'), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && pathname === '/mobile.css') {
        return this.serveStatic(res, path.join(this.mobileDir, 'mobile.css'), 'text/css; charset=utf-8');
      }
      if (req.method === 'GET' && pathname === '/mobile.js') {
        return this.serveStatic(res, path.join(this.mobileDir, 'mobile.js'), 'application/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && pathname === '/manifest.json') {
        return this.serveStatic(res, path.join(this.mobileDir, 'manifest.json'), 'application/json; charset=utf-8');
      }

      // Public Auth endpoints
      if (req.method === 'POST' && pathname === '/api/auth/pair') {
        return await this.handlePair(req, res, remoteIp);
      }
      if (req.method === 'GET' && pathname === '/api/auth/status') {
        const challengeId = parsedUrl.searchParams.get('challengeId') || '';
        const ch = this.challenges.get(challengeId);
        if (!ch) return sendJson(res, 404, { error: 'Challenge not found' });
        if (ch.status === 'approved') {
          return sendJson(
            res,
            200,
            { status: 'approved', token: ch.token, trustKey: ch.trustKey || null },
            { 'Set-Cookie': `bd_token=${encodeURIComponent(ch.token)}; HttpOnly; SameSite=Strict; Path=/` }
          );
        }
        return sendJson(res, 200, { status: ch.status });
      }

      // Authenticated endpoints
      const session = this.authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized' });
      }

      if (req.method === 'GET' && pathname === '/api/auth/me') {
        return sendJson(res, 200, { authenticated: true, deviceName: session.deviceName });
      }

      if (req.method === 'GET' && pathname === '/api/files') {
        return sendJson(res, 200, { files: this.getPublicFileList() });
      }

      const fileMatch = pathname.match(/^\/api\/files\/([a-zA-Z0-9-]+)\/(stream|download|remux)$/);
      if (req.method === 'GET' && fileMatch) {
        const [, id, mode] = fileMatch;
        if (mode === 'remux') {
          return await this.handleFileRemux(req, res, id);
        }
        return await this.handleFileTransfer(req, res, id, mode, session);
      }

      if (req.method === 'GET' && pathname === '/api/zip') {
        const idsParam = parsedUrl.searchParams.get('ids') || '';
        const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
        return await this.handleBatchZip(req, res, ids);
      }

      if (req.method === 'POST' && pathname === '/api/upload/init') {
        return await this.handleUploadInit(req, res, session);
      }

      const statusMatch = pathname.match(/^\/api\/upload\/status\/([a-zA-Z0-9-]+)$/);
      if (req.method === 'GET' && statusMatch) {
        const up = this.uploads.get(statusMatch[1]);
        if (!up) return sendJson(res, 404, { error: 'Upload session not found' });
        return sendJson(res, 200, {
          uploadId: up.id,
          receivedChunks: Array.from(up.receivedChunks),
          totalChunks: up.totalChunks,
          receivedBytes: up.receivedBytes
        });
      }

      const chunkMatch = pathname.match(/^\/api\/upload\/chunk\/([a-zA-Z0-9-]+)\/(\d+)$/);
      if (req.method === 'PUT' && chunkMatch) {
        const [, uploadId, chunkIdxStr] = chunkMatch;
        return await this.handleUploadChunk(req, res, uploadId, Number(chunkIdxStr));
      }

      const completeMatch = pathname.match(/^\/api\/upload\/complete\/([a-zA-Z0-9-]+)$/);
      if (req.method === 'POST' && completeMatch) {
        return await this.handleUploadComplete(req, res, completeMatch[1]);
      }

      const cancelMatch = pathname.match(/^\/api\/upload\/([a-zA-Z0-9-]+)$/);
      if (req.method === 'DELETE' && cancelMatch) {
        return await this.handleUploadCancel(res, cancelMatch[1]);
      }

      if (req.method === 'GET' && pathname === '/api/clipboard') {
        return sendJson(res, 200, { entries: this.clipboard });
      }
      if (req.method === 'POST' && pathname === '/api/clipboard') {
        const body = await readJsonBody(req, 65536);
        const entry = this.addClipboardEntry(body.text, session.deviceName || 'Phone');
        if (!entry) return sendJson(res, 400, { error: 'Empty text' });
        return sendJson(res, 200, { entry });
      }

      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const code = err.statusCode || 500;
      return sendJson(res, code, { error: err.message || 'Internal Server Error' });
    }
  }

  async serveStatic(res, filePath, contentType) {
    try {
      const content = await fsp.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length,
        'Cache-Control': 'no-cache'
      });
      res.end(content);
    } catch {
      sendJson(res, 404, { error: 'Asset not found' });
    }
  }

  async handlePair(req, res, remoteIp) {
    const lock = this.rateLimiter.isLocked(remoteIp);
    if (lock.locked) {
      return sendJson(
        res,
        429,
        { error: `Too many failed attempts. Retry in ${lock.retryAfterSec}s.` },
        { 'Retry-After': String(lock.retryAfterSec) }
      );
    }

    const body = await readJsonBody(req, 4096);
    const submittedPin = String(body.pin || '').trim();
    const submittedQr = String(body.qrSecret || '').trim();
    const submittedTrust = String(body.trustKey || '').trim();
    const deviceName = String(body.deviceName || 'Mobile Device').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 48) || 'Mobile Device';

    // Check Trusted Device Key first (1-tap reconnect)
    if (submittedTrust) {
      for (const td of this.trustedDevices.values()) {
        if (timingSafeEqualStr(submittedTrust, td.trustKey)) {
          this.rateLimiter.recordSuccess(remoteIp);
          const token = generateToken();
          const sessionId = crypto.randomUUID();
          this.sessions.set(token, { id: sessionId, token, deviceName: td.deviceName || deviceName, ip: remoteIp, createdAt: Date.now() });
          this.emit('sessions:changed', this.getActiveSessions());
          return sendJson(
            res,
            200,
            { status: 'approved', token, trusted: true },
            { 'Set-Cookie': `bd_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/` }
          );
        }
      }
    }

    const qrValid = Boolean(submittedQr) && timingSafeEqualStr(submittedQr, this.qrSecret);
    const pinValid = Boolean(submittedPin) && timingSafeEqualStr(submittedPin, this.pin);

    if (!qrValid && !pinValid) {
      const fail = this.rateLimiter.recordFailure(remoteIp);
      return sendJson(res, 401, {
        error: fail.locked
          ? `Too many failed attempts. Locked for ${fail.retryAfterSec}s.`
          : `Invalid PIN. ${fail.attemptsLeft} attempts remaining.`
      });
    }

    this.rateLimiter.recordSuccess(remoteIp);

    if (!this.requireApproval) {
      const token = generateToken();
      const sessionId = crypto.randomUUID();
      this.sessions.set(token, { id: sessionId, token, deviceName, ip: remoteIp, createdAt: Date.now() });
      this.emit('sessions:changed', this.getActiveSessions());
      return sendJson(
        res,
        200,
        { status: 'approved', token },
        { 'Set-Cookie': `bd_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/` }
      );
    }

    const challengeId = crypto.randomUUID();
    const challenge = {
      id: challengeId,
      deviceName,
      ip: remoteIp,
      status: 'pending',
      token: null,
      createdAt: Date.now()
    };
    this.challenges.set(challengeId, challenge);
    this.emit('auth:challenge', { id: challengeId, deviceName, ip: remoteIp });

    return sendJson(res, 202, { status: 'pending', challengeId });
  }

  pipeWithTracking(stream, res, req, meta) {
    const transferId = crypto.randomUUID();
    const startedAt = Date.now();
    let sentBytes = 0;
    let lastEmitAt = 0;

    const emitProgress = (status) => {
      const elapsedSec = Math.max(0.1, (Date.now() - startedAt) / 1000);
      const speedBps = sentBytes / elapsedSec;
      const total = meta.totalSize || sentBytes;
      const remaining = Math.max(0, total - sentBytes);
      const etaSec = speedBps > 0 ? Math.round(remaining / speedBps) : 0;
      const percent = total > 0 ? Math.min(100, Math.round((sentBytes / total) * 100)) : 100;

      this.emit('transfer:update', {
        id: transferId,
        direction: 'download',
        filename: meta.filename,
        deviceName: meta.deviceName,
        totalSize: total,
        receivedBytes: sentBytes,
        percent,
        speedBps,
        etaSec,
        status
      });
    };

    stream.on('data', (chunk) => {
      sentBytes += chunk.length;
      const now = Date.now();
      if (now - lastEmitAt >= 250) {
        lastEmitAt = now;
        emitProgress('active');
      }
    });

    stream.on('end', () => {
      if (meta.trackDownload) emitProgress('completed');
    });

    stream.on('error', () => {
      if (meta.trackDownload) emitProgress('error');
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'File read error' });
      } else {
        res.destroy();
      }
    });

    res.on('close', () => {
      if (!res.writableFinished && !stream.destroyed) {
        stream.destroy();
      }
    });

    stream.pipe(res);
  }

  async handleFileTransfer(req, res, id, mode, session) {
    const item = this.sharedItems.get(id);
    if (!item) return sendJson(res, 404, { error: 'File not found' });

    let stat;
    try {
      stat = await fsp.stat(item.filePath);
    } catch {
      return sendJson(res, 404, { error: 'File no longer exists on disk' });
    }

    if (stat.isDirectory()) {
      return this.streamArchive(req, res, [item], `${sanitizeFilename(item.name)}.zip`);
    }

    const totalSize = stat.size;
    const rangeHeader = req.headers.range;
    const trackDownload = mode === 'download' && totalSize >= 1024 * 1024; // track >=1MB downloads cleanly

    if (mode === 'download' && !rangeHeader) {
      res.writeHead(200, {
        'Content-Type': item.mimeType,
        'Content-Length': totalSize,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        'Accept-Ranges': 'bytes'
      });
      const stream = fs.createReadStream(item.filePath, { highWaterMark: 512 * 1024 });
      return this.pipeWithTracking(stream, res, req, {
        filename: item.name,
        deviceName: session.deviceName,
        totalSize,
        trackDownload
      });
    }

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!match) {
        res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
        return res.end();
      }
      let start = match[1] ? parseInt(match[1], 10) : 0;
      let end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

      if (!match[1] && match[2]) {
        start = Math.max(0, totalSize - parseInt(match[2], 10));
        end = totalSize - 1;
      }

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= totalSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
        return res.end();
      }

      end = Math.min(end, totalSize - 1);
      const chunkLen = end - start + 1;

      const headers = {
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkLen,
        'Content-Type': item.mimeType
      };
      if (mode === 'download') {
        headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`;
      }

      res.writeHead(206, headers);
      const stream = fs.createReadStream(item.filePath, { start, end, highWaterMark: 512 * 1024 });
      return this.pipeWithTracking(stream, res, req, {
        filename: item.name,
        deviceName: session.deviceName,
        totalSize: chunkLen,
        trackDownload: false
      });
    }

    res.writeHead(200, {
      'Content-Type': item.mimeType,
      'Content-Length': totalSize,
      'Accept-Ranges': 'bytes'
    });
    const stream = fs.createReadStream(item.filePath, { highWaterMark: 512 * 1024 });
    return this.pipeWithTracking(stream, res, req, {
      filename: item.name,
      deviceName: session.deviceName,
      totalSize,
      trackDownload: false
    });
  }

  async handleFileRemux(req, res, id) {
    const item = this.sharedItems.get(id);
    if (!item || item.isDirectory) return sendJson(res, 404, { error: 'File not found' });
    if (!this.ffmpegAvailable) {
      return sendJson(res, 501, { error: 'FFmpeg not available on PC PATH' });
    }

    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-store'
    });

    const ff = spawn('ffmpeg', [
      '-v', 'error',
      '-i', item.filePath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ff.stdout.pipe(res);
    ff.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    res.on('close', () => {
      if (!ff.killed) ff.kill('SIGKILL');
    });
  }

  async handleBatchZip(req, res, ids) {
    const items = ids.map((id) => this.sharedItems.get(id)).filter(Boolean);
    if (items.length === 0) {
      return sendJson(res, 404, { error: 'No valid files selected' });
    }
    return this.streamArchive(req, res, items, `BeamDrop-Batch-${Date.now()}.zip`);
  }

  async appendDirectorySafe(archive, dirPath, zipPrefix) {
    let entries;
    try {
      entries = await fsp.readdir(toLongPath(dirPath), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      try {
        const lst = await fsp.lstat(toLongPath(full));
        if (lst.isSymbolicLink()) continue; // skip symlinks/junctions
        const entryZipPath = path.posix.join(zipPrefix, sanitizeFilename(entry.name));
        if (lst.isDirectory()) {
          await this.appendDirectorySafe(archive, full, entryZipPath);
        } else if (lst.isFile()) {
          archive.file(toLongPath(full), { name: entryZipPath });
        }
      } catch {
        // skip unreadable entries
      }
    }
  }

  async streamArchive(req, res, items, zipName) {
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`
    });

    // Level 0 (STORE): near-zero CPU usage so 1GB+ video/photo bundles stream cool & fast
    const archive = archiver('zip', { store: true });
    archive.on('error', () => {
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
    });
    res.on('close', () => {
      if (!res.writableFinished) {
        archive.abort();
      }
    });

    archive.pipe(res);
    for (const item of items) {
      try {
        const lst = await fsp.lstat(item.filePath);
        if (lst.isSymbolicLink()) continue;
        if (lst.isDirectory()) {
          await this.appendDirectorySafe(archive, item.filePath, sanitizeFilename(item.name));
        } else if (lst.isFile()) {
          archive.file(item.filePath, { name: sanitizeFilename(item.name) });
        }
      } catch {
        // skip missing items
      }
    }
    archive.finalize();
  }

  async checkDiskSpace(requiredBytes) {
    try {
      const stats = await fsp.statfs(this.saveDir);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      return freeBytes >= requiredBytes + 50 * 1024 * 1024; // keep 50MB safety margin
    } catch {
      return true;
    }
  }

  async handleUploadInit(req, res, session) {
    const body = await readJsonBody(req, 16 * 1024);
    const totalSize = Number(body.totalSize);
    const requestedChunk = Number(body.chunkSize) || 8 * 1024 * 1024;
    const chunkSize = Math.min(Math.max(requestedChunk, 64 * 1024), 16 * 1024 * 1024);
    const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint.slice(0, 128) : '';

    if (!Number.isFinite(totalSize) || totalSize < 0 || totalSize > this.maxFileSize) {
      return sendJson(res, 400, { error: `Invalid file size (max ${Math.round(this.maxFileSize / (1024 ** 3))} GB)` });
    }

    // Resume existing upload if fingerprint matches an active partial upload
    if (fingerprint) {
      for (const existing of this.uploads.values()) {
        if (existing.fingerprint === fingerprint && existing.totalSize === totalSize) {
          existing.lastActivityAt = Date.now();
          return sendJson(res, 200, {
            uploadId: existing.id,
            filename: existing.filename,
            chunkSize: existing.chunkSize,
            totalChunks: existing.totalChunks,
            receivedChunks: Array.from(existing.receivedChunks),
            resumed: true
          });
        }
      }
    }

    const hasSpace = await this.checkDiskSpace(totalSize);
    if (!hasSpace) {
      return sendJson(res, 507, { error: 'Insufficient disk space in PC save folder' });
    }

    const dest = await this.resolveUniqueDestination(body.filename || 'upload.bin');
    const uploadId = crypto.randomUUID();
    const tempPath = resolveSafePath(this.getTempDir(), `${uploadId}.part`);
    const fh = await fsp.open(tempPath, 'w+');
    const totalChunks = Math.ceil(totalSize / chunkSize);

    const upload = {
      id: uploadId,
      fingerprint,
      filename: dest.filename,
      finalPath: dest.fullPath,
      tempPath,
      fh,
      totalSize,
      chunkSize,
      totalChunks,
      receivedChunks: new Set(),
      receivedBytes: 0,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      lastEmitAt: 0,
      deviceName: session.deviceName,
      writing: Promise.resolve()
    };

    this.uploads.set(uploadId, upload);
    this.emit('transfer:update', this.serializeUpload(upload));

    return sendJson(res, 200, {
      uploadId,
      filename: dest.filename,
      chunkSize,
      totalChunks
    });
  }

  async handleUploadChunk(req, res, uploadId, chunkIndex) {
    const upload = this.uploads.get(uploadId);
    if (!upload) return sendJson(res, 404, { error: 'Upload session not found' });

    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= upload.totalChunks) {
      return sendJson(res, 400, { error: 'Invalid chunk index' });
    }

    const offset = chunkIndex * upload.chunkSize;
    const expectedLen = Math.min(upload.chunkSize, upload.totalSize - offset);
    const contentLength = Number(req.headers['content-length']);

    if (Number.isFinite(contentLength) && contentLength > expectedLen) {
      return sendJson(res, 413, { error: 'Chunk exceeds expected size' });
    }

    const buf = await new Promise((resolve, reject) => {
      const parts = [];
      let len = 0;
      req.on('data', (d) => {
        len += d.length;
        if (len > expectedLen) {
          req.destroy();
          reject(Object.assign(new Error('Chunk overflow'), { statusCode: 413 }));
          return;
        }
        parts.push(d);
      });
      req.on('end', () => resolve(Buffer.concat(parts)));
      req.on('error', reject);
    });

    if (buf.length !== expectedLen) {
      return sendJson(res, 400, { error: `Expected ${expectedLen} bytes, got ${buf.length}` });
    }

    upload.writing = upload.writing.then(async () => {
      await upload.fh.write(buf, 0, buf.length, offset);
      if (!upload.receivedChunks.has(chunkIndex)) {
        upload.receivedChunks.add(chunkIndex);
        upload.receivedBytes += buf.length;
      }
      upload.lastActivityAt = Date.now();
    });
    await upload.writing;

    const now = Date.now();
    if (now - upload.lastEmitAt >= 250 || upload.receivedChunks.size === upload.totalChunks) {
      upload.lastEmitAt = now;
      const progress = this.serializeUpload(upload);
      this.broadcast('transfer:progress', progress);
      this.emit('transfer:update', progress);
    }

    return sendJson(res, 200, {
      receivedBytes: upload.receivedBytes,
      receivedChunks: upload.receivedChunks.size,
      totalChunks: upload.totalChunks
    });
  }

  async handleUploadComplete(req, res, uploadId) {
    const upload = this.uploads.get(uploadId);
    if (!upload) return sendJson(res, 404, { error: 'Upload session not found' });

    let expectedSha256 = '';
    try {
      const body = await readJsonBody(req, 4096);
      if (typeof body.sha256 === 'string') {
        expectedSha256 = body.sha256.trim().toLowerCase();
      }
    } catch {
      // empty body allowed
    }

    await upload.writing;

    if (upload.receivedChunks.size !== upload.totalChunks || upload.receivedBytes !== upload.totalSize) {
      return sendJson(res, 400, {
        error: `Incomplete upload (${upload.receivedChunks.size}/${upload.totalChunks} chunks)`
      });
    }

    await upload.fh.close();

    let sha256Verified = false;
    if (expectedSha256) {
      const actualSha256 = await computeFileSha256(upload.tempPath);
      if (!timingSafeEqualStr(actualSha256, expectedSha256)) {
        this.uploads.delete(uploadId);
        await fsp.rm(upload.tempPath, { force: true }).catch(() => {});
        this.logger?.warn('Upload', `SHA-256 mismatch for ${uploadId}`);
        return sendJson(res, 422, { error: 'SHA-256 checksum mismatch; file discarded' });
      }
      sha256Verified = true;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fsp.rename(upload.tempPath, upload.finalPath);
        break;
      } catch (err) {
        if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempt < 2) {
          this.logger?.warn('Upload', `Rename retry (${attempt + 1}) due to ${err.code}`);
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        } else {
          throw err;
        }
      }
    }
    this.uploads.delete(uploadId);

    const added = await this.addSharedPaths([upload.finalPath], 'phone');
    const summary = {
      id: upload.id,
      direction: 'upload',
      filename: upload.filename,
      filePath: upload.finalPath,
      deviceName: upload.deviceName,
      totalSize: upload.totalSize,
      receivedBytes: upload.totalSize,
      status: 'completed',
      percent: 100
    };
    this.broadcast('transfer:progress', summary);
    this.emit('transfer:update', summary);

    return sendJson(res, 200, { completed: true, sha256Verified, file: added[0] || null });
  }

  async handleUploadCancel(res, uploadId) {
    const upload = this.uploads.get(uploadId);
    if (!upload) return sendJson(res, 404, { error: 'Upload session not found' });

    this.uploads.delete(uploadId);
    try {
      await upload.writing;
      await upload.fh.close();
    } catch {
      // ignore
    }
    await fsp.rm(upload.tempPath, { force: true }).catch(() => {});

    const summary = {
      id: uploadId,
      direction: 'upload',
      filename: upload.filename,
      status: 'cancelled'
    };
    this.emit('transfer:update', summary);
    return sendJson(res, 200, { cancelled: true });
  }

  serializeUpload(upload) {
    const elapsedSec = Math.max(0.1, (Date.now() - upload.startedAt) / 1000);
    const speedBps = upload.receivedBytes / elapsedSec;
    const remainingBytes = Math.max(0, upload.totalSize - upload.receivedBytes);
    const etaSec = speedBps > 0 ? Math.round(remainingBytes / speedBps) : 0;

    return {
      id: upload.id,
      direction: 'upload',
      filename: upload.filename,
      deviceName: upload.deviceName,
      totalSize: upload.totalSize,
      receivedBytes: upload.receivedBytes,
      percent: Math.min(100, Math.round((upload.receivedBytes / upload.totalSize) * 100)),
      speedBps,
      etaSec,
      status: 'active'
    };
  }

  async start() {
    await this.init();

    this.httpServer = this.tlsOptions
      ? https.createServer(this.tlsOptions, (req, res) => this.handleRequest(req, res))
      : http.createServer((req, res) => this.handleRequest(req, res));
    this.httpServer.requestTimeout = 0;
    this.httpServer.keepAliveTimeout = 65_000;
    this.httpServer.headersTimeout = 66_000;

    this.httpServer.on('clientError', (_err, socket) => {
      if (socket.writable) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      }
    });

    this.wss = new WebSocketServer({ noServer: true });
    this.httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      const token = url.searchParams.get('token') || this.getTokenFromRequest(req);
      const session = token ? this.sessions.get(token) : null;
      if (!session) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        ws._bdSessionId = session.id;
        ws._isAlive = true;
        ws.on('pong', () => { ws._isAlive = true; });
        this.wsClients.add(ws);
        ws.on('close', () => this.wsClients.delete(ws));
        ws.on('error', () => this.wsClients.delete(ws));
        ws.send(JSON.stringify({
          type: 'init',
          payload: {
            files: this.getPublicFileList(),
            clipboard: this.clipboard
          }
        }));
      });
    });

    this.wsHeartbeatTimer = setInterval(() => {
      for (const ws of this.wsClients) {
        if (!ws._isAlive) {
          this.wsClients.delete(ws);
          ws.terminate();
          continue;
        }
        ws._isAlive = false;
        try {
          ws.ping();
        } catch {
          // ignore
        }
      }
    }, 25_000);
    this.wsHeartbeatTimer.unref();

    this.cleanupTimer = setInterval(() => {
      const cutoff = Date.now() - 2 * 60 * 60 * 1000;
      for (const [id, up] of this.uploads.entries()) {
        if (up.lastActivityAt < cutoff) {
          this.uploads.delete(id);
          up.fh.close().catch(() => {});
          fsp.rm(up.tempPath, { force: true }).catch(() => {});
        }
      }
    }, 10 * 60 * 1000);
    this.cleanupTimer.unref();

    const listenOn = (port) =>
      new Promise((resolve, reject) => {
        const onError = (err) => {
          this.httpServer.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          this.httpServer.removeListener('error', onError);
          this.port = this.httpServer.address().port;
          resolve(this.port);
        };
        this.httpServer.once('error', onError);
        this.httpServer.once('listening', onListening);
        this.httpServer.listen(port, this.host);
      });

    try {
      return await listenOn(this.port);
    } catch (err) {
      if (err.code === 'EADDRINUSE' && this.port !== 0) {
        return await listenOn(0);
      }
      throw err;
    }
  }

  async stop() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.wsHeartbeatTimer) clearInterval(this.wsHeartbeatTimer);

    for (const up of this.uploads.values()) {
      await up.fh.close().catch(() => {});
      await fsp.rm(up.tempPath, { force: true }).catch(() => {});
    }
    this.uploads.clear();

    for (const ws of this.wsClients) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    this.wsClients.clear();

    if (this.wss) {
      await new Promise((r) => this.wss.close(r));
    }
    if (this.httpServer) {
      await new Promise((r) => this.httpServer.close(r));
    }
  }
}

module.exports = { BeamDropServer, getMimeType };
