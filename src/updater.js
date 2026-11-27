// BeamDrop — Copyright (C) 2026 Atharva Patil (p4inz-code) | https://github.com/p4inz-code/beamdrop
// Licensed under GNU GPL-3.0-or-later. See LICENSE and NOTICE for details.

const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

function parseSemver(v) {
  const clean = String(v || '').replace(/^v/i, '').split('-')[0];
  const parts = clean.split('.').map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function isNewerVersion(latest, current) {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function selectAssetForPlatform(assets = [], platform = process.platform, arch = process.arch) {
  if (!Array.isArray(assets)) return { installer: null, checksums: null };

  let installer = null;
  let checksums = null;

  if (platform === 'win32') {
    installer =
      assets.find((a) => /Setup.*\.exe$/i.test(a.name)) ||
      assets.find((a) => /\.exe$/i.test(a.name));
    checksums = assets.find((a) => /SHA256SUMS-windows/i.test(a.name));
  } else if (platform === 'darwin') {
    installer =
      (arch === 'arm64' && assets.find((a) => /arm64.*\.dmg$/i.test(a.name))) ||
      assets.find((a) => /\.dmg$/i.test(a.name));
    checksums = assets.find((a) => /SHA256SUMS-macos/i.test(a.name));
  } else {
    installer =
      assets.find((a) => /\.AppImage$/i.test(a.name)) ||
      assets.find((a) => /\.deb$/i.test(a.name));
    checksums = assets.find((a) => /SHA256SUMS-ubuntu/i.test(a.name));
  }

  return { installer: installer || null, checksums: checksums || null };
}

function parseSha256Sums(text, targetFilename) {
  if (typeof text !== 'string' || !targetFilename) return null;
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (match && path.basename(match[2].trim()) === targetFilename) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

function fetchText(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'BeamDrop-Updater/1.4', Accept: 'application/vnd.github+json' },
        timeout: 12_000
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
          res.resume();
          if (!/^https:\/\//i.test(res.headers.location)) {
            return reject(new Error('Blocked non-HTTPS redirect'));
          }
          return resolve(fetchText(res.headers.location, maxRedirects - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        let total = 0;
        res.on('data', (d) => {
          total += d.length;
          if (total > 2 * 1024 * 1024) {
            req.destroy();
            return reject(new Error('Response exceeds 2 MB limit'));
          }
          chunks.push(d);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

class AppUpdater extends EventEmitter {
  constructor({ repo = 'p4inz-code/beamdrop', currentVersion = '1.4.0', downloadDir } = {}) {
    super();
    this.repo = repo;
    this.currentVersion = currentVersion;
    this.downloadDir = downloadDir;
    this.latestRelease = null;
    this.downloadedPath = null;
    this.pendingInstallOnQuit = false;
    this.activeReq = null;
    this.cancelled = false;
  }

  async checkForUpdates() {
    const apiUrl = `https://api.github.com/repos/${this.repo}/releases/latest`;
    const raw = await fetchText(apiUrl);
    const data = JSON.parse(raw);
    const latestVersion = String(data.tag_name || '').replace(/^v/i, '');
    const available = Boolean(latestVersion) && isNewerVersion(latestVersion, this.currentVersion);
    const { installer, checksums } = selectAssetForPlatform(data.assets || []);

    this.latestRelease = {
      available,
      currentVersion: this.currentVersion,
      latestVersion,
      name: data.name || `v${latestVersion}`,
      notes: data.body || '',
      htmlUrl: data.html_url || `https://github.com/${this.repo}/releases/latest`,
      installer,
      checksums
    };

    this.emit('status', { state: available ? 'available' : 'up-to-date', release: this.latestRelease });
    return this.latestRelease;
  }

  cancelDownload() {
    this.cancelled = true;
    if (this.activeReq) {
      this.activeReq.destroy();
      this.activeReq = null;
    }
    this.emit('status', { state: 'cancelled' });
  }

  async downloadUpdate() {
    if (!this.latestRelease || !this.latestRelease.installer) {
      throw new Error('No downloadable installer found for this OS');
    }

    this.cancelled = false;
    await fsp.mkdir(this.downloadDir, { recursive: true });
    const asset = this.latestRelease.installer;
    const destPath = path.join(this.downloadDir, path.basename(asset.name));
    const partPath = `${destPath}.part`;

    let expectedSha = null;
    if (this.latestRelease.checksums) {
      try {
        const sumText = await fetchText(this.latestRelease.checksums.browser_download_url);
        expectedSha = parseSha256Sums(sumText, asset.name);
      } catch {
        // checksum file optional if unavailable
      }
    }

    const downloadStream = (url, redirects = 5) =>
      new Promise((resolve, reject) => {
        const req = https.get(
          url,
          { headers: { 'User-Agent': 'BeamDrop-Updater/1.4' }, timeout: 30_000 },
          (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
              res.resume();
              if (!/^https:\/\//i.test(res.headers.location)) {
                return reject(new Error('Blocked non-HTTPS redirect'));
              }
              return resolve(downloadStream(res.headers.location, redirects - 1));
            }
            if (res.statusCode !== 200) {
              res.resume();
              return reject(new Error(`Download failed (HTTP ${res.statusCode})`));
            }

            const totalBytes = Number(res.headers['content-length']) || asset.size || 0;
            let downloadedBytes = 0;
            const startedAt = Date.now();
            let lastEmit = 0;
            const hash = crypto.createHash('sha256');
            const out = fs.createWriteStream(partPath);

            res.on('data', (chunk) => {
              if (this.cancelled) {
                req.destroy();
                return;
              }
              downloadedBytes += chunk.length;
              hash.update(chunk);
              const now = Date.now();
              if (now - lastEmit >= 150) {
                lastEmit = now;
                const elapsed = Math.max(0.1, (now - startedAt) / 1000);
                const speedBps = downloadedBytes / elapsed;
                const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
                this.emit('progress', { percent, downloadedBytes, totalBytes, speedBps });
              }
            });

            out.on('finish', async () => {
              if (this.cancelled) {
                await fsp.rm(partPath, { force: true }).catch(() => {});
                return reject(new Error('Download cancelled'));
              }
              const actualSha = hash.digest('hex').toLowerCase();
              if (expectedSha && actualSha !== expectedSha) {
                await fsp.rm(partPath, { force: true }).catch(() => {});
                return reject(new Error('SHA-256 verification failed; update discarded'));
              }
              await fsp.rm(destPath, { force: true }).catch(() => {});
              await fsp.rename(partPath, destPath);
              this.downloadedPath = destPath;
              this.emit('progress', {
                percent: 100,
                downloadedBytes,
                totalBytes: totalBytes || downloadedBytes,
                speedBps: 0
              });
              this.emit('status', {
                state: 'downloaded',
                filePath: destPath,
                sha256Verified: Boolean(expectedSha)
              });
              resolve({ filePath: destPath, sha256Verified: Boolean(expectedSha) });
            });

            out.on('error', reject);
            res.on('error', reject);
            res.pipe(out);
          }
        );
        this.activeReq = req;
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Download timed out'));
        });
      });

    return downloadStream(asset.browser_download_url);
  }
}

module.exports = {
  AppUpdater,
  isNewerVersion,
  selectAssetForPlatform,
  parseSha256Sums
};
