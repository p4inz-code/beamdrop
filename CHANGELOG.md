# Changelog

All notable changes to **BeamDrop** are documented in this file.

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
