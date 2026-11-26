# BeamDrop

**Zero-cloud, FDM-minimal local Wi-Fi file & 2GB+ video transfer app for Windows PC and Mobile (iOS & Android).**

BeamDrop turns your PC into a hardened local transfer hub. Scan a QR code on your phone to stream original-quality 1GB–2GB+ videos, transfer files both ways with chunked resume, download folders as zero-CPU streaming ZIPs, and sync clipboard links—all over your local Wi-Fi or hotspot with zero external servers.

---

## Key Features

- **2GB+ Chunked Resumable Uploads (Phone → PC)**: Files slice into 8 MB chunks and write directly to disk at byte offsets—RAM stays flat (~40 MB) with automatic retry, pause/resume, and disk-space pre-checks (`statfs`).
- **Instant Video Streaming (`HTTP 206 Partial Content`)**: Scrub and play 1GB–2GB+ MP4/MOV/WebM videos directly on your phone without waiting for full downloads, or download at full LAN speed.
- **Zero-CPU Streaming ZIP**: Download entire folders or multi-file batches as `.zip` using `STORE` mode (`level: 0`) so your PC stays cool and transfers at full Wi-Fi bandwidth.
- **Security-First Local Pairing**:
  - QR Code + cryptographically random 4-digit PIN (`crypto.randomInt`)
  - Per-IP rate limiting & lockout (`PinRateLimiter`) against brute-force attempts
  - Explicit PC `[Allow] / [Block]` device approval prompt
  - 256-bit `HttpOnly; SameSite=Strict` session tokens & authenticated WebSockets
  - Strict path sanitization (`sanitizeFilename`, `resolveSafePath`) & XSS-safe DOM rendering
- **Live Clipboard & Link Sync**: Instant two-way text/URL drop over WebSockets.
- **Zero-Install Mobile PWA**: Works in Safari/Chrome on iOS & Android and can be added to the Home Screen.

---

## Architecture

```mermaid
flowchart LR
    PC["Electron Desktop App (Windows)"] -->|Serves Mobile PWA + API| Phone["Phone Browser / PWA"]
    Phone -->|8MB Chunked Upload + Retry| Disk["Save Folder (.beamdrop_tmp -> Final)"]
    PC -->|HTTP 206 Range / Stream ZIP| Phone
    PC <-->|WebSocket Sync (Auth Token)| Phone
```

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Launch the Desktop App
npm start

# 3. Run the automated security & integration test suite
npm test
```

> **Windows Firewall Note**: On first launch, allow **Private networks** in Windows Defender Firewall so your phone can reach the local server over Wi-Fi/Hotspot.

---

## License

Licensed under the **GNU General Public License v3.0 (GPL-3.0-or-later)**. See [LICENSE](LICENSE) for details.
