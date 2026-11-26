// BeamDrop — Copyright (C) 2026 Atharva Patil (p4inz-code) | https://github.com/p4inz-code/beamdrop
// Licensed under GNU GPL-3.0-or-later. See LICENSE and NOTICE for details.

const os = require('os');
const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const VIRTUAL_KEYWORDS = [
  'vethernet',
  'wsl',
  'hyper-v',
  'vmware',
  'virtualbox',
  'vbox',
  'docker',
  'tailscale',
  'zerotier',
  'loopback',
  'hamachi',
  'wireguard',
  'nordlynx',
  'proton',
  'warp',
  'tun',
  'tap'
];

const VPN_KEYWORDS = ['tailscale', 'zerotier', 'wireguard', 'nordlynx', 'proton', 'warp', 'openvpn', 'tun', 'tap'];
const WIFI_KEYWORDS = ['wi-fi', 'wifi', 'wlan', 'wireless', 'hotspot', 'local area connection*'];

function scoreInterface(name, address) {
  const lower = name.toLowerCase();
  if (VIRTUAL_KEYWORDS.some((kw) => lower.includes(kw))) return -100;

  let score = 0;
  if (WIFI_KEYWORDS.some((kw) => lower.includes(kw))) score += 50;
  if (lower.includes('ethernet')) score += 30;

  if (address.startsWith('192.168.')) score += 20;
  else if (address.startsWith('10.')) score += 15;
  else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) score += 10;

  if (address.startsWith('169.254.')) score -= 80;
  return score;
}

function getNetworkInterfaces() {
  const raw = os.networkInterfaces();
  const list = [];
  const vpnNames = [];

  for (const [name, entries] of Object.entries(raw)) {
    if (!entries) continue;
    const lower = name.toLowerCase();
    for (const info of entries) {
      if (info.family === 'IPv4' && !info.internal) {
        if (VPN_KEYWORDS.some((kw) => lower.includes(kw))) {
          vpnNames.push(name);
        }
        list.push({
          name,
          address: info.address,
          score: scoreInterface(name, info.address)
        });
      }
    }
  }

  list.sort((a, b) => b.score - a.score);
  return {
    interfaces: list,
    recommended: list[0] || { name: 'localhost', address: '127.0.0.1', score: 0 },
    vpnDetected: vpnNames.length > 0,
    vpnNames
  };
}

function probeLanReachability(ip, port, useHttps = false) {
  return new Promise((resolve) => {
    const mod = useHttps ? https : http;
    const req = mod.get(
      {
        hostname: ip,
        port,
        path: '/api/health',
        timeout: 1500,
        rejectUnauthorized: false
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

class MdnsAdvertiser {
  constructor() {
    this.bonjour = null;
    this.service = null;
  }

  start({ port, useHttps = false }) {
    this.stop();
    try {
      const { Bonjour } = require('bonjour-service');
      this.bonjour = new Bonjour();
      this.service = this.bonjour.publish({
        name: 'BeamDrop',
        type: useHttps ? 'https' : 'http',
        port,
        host: 'beamdrop.local'
      });
      this.service.on('error', () => {});
    } catch {
      // mDNS optional; ignore if UDP 5353 is unavailable
    }
  }

  stop() {
    try {
      if (this.service && typeof this.service.stop === 'function') {
        this.service.stop();
      }
      if (this.bonjour && typeof this.bonjour.destroy === 'function') {
        this.bonjour.destroy();
      }
    } catch {
      // ignore
    }
    this.service = null;
    this.bonjour = null;
  }
}

async function getOrCreateLocalCert(certDir, ipAddresses = []) {
  await fsp.mkdir(certDir, { recursive: true });
  const keyPath = path.join(certDir, 'beamdrop-key.pem');
  const certPath = path.join(certDir, 'beamdrop-cert.pem');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const [key, cert] = await Promise.all([
      fsp.readFile(keyPath, 'utf8'),
      fsp.readFile(certPath, 'utf8')
    ]);
    return { key, cert };
  }

  const selfsigned = require('selfsigned');
  const altNames = [
    { type: 2, value: 'beamdrop.local' },
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' }
  ];
  for (const ip of ipAddresses) {
    if (ip && ip !== '127.0.0.1') {
      altNames.push({ type: 7, ip });
    }
  }

  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: 'BeamDrop Local' }],
    {
      days: 365,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames }]
    }
  );

  await fsp.writeFile(keyPath, pems.private, 'utf8');
  await fsp.writeFile(certPath, pems.cert, 'utf8');
  return { key: pems.private, cert: pems.cert };
}

module.exports = {
  getNetworkInterfaces,
  scoreInterface,
  probeLanReachability,
  MdnsAdvertiser,
  getOrCreateLocalCert
};
