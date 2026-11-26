const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const WebSocket = require('ws');

const { BeamDropServer } = require('../src/server');
const { sanitizeFilename, resolveSafePath, isSafeHttpUrl, PinRateLimiter } = require('../src/security');
const { SettingsStore } = require('../src/settings');
const { DiagnosticsLogger } = require('../src/logger');
const { probeLanReachability, getOrCreateLocalCert } = require('../src/network');

test('Security: isSafeHttpUrl allows http/https and blocks javascript/data/file URLs', () => {
  assert.equal(isSafeHttpUrl('https://github.com/p4inz-code/beamdrop'), true);
  assert.equal(isSafeHttpUrl('http://192.168.1.10:5050'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isSafeHttpUrl('file:///C:/Windows/System32'), false);
});

test('Security: sanitizeFilename blocks traversal, null bytes, and Windows reserved names', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('..\\..\\Windows\\System32\\cmd.exe'), 'cmd.exe');
  assert.equal(sanitizeFilename('bad\x00name.mp4'), 'bad_name.mp4');
  assert.equal(sanitizeFilename('CON.txt'), '_CON.txt');
  assert.equal(sanitizeFilename('...'), 'unnamed_file');
});

test('Security: resolveSafePath blocks directory escape', () => {
  const base = path.join(os.tmpdir(), 'beamdrop_safe_base');
  const ok = resolveSafePath(base, 'video.mp4');
  assert.ok(ok.startsWith(path.resolve(base)));
  assert.throws(() => resolveSafePath(base, '../escape.txt'), /Path traversal/);
});

test('Security: PinRateLimiter locks out after maxAttempts', () => {
  const limiter = new PinRateLimiter({ maxAttempts: 3, windowMs: 10_000, lockoutMs: 10_000 });
  assert.equal(limiter.isLocked('1.2.3.4').locked, false);
  limiter.recordFailure('1.2.3.4');
  limiter.recordFailure('1.2.3.4');
  const third = limiter.recordFailure('1.2.3.4');
  assert.equal(third.locked, true);
  assert.equal(limiter.isLocked('1.2.3.4').locked, true);
  limiter.recordSuccess('1.2.3.4');
  assert.equal(limiter.isLocked('1.2.3.4').locked, false);
});

test('Integration: Auth, PIN rate limit, Approval, Chunked Upload SHA-256, 206 Range, ZIP, and WS', async (t) => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'beamdrop-test-'));
  const saveDir = path.join(tmpRoot, 'save');
  const shareDir = path.join(tmpRoot, 'share');
  await fsp.mkdir(shareDir, { recursive: true });

  const server = new BeamDropServer({
    port: 0,
    host: '127.0.0.1',
    saveDir,
    pin: '4829',
    requireApproval: true,
    maxPinAttempts: 3
  });

  const port = await server.start();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await server.stop();
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  // 1. Unauthenticated access rejected
  const unauthFiles = await fetch(`${baseUrl}/api/files`);
  assert.equal(unauthFiles.status, 401);

  // 2. Unauthenticated WebSocket rejected
  await assert.rejects(
    () =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=badtoken`);
        ws.on('open', () => resolve());
        ws.on('error', (err) => reject(err));
      })
  );

  // 3. Brute-force PIN rate limiting
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${baseUrl}/api/auth/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '0000', deviceName: 'Attacker' })
    });
    assert.equal(r.status, 401);
  }
  const lockedRes = await fetch(`${baseUrl}/api/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '4829', deviceName: 'Attacker' })
  });
  assert.equal(lockedRes.status, 429);

  // Reset rate limiter for valid pairing test
  server.rateLimiter.records.clear();

  // 4. Valid PIN + PC Approval flow
  const pairRes = await fetch(`${baseUrl}/api/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '4829', deviceName: 'TestPhone' })
  });
  assert.equal(pairRes.status, 202);
  const pairData = await pairRes.json();
  assert.equal(pairData.status, 'pending');

  const pendingStatus = await (await fetch(`${baseUrl}/api/auth/status?challengeId=${pairData.challengeId}`)).json();
  assert.equal(pendingStatus.status, 'pending');

  assert.equal(server.approveChallenge(pairData.challengeId, true), true);
  const approvedStatus = await (await fetch(`${baseUrl}/api/auth/status?challengeId=${pairData.challengeId}`)).json();
  assert.equal(approvedStatus.status, 'approved');
  const token = approvedStatus.token;
  assert.ok(token && token.length === 64);

  const authHeaders = { Authorization: `Bearer ${token}` };

  // 5. WebSocket connection + live clipboard broadcast
  const wsEvents = [];
  const ws = await new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    client.on('open', () => resolve(client));
    client.on('error', reject);
  });
  ws.on('message', (raw) => wsEvents.push(JSON.parse(raw.toString())));

  const clipRes = await fetch(`${baseUrl}/api/clipboard`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'https://example.com/video' })
  });
  assert.equal(clipRes.status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(wsEvents.some((e) => e.type === 'clipboard:updated'));
  ws.close();

  // 6. Chunked upload with traversal filename + SHA-256 verification
  const payload = crypto.randomBytes(250 * 1024); // 250 KB across 4 x 64KB chunks
  const expectedHash = crypto.createHash('sha256').update(payload).digest('hex');

  const initRes = await fetch(`${baseUrl}/api/upload/init`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: '../../evil_video.mp4',
      totalSize: payload.length,
      chunkSize: 64 * 1024
    })
  });
  assert.equal(initRes.status, 200);
  const initData = await initRes.json();
  assert.equal(initData.filename, 'evil_video.mp4');
  assert.equal(initData.totalChunks, 4);

  // Reject out-of-bounds chunk index
  const badChunk = await fetch(`${baseUrl}/api/upload/chunk/${initData.uploadId}/99`, {
    method: 'PUT',
    headers: authHeaders,
    body: Buffer.from('abc')
  });
  assert.equal(badChunk.status, 400);

  // Upload all 4 chunks
  for (let i = 0; i < initData.totalChunks; i++) {
    const start = i * initData.chunkSize;
    const end = Math.min(start + initData.chunkSize, payload.length);
    const slice = payload.subarray(start, end);
    const cRes = await fetch(`${baseUrl}/api/upload/chunk/${initData.uploadId}/${i}`, {
      method: 'PUT',
      headers: authHeaders,
      body: slice
    });
    assert.equal(cRes.status, 200);
  }

  const compRes = await fetch(`${baseUrl}/api/upload/complete/${initData.uploadId}`, {
    method: 'POST',
    headers: authHeaders
  });
  assert.equal(compRes.status, 200);
  const compData = await compRes.json();
  assert.equal(compData.completed, true);

  const savedPath = path.join(saveDir, 'evil_video.mp4');
  const savedBytes = await fsp.readFile(savedPath);
  const actualHash = crypto.createHash('sha256').update(savedBytes).digest('hex');
  assert.equal(actualHash, expectedHash);

  // 7. HTTP 206 Partial Content Range streaming
  const fileId = compData.file.id;
  const rangeRes = await fetch(`${baseUrl}/api/files/${fileId}/stream`, {
    headers: { ...authHeaders, Range: 'bytes=100-199' }
  });
  assert.equal(rangeRes.status, 206);
  assert.equal(rangeRes.headers.get('content-range'), `bytes 100-199/${payload.length}`);
  const rangeBuf = Buffer.from(await rangeRes.arrayBuffer());
  assert.deepEqual(rangeBuf, payload.subarray(100, 200));

  // Invalid Range -> 416
  const badRangeRes = await fetch(`${baseUrl}/api/files/${fileId}/stream`, {
    headers: { ...authHeaders, Range: `bytes=${payload.length + 10}-` }
  });
  assert.equal(badRangeRes.status, 416);

  // 8. Batch ZIP streaming via ?token= query + verify ZIP end-of-central-directory & filename entry
  const zipRes = await fetch(`${baseUrl}/api/zip?ids=${fileId}&token=${encodeURIComponent(token)}`);
  assert.equal(zipRes.status, 200);
  assert.equal(zipRes.headers.get('content-type'), 'application/zip');
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  assert.equal(zipBuf.subarray(0, 4).toString('binary'), 'PK\x03\x04');
  // Verify End of Central Directory signature (PK\x05\x06) and embedded filename
  assert.ok(zipBuf.includes(Buffer.from('PK\x05\x06', 'binary')));
  assert.ok(zipBuf.includes(Buffer.from('evil_video.mp4', 'utf8')));
  // Verify STORE mode (uncompressed payload bytes exist intact inside ZIP)
  assert.ok(zipBuf.includes(payload.subarray(0, 1024)));

  // 9. Cross-origin CSRF protection
  const csrfRes = await fetch(`${baseUrl}/api/clipboard`, {
    method: 'POST',
    headers: { ...authHeaders, Origin: 'http://evil.attacker.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'csrf' })
  });
  assert.equal(csrfRes.status, 403);

  // 10. Upload status & fingerprint resume + 16MB multi-chunk stress test
  const stressBuf = crypto.randomBytes(16 * 1024 * 1024); // 16 MB across 4 x 4MB chunks
  const stressHash = crypto.createHash('sha256').update(stressBuf).digest('hex');
  const fingerprint = 'large_video.mp4:16777216:12345';
  const sInit = await (await fetch(`${baseUrl}/api/upload/init`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'large_video.mp4', totalSize: stressBuf.length, chunkSize: 4 * 1024 * 1024, fingerprint })
  })).json();

  // Upload chunk 0, verify fingerprint resume returns resumed: true + receivedChunks: [0]
  await fetch(`${baseUrl}/api/upload/chunk/${sInit.uploadId}/0`, {
    method: 'PUT',
    headers: authHeaders,
    body: stressBuf.subarray(0, 4 * 1024 * 1024)
  });
  const resumedInit = await (await fetch(`${baseUrl}/api/upload/init`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'large_video.mp4', totalSize: stressBuf.length, chunkSize: 4 * 1024 * 1024, fingerprint })
  })).json();
  assert.equal(resumedInit.resumed, true);
  assert.equal(resumedInit.uploadId, sInit.uploadId);
  assert.deepEqual(resumedInit.receivedChunks, [0]);

  for (let i = 1; i < 4; i++) {
    const start = i * 4 * 1024 * 1024;
    await fetch(`${baseUrl}/api/upload/chunk/${sInit.uploadId}/${i}`, {
      method: 'PUT',
      headers: authHeaders,
      body: stressBuf.subarray(start, start + 4 * 1024 * 1024)
    });
  }
  const sComp = await (await fetch(`${baseUrl}/api/upload/complete/${sInit.uploadId}`, {
    method: 'POST',
    headers: authHeaders
  })).json();
  assert.equal(sComp.completed, true);
  const stressSavedHash = crypto.createHash('sha256').update(await fsp.readFile(path.join(saveDir, 'large_video.mp4'))).digest('hex');
  assert.equal(stressSavedHash, stressHash);

  // 11. Outgoing PC -> Phone download tracking event
  const dlEvents = [];
  server.on('transfer:update', (ev) => {
    if (ev.direction === 'download') dlEvents.push(ev);
  });
  const dlRes = await fetch(`${baseUrl}/api/files/${sComp.file.id}/download`, { headers: authHeaders });
  assert.equal(dlRes.status, 200);
  await dlRes.arrayBuffer();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(dlEvents.some((e) => e.status === 'completed' && e.receivedBytes === stressBuf.length));

  // 12. QR Secret pairing + per-session kick + orphan .part cleanup
  const badQrRes = await fetch(`${baseUrl}/api/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qrSecret: 'wrong-qr-secret', deviceName: 'BadQR' })
  });
  assert.equal(badQrRes.status, 401);
  server.rateLimiter.records.clear();

  const qrPairRes = await fetch(`${baseUrl}/api/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qrSecret: server.qrSecret, deviceName: 'QRPhone' })
  });
  assert.equal(qrPairRes.status, 202);
  const qrPairData = await qrPairRes.json();
  assert.equal(server.approveChallenge(qrPairData.challengeId, true), true);
  const qrStatus = await (await fetch(`${baseUrl}/api/auth/status?challengeId=${qrPairData.challengeId}`)).json();
  assert.equal(qrStatus.status, 'approved');

  const sessionsBeforeKick = server.getActiveSessions();
  const qrSess = sessionsBeforeKick.find((s) => s.deviceName === 'QRPhone');
  assert.ok(qrSess);
  assert.equal(server.revokeSessionById(qrSess.id), true);
  const kickedCheck = await fetch(`${baseUrl}/api/files`, {
    headers: { Authorization: `Bearer ${qrStatus.token}` }
  });
  assert.equal(kickedCheck.status, 401);

  // 13. Parallel out-of-order chunk upload (simulating 3-worker mobile upload)
  const parBuf = crypto.randomBytes(12 * 1024 * 1024); // 12 MB = 3 x 4MB
  const parHash = crypto.createHash('sha256').update(parBuf).digest('hex');
  const pInit = await (await fetch(`${baseUrl}/api/upload/init`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'parallel.mp4', totalSize: parBuf.length, chunkSize: 4 * 1024 * 1024 })
  })).json();
  await Promise.all([2, 0, 1].map((idx) =>
    fetch(`${baseUrl}/api/upload/chunk/${pInit.uploadId}/${idx}`, {
      method: 'PUT',
      headers: authHeaders,
      body: parBuf.subarray(idx * 4 * 1024 * 1024, (idx + 1) * 4 * 1024 * 1024)
    }).then((r) => assert.equal(r.status, 200))
  ));
  const pComp = await (await fetch(`${baseUrl}/api/upload/complete/${pInit.uploadId}`, {
    method: 'POST',
    headers: authHeaders
  })).json();
  assert.equal(pComp.completed, true);
  const parSavedHash = crypto.createHash('sha256').update(await fsp.readFile(path.join(saveDir, 'parallel.mp4'))).digest('hex');
  assert.equal(parSavedHash, parHash);

  // 14. 0-byte empty file upload support
  const zeroInit = await (await fetch(`${baseUrl}/api/upload/init`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'empty.txt', totalSize: 0 })
  })).json();
  assert.equal(zeroInit.totalChunks, 0);
  const zeroComp = await (await fetch(`${baseUrl}/api/upload/complete/${zeroInit.uploadId}`, {
    method: 'POST',
    headers: authHeaders
  })).json();
  assert.equal(zeroComp.completed, true);
  assert.equal((await fsp.stat(path.join(saveDir, 'empty.txt'))).size, 0);

  // 15. Trusted Device flow + stale challenge rejection on PIN regen + clearSharedItems
  const staleRes = await (await fetch(`${baseUrl}/api/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: server.pin, deviceName: 'StalePhone' })
  })).json();
  server.regeneratePin();
  const staleStatus = await (await fetch(`${baseUrl}/api/auth/status?challengeId=${staleRes.challengeId}`)).json();
  assert.equal(staleStatus.status, 'rejected');

  const trustPair = await (await fetch(`${baseUrl}/api/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: server.pin, deviceName: 'TrustedPixel' })
  })).json();
  assert.equal(server.approveChallenge(trustPair.challengeId, true, true), true);
  const trustStatus = await (await fetch(`${baseUrl}/api/auth/status?challengeId=${trustPair.challengeId}`)).json();
  assert.ok(trustStatus.trustKey);

  // Reconnect using trustKey (no PIN, no approval prompt)
  const autoTrust = await fetch(`${baseUrl}/api/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trustKey: trustStatus.trustKey, deviceName: 'TrustedPixel' })
  });
  assert.equal(autoTrust.status, 200);
  const autoTrustData = await autoTrust.json();
  assert.equal(autoTrustData.trusted, true);

  const trustedList = server.getTrustedDevices();
  assert.equal(trustedList.length, 1);
  assert.equal(await server.revokeTrustedDevice(trustedList[0].id), true);
  assert.equal(server.getTrustedDevices().length, 0);

  server.clearSharedItems();
  assert.equal(server.getPublicFileList().length, 0);

  // 16. Session revocation
  server.revokeAllSessions();
  const afterRevoke = await fetch(`${baseUrl}/api/files`, { headers: authHeaders });
  assert.equal(afterRevoke.status, 401);
});

test('Resilience: Server falls back cleanly on EADDRINUSE port conflict', async (t) => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'beamdrop-port-'));
  const s1 = new BeamDropServer({ port: 0, host: '127.0.0.1', saveDir: tmpRoot });
  const occupiedPort = await s1.start();

  const s2 = new BeamDropServer({ port: occupiedPort, host: '127.0.0.1', saveDir: tmpRoot });
  const fallbackPort = await s2.start();
  assert.notEqual(fallbackPort, occupiedPort);
  assert.ok(fallbackPort > 0);

  await s2.stop();
  await s1.stop();
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

test('v1.3.0: SettingsStore, DiagnosticsLogger, HTTPS TLS, and Upload SHA-256 verification', async (t) => {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'beamdrop-v13-'));
  t.after(async () => {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  // 1. SettingsStore sanitization & persistence
  const store = new SettingsStore(path.join(tmpRoot, 'settings.json'));
  await store.load();
  const updated = await store.update({ port: 99999, maxConcurrentTransfers: 3, useHttps: true });
  assert.equal(updated.port, 5050); // clamped invalid port
  assert.equal(updated.maxConcurrentTransfers, 3);
  assert.equal(updated.useHttps, true);

  // 2. DiagnosticsLogger
  const logger = new DiagnosticsLogger(path.join(tmpRoot, 'logs'));
  await logger.init();
  await logger.info('Test', 'Diagnostics check');
  const report = await logger.getDiagnosticsReport({ version: '1.3.0', port: 5050, useHttps: true });
  assert.ok(report.includes('BeamDrop Diagnostics (v1.3.0)'));
  assert.ok(report.includes('Diagnostics check'));

  // 3. Local HTTPS cert + BeamDropServer TLS + probeLanReachability
  const tlsOptions = await getOrCreateLocalCert(path.join(tmpRoot, 'certs'), ['127.0.0.1']);
  assert.ok(tlsOptions.key && tlsOptions.cert);

  const tlsServer = new BeamDropServer({
    port: 0,
    host: '127.0.0.1',
    saveDir: path.join(tmpRoot, 'save'),
    tlsOptions,
    pin: '1234',
    requireApproval: false
  });
  const tlsPort = await tlsServer.start();
  t.after(() => tlsServer.stop());

  const reachable = await probeLanReachability('127.0.0.1', tlsPort, true);
  assert.equal(reachable, true);

  // 4. End-to-end SHA-256 verification (valid + mismatch 422)
  const httpServer = new BeamDropServer({
    port: 0,
    host: '127.0.0.1',
    saveDir: path.join(tmpRoot, 'save2'),
    pin: '4321',
    requireApproval: false
  });
  const httpPort = await httpServer.start();
  t.after(() => httpServer.stop());
  const base = `http://127.0.0.1:${httpPort}`;

  const pair = await (await fetch(`${base}/api/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '4321' })
  })).json();
  const headers = { Authorization: `Bearer ${pair.token}` };

  const buf = crypto.randomBytes(128 * 1024);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');

  // Mismatch -> 422
  const badInit = await (await fetch(`${base}/api/upload/init`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'bad_sha.bin', totalSize: buf.length })
  })).json();
  await fetch(`${base}/api/upload/chunk/${badInit.uploadId}/0`, { method: 'PUT', headers, body: buf });
  const badComp = await fetch(`${base}/api/upload/complete/${badInit.uploadId}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256: '0'.repeat(64) })
  });
  assert.equal(badComp.status, 422);

  // Valid -> 200 sha256Verified: true
  const okInit = await (await fetch(`${base}/api/upload/init`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'ok_sha.bin', totalSize: buf.length })
  })).json();
  await fetch(`${base}/api/upload/chunk/${okInit.uploadId}/0`, { method: 'PUT', headers, body: buf });
  const okComp = await (await fetch(`${base}/api/upload/complete/${okInit.uploadId}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256: sha })
  })).json();
  assert.equal(okComp.completed, true);
  assert.equal(okComp.sha256Verified, true);
});
