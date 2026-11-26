// BeamDrop — Copyright (C) 2026 Atharva Patil (p4inz-code) | https://github.com/p4inz-code/beamdrop
// Licensed under GNU GPL-3.0-or-later. See LICENSE and NOTICE for details.

const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const DEFAULT_SETTINGS = {
  port: 5050,
  saveDir: path.join(os.homedir(), 'Downloads', 'BeamDrop'),
  requireApproval: true,
  useHttps: false,
  enableMdns: true,
  launchAtLogin: false,
  maxConcurrentTransfers: 2,
  ffmpegRemux: false,
  verifySha256: false
};

function sanitizeSettings(raw = {}, fallbackSaveDir = DEFAULT_SETTINGS.saveDir) {
  const portNum = Number(raw.port);
  const port = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535 ? portNum : 5050;

  const concNum = Number(raw.maxConcurrentTransfers);
  const maxConcurrentTransfers = Number.isInteger(concNum) && concNum >= 1 && concNum <= 3 ? concNum : 2;

  const saveDir = typeof raw.saveDir === 'string' && raw.saveDir.trim()
    ? path.resolve(raw.saveDir.trim())
    : fallbackSaveDir;

  return {
    port,
    saveDir,
    requireApproval: typeof raw.requireApproval === 'boolean' ? raw.requireApproval : true,
    useHttps: Boolean(raw.useHttps),
    enableMdns: typeof raw.enableMdns === 'boolean' ? raw.enableMdns : true,
    launchAtLogin: Boolean(raw.launchAtLogin),
    maxConcurrentTransfers,
    ffmpegRemux: Boolean(raw.ffmpegRemux),
    verifySha256: Boolean(raw.verifySha256)
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
