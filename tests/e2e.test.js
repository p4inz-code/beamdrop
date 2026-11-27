'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { chromium } = require('playwright-core');
const { BeamDropServer } = require('../src/server');
const { SettingsStore } = require('../src/settings');

function findBrowserExecutable() {
  const candidates = [
    process.env.BEAMDROP_BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

test('Mobile Web UI E2E: PIN pairing, 16:9 media cards, search/filter, modal preview, and Enter-to-send clipboard', async (t) => {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    t.skip('No Chromium/Edge/Chrome executable found for E2E test');
    return;
  }

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'beamdrop-e2e-'));
  const saveDir = path.join(tmpRoot, 'saves');
  const cfgDir = path.join(tmpRoot, 'cfg');
  await fsp.mkdir(saveDir, { recursive: true });
  await fsp.mkdir(cfgDir, { recursive: true });

  // Create a 1x1 valid PNG, dummy MP4, dummy MP3, and a text file to share from PC
  const pngPath = path.join(tmpRoot, 'photo.png');
  const mp4Path = path.join(tmpRoot, 'clip.mp4');
  const mp3Path = path.join(tmpRoot, 'track.mp3');
  const txtPath = path.join(tmpRoot, 'notes.txt');
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  await fsp.writeFile(pngPath, tinyPng);
  await fsp.writeFile(mp4Path, Buffer.from('00000018667479706d703432', 'hex'));
  await fsp.writeFile(mp3Path, Buffer.from('49443303000000000000', 'hex'));
  await fsp.writeFile(txtPath, 'BeamDrop universal viewer check');

  const settings = new SettingsStore(cfgDir, saveDir);
  await settings.load();
  const server = new BeamDropServer({
    port: 0,
    saveDir,
    settings,
    appVersion: '1.4.0'
  });

  // Auto-approve pairing challenges like the PC host approval prompt
  server.on('auth:challenge', (req) => {
    setTimeout(() => {
      server.approveChallenge(req.id, true);
    }, 50);
  });

  let browser;
  try {
    const port = await server.start();
    await server.addSharedPaths([pngPath, mp4Path, mp3Path, txtPath], 'pc');

    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();

    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });

    // 1. Enter 4-digit PIN in .pin-digit inputs (4th digit auto-submits pairing)
    const pinDigits = server.pin.split('');
    const pinInputs = page.locator('.pin-digit');
    assert.equal(await pinInputs.count(), 4);
    for (let i = 0; i < 4; i++) {
      await pinInputs.nth(i).fill(pinDigits[i]);
    }

    // Wait for main view to unlock after challenge approval
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10000 });
    await page.waitForSelector('.media-card', { timeout: 10000 });

    // 2. Verify 16:9 media-first cards render all 4 shared files
    const cardCount = await page.locator('.media-card').count();
    assert.equal(cardCount, 4);
    const bannerCount = await page.locator('.media-banner').count();
    assert.equal(bannerCount, 4);

    // 2b. Verify Audio & Text in-app viewers
    await page.click('.media-card button:has-text("Listen")');
    await page.waitForSelector('#audio-modal:not(.hidden)', { timeout: 5000 });
    await page.click('#btn-close-audio');
    await page.waitForSelector('#audio-modal', { state: 'hidden', timeout: 5000 });

    await page.click('.media-card button:has-text("Read")');
    await page.waitForSelector('#text-modal:not(.hidden)', { timeout: 5000 });
    await page.waitForFunction(
      () => document.querySelector('#text-preview')?.textContent?.includes('BeamDrop universal viewer check'),
      { timeout: 5000 }
    );
    await page.click('#btn-close-text');
    await page.waitForSelector('#text-modal', { state: 'hidden', timeout: 5000 });

    // 3. Filter by Image and Search
    await page.click('.pill[data-filter="image"]');
    assert.equal(await page.locator('.media-card').count(), 1);
    assert.ok((await page.locator('.media-card .row-title').first().textContent()).includes('photo.png'));

    // 4. Open Image Preview Modal
    await page.click('.media-card button:has-text("View Image")');
    await page.waitForSelector('#image-modal:not(.hidden)', { timeout: 5000 });
    await page.click('#btn-close-image');
    await page.waitForSelector('#image-modal', { state: 'hidden', timeout: 5000 });

    // Reset filter and test search box
    await page.click('.pill[data-filter="all"]');
    await page.fill('#file-search', 'clip');
    assert.equal(await page.locator('.media-card').count(), 1);
    assert.ok((await page.locator('.media-card .row-title').first().textContent()).includes('clip.mp4'));
    await page.fill('#file-search', '');

    // 5. Switch to Text & Links tab and test Enter-to-send clipboard
    await page.click('.nav-btn[data-tab="clipboard"]');
    await page.waitForSelector('#tab-clipboard.active', { timeout: 5000 });
    await page.fill('#clip-input', 'Hello from Playwright E2E');
    await page.press('#clip-input', 'Enter');

    await page.waitForFunction(
      () => document.querySelector('#clip-list')?.textContent?.includes('Hello from Playwright E2E'),
      { timeout: 5000 }
    );
  } finally {
    if (browser) await browser.close();
    await server.stop();
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('UI Icon & Alignment Audit: Lucide round caps, centered buttons, zero overflow (Desktop & Mobile)', async (t) => {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    t.skip('No Chromium/Edge/Chrome executable found for alignment audit');
    return;
  }

  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });

    // Audit 1: Desktop Renderer (1240x820)
    const deskCtx = await browser.newContext({ viewport: { width: 1240, height: 820 } });
    const deskPage = await deskCtx.newPage();
    await deskPage.addInitScript(() => {
      window.beamdrop = {
        getState: async () => ({
          url: 'http://192.168.1.10:5050',
          mdnsUrl: 'http://beamdrop.local:5050',
          qrUrl: 'http://192.168.1.10:5050/?q=demo',
          qrDataUrl: '',
          pin: '1234',
          port: 5050,
          localBaseUrl: 'http://127.0.0.1:5050',
          localPreviewToken: '',
          useHttps: false,
          lanReachable: true,
          vpnDetected: false,
          ffmpegAvailable: false,
          settings: { port: 5050, enableMdns: true, useHttps: false, launchAtLogin: false, ffmpegRemux: false, checkUpdatesOnStartup: true },
          requireApproval: true,
          saveDir: 'C:\\Users\\Demo\\Downloads\\BeamDrop',
          interfaces: [],
          selectedAddress: '192.168.1.10',
          files: [],
          sessions: [],
          trustedDevices: [],
          clipboard: []
        }),
        onStateChanged: () => {},
        onTransferUpdate: () => {},
        onApprovalRequest: () => {},
        onUpdaterStatus: () => {},
        onUpdaterProgress: () => {}
      };
    });

    const deskPath = 'file:///' + path.resolve(__dirname, '../src/renderer/index.html').replace(/\\/g, '/');
    await deskPage.goto(deskPath, { waitUntil: 'domcontentloaded' });
    await deskPage.waitForTimeout(250);

    const deskAudit = await deskPage.evaluate(() => {
      const issues = [];
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
        issues.push(`Horizontal overflow: ${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth}`);
      }
      for (const svg of document.querySelectorAll('svg')) {
        const rect = svg.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue; // hidden
        if (svg.getAttribute('stroke-linecap') !== 'round' || svg.getAttribute('stroke-linejoin') !== 'round') {
          issues.push(`SVG missing round linecap/linejoin: ${svg.parentElement?.id || svg.parentElement?.className}`);
        }
        const btn = svg.closest('button');
        if (btn) {
          const bRect = btn.getBoundingClientRect();
          const iconCy = rect.top + rect.height / 2;
          const btnCy = bRect.top + bRect.height / 2;
          if (Math.abs(iconCy - btnCy) > 2.5) {
            issues.push(`Vertical misalignment in ${btn.id || btn.className}: diff=${(iconCy - btnCy).toFixed(2)}px`);
          }
          if (btn.classList.contains('win-btn') || btn.classList.contains('btn-icon') || btn.classList.contains('btn-icon-xs')) {
            const iconCx = rect.left + rect.width / 2;
            const btnCx = bRect.left + bRect.width / 2;
            if (Math.abs(iconCx - btnCx) > 2.5) {
              issues.push(`Horizontal misalignment in ${btn.id || btn.className}: diff=${(iconCx - btnCx).toFixed(2)}px`);
            }
          }
        }
      }
      return issues;
    });
    assert.deepEqual(deskAudit, [], `Desktop alignment/icon issues: ${deskAudit.join('; ')}`);

    // Audit 2: Mobile Web UI (390x844)
    const mobCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobPage = await mobCtx.newPage();
    const mobPath = 'file:///' + path.resolve(__dirname, '../src/mobile/index.html').replace(/\\/g, '/');
    await mobPage.goto(mobPath, { waitUntil: 'domcontentloaded' });
    await mobPage.waitForTimeout(200);

    const mobAudit = await mobPage.evaluate(() => {
      const issues = [];
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
        issues.push(`Mobile horizontal overflow: ${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth}`);
      }
      for (const svg of document.querySelectorAll('svg')) {
        const rect = svg.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (svg.getAttribute('stroke-linecap') !== 'round' || svg.getAttribute('stroke-linejoin') !== 'round') {
          issues.push(`Mobile SVG missing round linecap/linejoin: ${svg.parentElement?.id || svg.parentElement?.className}`);
        }
      }
      return issues;
    });
    assert.deepEqual(mobAudit, [], `Mobile alignment/icon issues: ${mobAudit.join('; ')}`);
  } finally {
    if (browser) await browser.close();
  }
});
