<p align="center">
  <img src="build/icon.png" alt="BeamDrop Icon" width="76">
</p>

<h1 align="center">BeamDrop</h1>
<p align="center"><b>Direct 30 GB wireless video &amp; file transfer between PC and phone.</b><br>Zero cloud. Zero cables. Zero phone app to install.</p>

<p align="center">
  <a href="https://github.com/p4inz-code/beamdrop/releases/latest"><img src="https://img.shields.io/github/v/release/p4inz-code/beamdrop?style=flat-square&labelColor=0c0c0e&color=3b82f6&label=release" alt="Latest Release"></a>
  <a href="https://github.com/p4inz-code/beamdrop/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/p4inz-code/beamdrop/ci.yml?style=flat-square&labelColor=0c0c0e&color=10b981&label=ci" alt="CI Status"></a>
  <a href="https://github.com/p4inz-code/beamdrop/stargazers"><img src="https://img.shields.io/github/stars/p4inz-code/beamdrop?style=flat-square&labelColor=0c0c0e&color=f4f4f5&label=stars" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/p4inz-code/beamdrop?style=flat-square&labelColor=0c0c0e&color=e11d48&label=license" alt="GPLv3 License"></a>
  <a href="https://discord.gg/8UKt8s5FbW"><img src="https://img.shields.io/badge/discord-join-5865F2?style=flat-square&labelColor=0c0c0e" alt="Discord"></a>
</p>

---

Cloud drives throttle large uploads, cables are never around when you need them, and mobile transfer apps are bloated with ads and tracking.

**BeamDrop** turns your PC into a high-speed local transfer server that any phone or browser can use immediately. Scan the QR code, click **Allow** on your PC, and move **up to 30 GB** 4K videos, photo folders, and links at full local Wi-Fi speed—with zero external servers and zero data leaving your network.

> **Status: v1.4.0 — Audited, red-team tested, and ready for daily use on Windows** (with CI builds for macOS & Linux).
> See [Audit Report](AUDIT_REPORT.md), [Known Issues](docs/KNOWN_ISSUES.md), and [Roadmap](ROADMAP.md).

---

## Interface

<table>
<tr>
<td width="68%" align="center">
<sub>Desktop App (Custom Frameless UI · Dark &amp; Light Mode)</sub><br><br>
<img src="docs/screenshots/desktop.png" alt="BeamDrop Desktop App showing QR code, 4-digit PIN, network controls, connected devices, and shared files" width="100%">
</td>
<td width="32%" align="center">
<sub>Phone &amp; Browser Web App</sub><br><br>
<img src="docs/screenshots/mobile.png" alt="BeamDrop Mobile Web UI showing shared files, video player, photo viewer, and bottom navigation" width="100%">
</td>
</tr>
</table>

---

## Why Engineers & Creators Use BeamDrop

- **Built for 2 GB – 30 GB Videos**: Zero-copy 8 MB chunk buffers, `1 MB` disk stream buffers, and 4x parallel upload workers keep RAM flat (~40–60 MB) while saturating Wi-Fi 5/6 bandwidth.
- **Instant Browser Video Streaming**: Scrub and play MP4, MOV, and WebM videos directly from your PC (`HTTP 206` byte-range), or tap **Open in VLC** / **Play MKV** for non-browser codecs.
- **Zero-CPU Folder `.ZIP` Streaming**: Download entire folders or multi-file selections as a single `.zip` streamed in `STORE` mode (`level: 0`) so your computer stays cool.
- **Hardened Local Security**:
  - Rotating 128-bit QR secret + rate-limited 4-digit PIN (`PinRateLimiter` with monotonic clock) + explicit PC **Allow / Block** prompt
  - `User-Agent`-bound session tokens, one-time challenge pickup, `Origin` CSRF checks, and optional `TLSv1.2+` local HTTPS
  - Path traversal, Unicode BiDi spoofing, symlink-loop, and TOCTOU overwrite protection
- **Zero-Jitter Everyday UX**: Dark & Light themes, 100% custom controls (no native OS widgets), `Enter`-to-send text & links, and 1-click **Fix Firewall** + **Hotspot** tools.

---

## Quick Start

### Option 1: Download Prebuilt App
Grab the installer or plain `.zip` for **Windows**, **macOS**, or **Linux** from [GitHub Releases](https://github.com/p4inz-code/beamdrop/releases/latest).

### Option 2: Run From Source (`Node.js 20+`)
```bash
git clone https://github.com/p4inz-code/beamdrop.git
cd beamdrop
npm install
npm start
```

### 3-Step Transfer
1. **Drop** videos, photos, or folders anywhere on the BeamDrop PC window.
2. **Scan the QR Code** with your phone camera (or copy the one-tap link / enter the PIN).
3. Click **Allow** on your PC, then tap **Play Video**, **Download**, or **Download .ZIP**.

---

## Project Docs

- [Changelog](CHANGELOG.md) — Release history (`v1.4.0`, `v1.3.0`, `v1.2.0`, `v1.0.0`)
- [Audit Report](AUDIT_REPORT.md) — Security, performance & red-team verification
- [Privacy Policy](PRIVACY.md) — Zero-telemetry, local-only data guarantee
- [Known Issues](docs/KNOWN_ISSUES.md) — Network & codec workarounds
- [Roadmap](ROADMAP.md) — Upcoming milestones
- [Security Policy](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

---

## Copyright & License

**Copyright (C) 2026 Atharva Patil (`p4inz-code`). All rights reserved.**
Built by **[Atharva Patil | P4inz](https://github.com/p4inz-code)** — *Open-source software, creative tools & experimental technology.*

Licensed under the **GNU General Public License v3.0 (GPL-3.0-or-later)**. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
