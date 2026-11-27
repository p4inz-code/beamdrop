<p align="center">
  <img src="build/icon.png" alt="BeamDrop icon" width="84">
</p>

<h1 align="center">BeamDrop</h1>
<p align="center"><b>Move 64 GB videos, photos, folders, and links between your PC and phone over local Wi-Fi.</b><br>Free, open source, offline first. No cloud, no cables, and no phone app to install.</p>

<p align="center">
  <a href="https://github.com/p4inz-code/beamdrop/releases/latest"><img src="https://img.shields.io/github/v/release/p4inz-code/beamdrop?style=flat-square&labelColor=24211f&color=be3a26&label=release" alt="Latest release"></a>
  <a href="https://github.com/p4inz-code/beamdrop/releases"><img src="https://img.shields.io/github/downloads/p4inz-code/beamdrop/total?style=flat-square&labelColor=24211f&color=be3a26&label=downloads" alt="Total downloads"></a>
  <a href="https://github.com/p4inz-code/beamdrop/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/p4inz-code/beamdrop/ci.yml?style=flat-square&labelColor=24211f&color=be3a26&label=ci" alt="CI status"></a>
  <a href="https://github.com/p4inz-code/beamdrop/stargazers"><img src="https://img.shields.io/github/stars/p4inz-code/beamdrop?style=flat-square&labelColor=24211f&color=be3a26&label=stars" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/p4inz-code/beamdrop?style=flat-square&labelColor=24211f&color=be3a26&label=license" alt="GPLv3 license"></a>
</p>

---

Cloud drives throttle large files, cables are always missing when you need one, and most phone transfer apps are packed with ads or trackers.

**BeamDrop** runs a small, private transfer server directly on your computer. Drop a file or folder into the window, scan the QR code with your phone camera, click **Allow** on your PC, and everything moves at full local Wi-Fi speed—up to **64 GB per file**. Nothing touches the internet and nothing is stored anywhere except your own devices.

<table>
<tr>
<td width="68%" align="center" valign="top">
<img src="docs/screenshots/desktop.png" alt="BeamDrop Desktop App showing the left navigation rail, gallery grid, format badges, and theme toggle" width="100%">
<sub>PC Desktop App · 4-view navigation rail, gallery grid &amp; list, dark &amp; light mode</sub>
</td>
<td width="32%" align="center" valign="top">
<img src="docs/screenshots/mobile.png" alt="BeamDrop Mobile Web App showing 16:9 media cards, play buttons, and bottom navigation" width="100%">
<sub>Phone Browser · 16:9 media cards, in-app player, no install needed</sub>
</td>
</tr>
</table>

---

## Which file should I download?

Pick your system from the [latest release](https://github.com/p4inz-code/beamdrop/releases/latest).

| Your system | Download | Notes |
|---|---|---|
| **Windows 10 / 11 (Recommended)** | `BeamDrop.Setup.<version>.exe` | Installs cleanly, adds Start Menu shortcut, and supports the built-in auto-updater with SHA-256 verification. |
| **Windows (Unpacked Zip)** | `BeamDrop-<version>-win.zip` | Unzip anywhere and run `BeamDrop.exe`. Never unpacks itself into `%TEMP%`, so locked-down PCs and antivirus tools leave it alone. |
| **Windows (Portable)** | `BeamDrop.<version>.exe` | Single executable with no install. |
| **macOS** | `BeamDrop-<version>.dmg` | Open and drag to Applications (unsigned CI build; right-click → Open on first launch). |
| **Linux** | `BeamDrop-<version>.AppImage` or `.deb` | `chmod +x` the AppImage and run, or install the `.deb` package. |

Every release includes `SHA256SUMS-*.txt` so you (and the built-in updater) can verify that a download matches what was built.

---

## What it does

- **Built for huge videos (up to 64 GB per file)**: Zero-copy 8 MB chunk buffers, `1 MB` disk read/write streams, and 4x parallel mobile upload workers keep memory flat (~40–60 MB) while saturating Wi-Fi 5/6 or USB tethering speeds.
- **In-app media viewer on both PC and phone**: Preview **Videos** (MP4, MOV, WebM with automatic `.srt`/`.vtt` subtitle attach, plus optional FFmpeg remux or `Open in VLC`), **Images**, **Audio** (MP3, WAV, FLAC, M4A, OGG), and **Text / Code / Logs** (`.txt`, `.md`, `.json`, `.csv`, `.log`) without leaving the app.
- **1-to-64 Multi-Device Room Mode**: Turn on **Room Mode** under **Connect** so up to **64** phones or laptops can join with the rotating 4-digit PIN and download files or batch `.zip` archives simultaneously.
- **Zero-CPU Folder `.ZIP` downloads**: Select any folder or batch of files and download them as a single `.zip` streamed in `STORE` mode (`level: 0`) so your CPU stays idle.
- **Works on strict Wi-Fi & USB Tethering**: Automatically prioritizes Gigabit USB tethering adapters, surfaces an inline **Fix Firewall** / **Hotspot** banner if LAN access is blocked, and advertises `beamdrop.local` via mDNS.
- **Two-way Text & Links**: Press `Enter` on PC or phone to send links, notes, or snippets back and forth immediately.
- **Private by design**: Rotating 128-bit QR secret, rate-limited 4-digit PIN, explicit PC **Allow / Block** prompt, `User-Agent`-bound tokens, optional local HTTPS (`TLSv1.2+`), **Clear on Quit**, and zero telemetry. See [PRIVACY.md](PRIVACY.md) and [AUDIT_REPORT.md](AUDIT_REPORT.md).

---

## 3-Step Transfer

1. **Drop** videos, photos, audio, or folders anywhere on the BeamDrop PC window.
2. **Scan the QR Code** in the **Connect** tab with your phone camera (or enter the 4-digit PIN).
3. Click **Allow** on your PC, then play, read, or download at full Wi-Fi speed.

---

## Run from source (`Node.js 20+`)

```bash
git clone https://github.com/p4inz-code/beamdrop.git
cd beamdrop
npm install
npm start
```

Run the backend & security suite and the Playwright browser UI suite:

```bash
npm test
npm run test:e2e
```

---

## Documentation

- [Changelog](CHANGELOG.md) · [Roadmap](ROADMAP.md) · [Known Issues](docs/KNOWN_ISSUES.md)
- [Audit Report](AUDIT_REPORT.md) · [Privacy Policy](PRIVACY.md) · [Security Policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md) · [Third-Party Notices](THIRD_PARTY_NOTICES.md)

---

## License

Copyright (C) 2026 Atharva Patil (`p4inz-code`).  
BeamDrop is free software licensed under the [GNU General Public License v3.0 or later](LICENSE).
