// BeamDrop — Copyright (C) 2026 Atharva Patil (p4inz-code) | https://github.com/p4inz-code/beamdrop
// Licensed under GNU GPL-3.0-or-later. See LICENSE and NOTICE for details.

const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const DEFAULT_SETTINGS = {
  port: 5050,
  saveDir: path.join(os.homedir(), 'Downloads', 'BeamDrop'),
  theme: 'dark',
  requireApproval: true,
  useHttps: false,
  enableMdns: true,
  launchAtLogin: false,
  maxConcurrentTransfers: 2,
  ffmpegRemux: false,
  verifySha256: false
};

function sanitizeSettings(raw = {}, fallbackSaveDir = DEFAULT_SETTINGS.saveDir) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const portNum = Number(r.port);
  const port = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535 ? portNum : 5050;

  const concNum = Number(r.maxConcurrentTransfers);
  const maxConcurrentTransfers = Number.isInteger(concNum) && concNum >= 1 && concNum <= 3 ? concNum : 2;

  const rawDir = typeof r.saveDir === 'string' ? r.saveDir.replace(/[\x00-\x1f\x7f]/g, '').trim() : '';
  const saveDir = rawDir ? path.resolve(rawDir) : fallbackSaveDir;
  const theme = r.theme === 'light' ? 'light' : 'dark';

  return {
    port,
    saveDir,
    theme,
    requireApproval: typeof r.requireApproval === 'boolean' ? r.requireApproval : true,
    useHttps: Boolean(r.useHttps),
    enableMdns: typeof r.enableMdns === 'boolean' ? r.enableMdns : true,
    launchAtLogin: Boolean(r.launchAtLogin),
    maxConcurrentTransfers,
    ffmpegRemux: Boolean(r.ffmpegRemux),
    verifySha256: Boolean(r.verifySha256)
  };
}

class SettingsStore {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.defaults = sanitizeSettings(defaults);
    this.data = { ...this.defaults };
  }

  async load() {
    try {
      const raw = await fsp.readFile(this.filePath, 'utf8');
      this.data = sanitizeSettings(JSON.parse(raw), this.defaults.saveDir);
    } catch {
      this.data = { ...this.defaults };
    }
    return this.get();
  }

  get() {
    return { ...this.data };
  }

  async update(patch = {}) {
    this.data = sanitizeSettings({ ...this.data, ...patch }, this.defaults.saveDir);
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await fsp.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    return this.get();
  }
}

module.exports = { SettingsStore, sanitizeSettings, DEFAULT_SETTINGS };
