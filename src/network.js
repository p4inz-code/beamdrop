const os = require('os');

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
  'tun',
  'tap'
];

const WIFI_KEYWORDS = ['wi-fi', 'wifi', 'wlan', 'wireless', 'hotspot', 'local area connection*'];

/**
 * Score a network interface so physical Wi-Fi / Hotspot / LAN adapters
 * are prioritized over virtual adapters.
 */
function scoreInterface(name, address) {
  const lower = name.toLowerCase();
  if (VIRTUAL_KEYWORDS.some((kw) => lower.includes(kw))) return -100;

  let score = 0;
  if (WIFI_KEYWORDS.some((kw) => lower.includes(kw))) score += 50;
  if (lower.includes('ethernet')) score += 30;

  // Prefer standard private LAN subnets
  if (address.startsWith('192.168.')) score += 20;
  else if (address.startsWith('10.')) score += 15;
  else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) score += 10;

  // Link-local 169.254.x.x is unusable for normal Wi-Fi sharing
  if (address.startsWith('169.254.')) score -= 80;

  return score;
}

/**
 * Enumerate usable IPv4 interfaces sorted by relevance.
 * @returns {{ interfaces: Array<{name: string, address: string, score: number}>, recommended: {name: string, address: string, score: number} | null }}
 */
function getNetworkInterfaces() {
  const raw = os.networkInterfaces();
  const list = [];

  for (const [name, entries] of Object.entries(raw)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family === 'IPv4' && !info.internal) {
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
    recommended: list[0] || { name: 'localhost', address: '127.0.0.1', score: 0 }
  };
}

module.exports = { getNetworkInterfaces, scoreInterface };
