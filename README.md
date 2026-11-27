<p align="center">
  <img src="build/icon.png" alt="BeamDrop icon" width="84">
</p>

<h1 align="center">BeamDrop</h1>
<p align="center"><b>Send 64 GB videos, folders, audio, and links between your PC and phone over local Wi-Fi.</b><br>Free, open source, offline first. No cloud, no cables, and nothing to install on your phone.</p>

<p align="center">
  <a href="https://github.com/p4inz-code/beamdrop/releases/latest"><img src="https://img.shields.io/github/v/release/p4inz-code/beamdrop?style=flat-square&labelColor=24211f&color=be3a26&label=release" alt="Latest release"></a>
  <a href="https://github.com/p4inz-code/beamdrop/releases"><img src="https://img.shields.io/github/downloads/p4inz-code/beamdrop/total?style=flat-square&labelColor=24211f&color=be3a26&label=downloads" alt="Total downloads"></a>
  <a href="https://github.com/p4inz-code/beamdrop/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/p4inz-code/beamdrop/ci.yml?style=flat-square&labelColor=24211f&color=be3a26&label=ci" alt="CI status"></a>
  <a href="https://github.com/p4inz-code/beamdrop/stargazers"><img src="https://img.shields.io/github/stars/p4inz-code/beamdrop?style=flat-square&labelColor=24211f&color=be3a26&label=stars" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/p4inz-code/beamdrop?style=flat-square&labelColor=24211f&color=be3a26&label=license" alt="GPLv3 license"></a>
</p>

---

Sending a 10 GB video to your phone shouldn't require uploading it to a cloud drive, hunting for a USB cable, or installing an ad-filled app.

BeamDrop runs a small transfer server right on your computer. Drop files or folders into the window, point your phone camera at the QR code, click **Allow** on your PC, and everything moves at full local Wi-Fi (or USB tethering) speed—up to **64 GB per file**. Nothing leaves your own network.

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
| **Windows 10 / 11 (Recommended)** | `BeamDrop.Setup.<version>.exe` | Installs cleanly with a Start Menu shortcut and supports the built-in SHA-256 auto-updater. |
| **Windows (Unpacked Zip)** | `BeamDrop-<version>-win.zip` | Unzip anywhere and run `BeamDrop.exe`. Never unpacks itself into `%TEMP%`, so strict antivirus tools and locked-down PCs leave it alone. |
| **Windows (Portable)** | `BeamDrop.<version>.exe` | Single executable, no install needed. |
| **macOS** | `BeamDrop-<version>.dmg` | Open and drag to Applications (unsigned CI build; right-click → Open the first time). |
| **Linux** | `BeamDrop-<version>.AppImage` or `.deb` | `chmod +x` the AppImage and run it, or install the `.deb` package. |

Every release includes `SHA256SUMS-*.txt` so you (and the built-in updater) can verify that your download matches what was built.

---

## How it works

1. **Drop files or folders** anywhere on the BeamDrop window (even before any phone is connected).
2. **Scan the QR code** in the **Connect** tab with your phone camera, or type the 4-digit PIN.
3. **Click Allow** on your PC, then play, read, or download right in your phone's browser.

---

## Built for real-world files

- **Large files without choking RAM**: Zero-copy 8 MB chunks, `1 MB` disk streams, and 4x parallel mobile upload workers handle files up to **64 GB** while keeping memory around 40–60 MB.
- **Play and read inside the app**: Stream videos (MP4, MOV, WebM with automatic `.srt`/`.vtt` subtitles, plus optional FFmpeg remux or `Open in VLC` for MKV/AVI), view photos, listen to audio (MP3, WAV, FLAC, M4A, OGG), and read text/code/logs (`.txt`, `.md`, `.json`, `.csv`, `.log`) on both PC and phone.
- **One PC to a whole room**: Flip on **Room Mode** under **Connect** to let up to **64** phones or laptops join with the 4-digit PIN and grab files or zero-CPU `.zip` folders at the same time.
- **Strict Wi-Fi & USB tethering**: Automatically prioritizes Android/iPhone USB tethering adapters for wired Gigabit speeds, advertises `beamdrop.local` via mDNS, and surfaces a 1-click **Fix Firewall** / **Hotspot** banner if Windows blocks your LAN port.
- **Two-way text & links**: Press `Enter` on your PC or phone to send links, snippets, or notes back and forth immediately.

---

## Private by design

BeamDrop makes no internet requests except the optional GitHub Releases update check (which you can turn off in Settings). Every session uses a rotating 128-bit QR secret or rate-limited 4-digit PIN, `User-Agent`-bound tokens, optional local HTTPS (`TLSv1.2+`), and an optional **Clear Shared List on Quit** setting.

Read [PRIVACY.md](PRIVACY.md) and [AUDIT_REPORT.md](AUDIT_REPORT.md) for the full details.

---

## Run from source (`Node.js 20+`)

```bash
git clone https://github.com/p4inz-code/beamdrop.git
cd beamdrop
npm install
npm start
```

Run the backend/security suite and the Playwright browser UI + alignment suite:

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
