# BeamDrop Roadmap

## v1.0.0 (Shipped)
- [x] Custom frameless Electron desktop app with System Tray & drag-and-drop
- [x] 3x parallel 8 MB chunked uploads (Phone $\rightarrow$ PC) with fingerprint resume & Wake Lock
- [x] `HTTP 206 Partial Content` byte-range video streaming & scrubbing (PC $\rightarrow$ Phone)
- [x] Zero-CPU `STORE` streaming `.zip` for folders & multi-file batches
- [x] QR Code (`Level Q` + 128-bit `qrSecret`), 4-digit PIN with rate limiting, and PC `[Allow / Block]` prompt
- [x] Two-way live Clipboard sync with HTTP fallback

---

## v1.2.0 (Planned)
- [ ] **mDNS (`beamdrop.local`)**: Zero-IP discovery on local Wi-Fi
- [ ] **Optional Local HTTPS**: Self-signed local cert for native PWA install & `navigator.clipboard`
- [ ] **Trusted Device Memory**: Optional 1-tap reconnect for previously approved devices
- [ ] **`powerSaveBlocker`**: Prevent PC sleep during active 2GB+ transfers
- [ ] **Cross-Platform Installers**: Windows `.exe` (NSIS + Portable), macOS `.dmg`, and Linux `.AppImage` via `electron-builder` + GitHub Actions
- [ ] **Symlink & Long-Path Guards**: Skip symlinks during ZIP streaming and support Windows `\\?\` paths

---

## v2.0.0 (Future)
- [ ] Optional hardware-accelerated video transcoding (NVENC / QuickSync) for MKV/HEVC playback on older phones
- [ ] Two-way watched folder sync
- [ ] Multi-phone room broadcast
