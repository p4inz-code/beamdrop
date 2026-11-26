// BeamDrop — Copyright (C) 2026 Atharva Patil (p4inz-code) | https://github.com/p4inz-code/beamdrop
// Licensed under GNU GPL-3.0-or-later. See LICENSE and NOTICE for details.

const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB rotation

class DiagnosticsLogger {
  constructor(logDir) {
    this.logDir = logDir;
    this.logFile = path.join(logDir, 'beamdrop.log');
    this.backupFile = path.join(logDir, 'beamdrop.log.1');
    this.queue = Promise.resolve();
    this.recentLines = [];
  }

  async init() {
    await fsp.mkdir(this.logDir, { recursive: true });
  }

  log(level, component, message) {
    const cleanMsg = String(message || '').replace(/[\r\n]+/g, ' ').slice(0, 400);
    const line = `[${new Date().toISOString()}] [${String(level).toUpperCase()}] [${component}] ${cleanMsg}`;
    this.recentLines.push(line);
    if (this.recentLines.length > 60) this.recentLines.shift();

    this.queue = this.queue.then(async () => {
      try {
        await fsp.mkdir(this.logDir, { recursive: true });
        try {
          const st = await fsp.stat(this.logFile);
          if (st.size >= MAX_LOG_BYTES) {
            await fsp.rm(this.backupFile, { force: true }).catch(() => {});
            await fsp.rename(this.logFile, this.backupFile).catch(() => {});
          }
        } catch {
          // file doesn't exist yet
        }
        await fsp.appendFile(this.logFile, line + '\n', 'utf8');
      } catch {
        // never throw from logger
      }
    });
    return this.queue;
  }

  info(component, message) {
    return this.log('INFO', component, message);
  }

  warn(component, message) {
    return this.log('WARN', component, message);
  }

  error(component, message) {
    return this.log('ERROR', component, message);
  }

  async getDiagnosticsReport({ version = '1.3.0', port = 5050, useHttps = false, interfaces = [] } = {}) {
    await this.queue;
    const adapterSummary = interfaces.map((i) => `${i.name} (score=${i.score})`).join(', ') || 'none';
    return [
      `BeamDrop Diagnostics (v${version})`,
      `OS: ${os.type()} ${os.release()} (${os.arch()})`,
      `Node: ${process.version} | Electron: ${process.versions.electron || 'N/A'}`,
      `Protocol: ${useHttps ? 'HTTPS' : 'HTTP'} | Port: ${port}`,
      `Adapters: ${adapterSummary}`,
      `--- Recent Events (${this.recentLines.length}) ---`,
      ...this.recentLines
    ].join('\n');
  }
}

module.exports = { DiagnosticsLogger, MAX_LOG_BYTES };
