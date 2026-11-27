# Changelog

All notable changes to **BeamDrop** are documented in this file.

## [1.5.2] - 2026-11-27

### Performance, Contrast & Legal Polish
- **Backend Performance & Long Paths**: Parallelized `pruneMissingSharedItems()` with `Promise.all()`, standardized `toLongPath()` and `1 MB` `highWaterMark` streams across full & `206 Range` downloads, and throttled transfer list DOM updates (`120ms`).
- **Smooth Controls & High-Contrast Readability**: Added click-outside-to-close on all PC & Mobile modals, disabled browser link/image drag-ghosting (`-webkit-user-drag: none`), and darkened Light/Dark muted text and borders for crisp legibility.
- **Legal, Developer Info & Privacy Alignment**: Expanded the **About** modal with full copyright, developer links (`atharvapatil.tech`), Security, Privacy, License, and Third-Party Notices links, and updated `PRIVACY.md` to accurately disclose the optional GitHub Releases update check.

## [1.5.1] - 2026-11-27

### Wellbeing, Updater & Architectural UI
- **Real-Time Backend Wellbeing (`getWellbeingReport()` / `/api/wellbeing`)**: Clickable titlebar status (**Active**, **Secured**, **Connected · N**, **Check Firewall**, **Low Disk**) opens the live **System Wellbeing** modal inspecting Server, LAN/Firewall, Save Folder free space & writability (`statfs`), Upload pipeline, mDNS/FFmpeg, and RSS memory.
- **Polished Software Update UI**: Fixed a null-element reference in `runUpdateCheck()`, added version transition & size pills, `SHA-256 Verified` badge, live ETA (`s left`), `Cancel` recovery, and `Releases` fallback link.
- **Sharp Architectural UI**: Replaced rounded/beveled cards and `999px` pills with crisp `2px–4px` geometry, deeper monochrome surfaces (`#080809` / `#101012` / `#232327`), and plain `Active` / `Secured` / `Connected` status labels.

## [1.5.0] - 2026-11-27

### Setup, Bridge & Media
- **Inline Firewall & Network Health Banner**: Automatically surfaces a 1-click **Fix Firewall** / **Hotspot** prompt when the local LAN probe detects blocked ports.
- **Room / Event Mode (`64` Devices)**: Increased concurrent session limit from 32 to **64**, with an optional **Room Mode (PIN auto-accept)** toggle under **Connect**.
- **USB Tethering Priority (`src/network.js`)**: Automatically ranks Android/iPhone USB-tethered adapters (`192.168.42.x`, `172.20.10.x`, RNDIS) above Wi-Fi for Gigabit wired browser transfers.
- **Subtitle Auto-Attach (`.srt` / `.vtt`)**: Automatically pairs matching `.vtt` or `.srt` files next to shared videos, converts `.srt` to WebVTT on the fly, and attaches them in both PC and Mobile players.
- **Clear Shared List on Quit & Single-Instance Open-With**: Added `clearOnQuit` in Settings and `second-instance` CLI/file argument handling so launching with file paths adds them directly to the running window.
- **Official Lucide Icons & Linear Motion**: Replaced all inline UI icons with official ISC/MIT Lucide SVGs (`stroke-linecap="round"`), fixed the Help/About `?` dot, added subtle linear UI animations, and tracked `build/icon.png` + `build/icon.svg`.

## [1.4.2] - 2026-11-27

### Interface & In-App Viewers
- **4-View Desktop Navigation Rail**: Rebuilt the PC app around a `210px` left rail (`Share`, `Connect`, `Transfers`, `Text & Links`), `1240×820` default window with remembered bounds, Gallery Grid & Compact List toggle, batch remove, and a 3-step onboarding empty state.
- **Mobile 16:9 Media-First Cards**: Redesigned phone file cards with 16:9 image/video preview banners, format pills, multi-select checkboxes, and a helpful empty state with a 1-tap `Send Files to PC` button.
- **Universal In-App Media Viewer (PC & Mobile)**: Added in-app playback and reading for **Video** (MP4/MOV/WebM + optional FFmpeg remux), **Images**, **Audio** (MP3/WAV/FLAC/M4A/OGG), and **Text & Code** (`.txt`, `.md`, `.json`, `.log`, `.csv`, etc., range-capped at 512 KB).
- **64 GB Per-File Limit**: Increased maximum file transfer size from 30 GB to **64 GB**.

### Auto-Updater & Verification
- **Built-In GitHub Releases Auto-Updater (`src/updater.js`)**: Checks `p4inz-code/beamdrop` releases on startup (toggleable in Settings) or manually, verifies downloads against `SHA256SUMS-*.txt`, shows live `%` and `MB/s` progress, and lets you **Install Now** or **Install When I Quit**.
- **Playwright E2E UI Suite (`tests/e2e.test.js`)**: Automated end-to-end browser test covering PIN pairing, 16:9 media cards, audio/text/image modals, search/filter, and `Enter`-to-send clipboard.
- **Loopback Guard on Preview Token**: Restricted `localPreviewToken` strictly to `127.0.0.1` `GET /api/files/:id/stream` requests.

## [1.4.0] - 2026-11-27

### Performance & Engineering
- **Zero-Copy Chunk Buffers**: `PUT /api/upload/chunk` writes directly into pre-allocated chunk buffers when `Content-Length` matches, eliminating intermediate `Buffer.concat()` copies across 30 GB uploads.
- **`O(1)` Shared Path Indexing**: Added `sharedByPath` map for instant duplicate checks when sharing large folders.
- **1 MB Stream Buffers & 4x Parallel Chunks**: Increased disk `highWaterMark` to `1 MB`, set `maxRequestsPerSocket = 0`, and bumped mobile upload concurrency to 4 workers.
- **Smart 5s Sync**: Background 5-second health/adapter sync now pushes Electron IPC updates only when adapters, reachability, or file existence actually change.

### UI, Security & Branding
- **Clean Monochrome Desktop & Mobile UI**: Removed SaaS/indigo styling tropes for a fast, neutral `#0c0c0e` utility design with Dark & Light themes, 100% custom form controls (zero native OS spin arrows/selects), bigger `184×184` QR, and zero-jitter mobile refresh.
- **New App Icon (`build/icon.png`)**: Updated 512×512 geometric transfer-beam mark.
- **Hardening & Red-Team Fixes**: 30 GB file size cap, `User-Agent`-bound session tokens, `TLSv1.2+`, one-time challenge token pickup, TOCTOU filename reservation (`reservedPaths`), malformed `Host` guard, and `ff.stderr` deadlock fix.

## [1.3.0] - 2026-11-27

### Added
- **Branded App Icon (`build/icon.png`)**: Custom 512×512 lightning icon bundled across Windows, macOS, Linux, and System Tray.
- **Persistent Settings Store (`src/settings.js`)**: Saves custom port, Save Folder, mDNS, local HTTPS, Launch at Login, and FFmpeg remux preferences in `userData/settings.json`.
- **Rotating Diagnostics Logger (`src/logger.js`)**: 5 MB rotating log (`userData/logs/beamdrop.log`) with 1-click **Copy Diagnostics** in Settings (zero PII/filenames).
- **Zero-Friction Discovery & Network Tools**:
  - **mDNS (`beamdrop.local`)** via `bonjour-service`
  - **Optional Dual HTTP + Local HTTPS** (`selfsigned` SAN cert)
  - **Auto-Adapter Watcher** (5s diff check), **LAN Reachability Self-Probe**, & **VPN Detector**
  - **1-Click Windows Firewall Helper** (`Allow Firewall`) & **Mobile Hotspot Shortcut** (`Hotspot`)
- **Pro Media & Integrity**:
  - **`Open in VLC`** deep link for `.mkv`/`.avi`/`.flv` files on mobile
  - **Optional Zero-Reencode FFmpeg Remux (`/api/files/:id/remux`)**: Streams MKV/AVI as fragmented MP4 (`-c:v copy -c:a aac`)
  - **End-to-End SHA-256 Upload Verification**: Optional `sha256` check on `/api/upload/complete/:id` (`422` on mismatch)
  - **Windows Long Path (`\\?\`)** support in directory `.zip` streaming
- **Power-User UX**: PC **Settings Modal**, **Fullscreen QR Modal**, keyboard shortcuts (`Ctrl+O`, `Ctrl+Shift+O`, `Ctrl+F`, `Esc`), Mobile **Select All** & queue summary.
- **Plain `.zip` Windows Release & Multi-OS CI**: Added `zip` target (`BeamDrop-1.3.0-win.zip`), `SHA256SUMS` generation, and multi-OS CI matrix (`ubuntu-latest`, `windows-latest`, `macos-latest`).

## [1.2.0] - 2026-11-26

### Added
- **Trusted Device Memory**: Approve a phone with **Allow & Trust** to save a cryptographic `trustKey` (`trusted_devices.json`) for 1-tap reconnect on future sessions, with a **Forget** button in the PC sidebar.
- **Prevent PC Sleep (`powerSaveBlocker`)**: Automatically keeps the PC awake while any 1GB–2GB+ upload or download is active.
- **Full-Window Drag & Drop**: Drop files or folders anywhere on the BeamDrop PC window.
- **Clipboard & Productivity**: Added **Paste & Send** (1-click OS clipboard push), `Enter`-to-send on PC & Mobile, `Enter` to submit PIN, and safe `https?://` clickable **Open / Open Link** buttons.
- **Shared Queue & Upload Controls**: Added **Clear All** on Shared Files, **Show in Folder** on completed uploads, and native desktop notifications when large uploads finish while minimized to Tray.
- **Mobile Resilience**: Added **In-App WebView Detector** (prompts to open in Safari/Chrome for full-speed 2GB downloads) and 50-item pagination (`Show More`).
- **Cross-Platform Packaging & CI**: Added `electron-builder` targets (Windows `.exe` NSIS/Portable, macOS `.dmg`, Linux `.AppImage`/`.deb`) and `.github/workflows/release.yml`.
- **Quality & Audit Docs**: Added `AUDIT_REPORT.md` (30/30 on `vibe-coding-checklist`), `CONTRIBUTING.md`, `SECURITY.md`, `ROADMAP.md`, and `docs/KNOWN_ISSUES.md`.

### Security & Fixes
- **Monotonic Rate Limiter**: `PinRateLimiter` now uses `process.hrtime.bigint()` so system clock changes cannot bypass lockouts.
- **Symlink & Junction Guard**: `appendDirectorySafe()` checks `fsp.lstat()` and skips symlinks during `.zip` streaming.
- **0-Byte Files & `EBUSY` Rename Retry**: Added 0-byte empty file upload support and 3x backoff retry on `.part` atomic rename if antivirus is scanning.
- **Stale Challenge Cleanup**: Regenerating the PIN immediately rejects any pending approval requests.
- **Safe URL Validation**: `isSafeHttpUrl()` blocks `javascript:`, `data:`, and `file:` URLs in clipboard cards.

---

## [1.0.0] - 2026-11-26

### Added
- Custom frameless Electron desktop app with System Tray, monochrome SVG UI, and strict sandboxing (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
- 3x parallel 8 MB chunked uploads (`Phone -> PC`) with fingerprint resume, Pause/Resume/Cancel, Wake Lock, and `statfs` disk-space pre-checks.
- `HTTP 206 Partial Content` byte-range video streaming & scrubbing (`PC -> Phone`) + Zero-CPU `STORE` streaming `.zip`.
- `Level Q` QR Code with 128-bit `qrSecret`, Instant Connect Link, rate-limited 4-digit PIN, and PC `[Allow / Block]` prompt.
- Two-way live Clipboard sync with legacy HTTP copy fallback.
