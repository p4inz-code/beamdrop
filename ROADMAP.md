# BeamDrop Roadmap

## v1.0.0 (Shipped)
- [x] Custom frameless Electron desktop app with System Tray & drag-and-drop
- [x] 3x parallel 8 MB chunked uploads (Phone $\rightarrow$ PC) with fingerprint resume & Wake Lock
- [x] `HTTP 206 Partial Content` byte-range video streaming & scrubbing (PC $\rightarrow$ Phone)
- [x] Zero-CPU `STORE` streaming `.zip` for folders & multi-file batches
- [x] QR Code (`Level Q` + 128-bit `qrSecret`), 4-digit PIN with rate limiting, and PC `[Allow / Block]` prompt
- [x] Two-way live Clipboard sync with HTTP fallback

---

## v1.2.0 (Shipped)
- [x] **Trusted Device Memory**: 1-tap reconnect via cryptographic `trustKey` + `Forget` management
- [x] **`powerSaveBlocker`**: Prevent PC sleep during active 2GB+ transfers
- [x] **Symlink & `EBUSY` Guards**: Skip symlinks (`lstat`) in `.zip` streams + 3x rename retry + 0-byte upload support
- [x] **Monotonic Rate Limiter**: `process.hrtime.bigint()` clock immunity
- [x] **UX Polish**: `tabular-nums`, full-window drag & drop, `Clear All`, `Show in Folder`, `Paste & Send`, clickable safe `https?://` clipboard links, In-App WebView detector, and 50-item pagination
- [x] **Cross-Platform Packaging**: `electron-builder` (Windows `.exe`, macOS `.dmg`, Linux `.AppImage`/`.deb`) + GitHub Actions release workflow
- [ ] **mDNS (`beamdrop.local`) & Optional Local HTTPS** (moved to `v1.3.0`)

---

## v2.0.0 (Future)
- [ ] Optional hardware-accelerated video transcoding (NVENC / QuickSync) for MKV/HEVC playback on older phones
- [ ] Two-way watched folder sync
- [ ] Multi-phone room broadcast
