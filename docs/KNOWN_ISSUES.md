# Known Issues & Limitations

BeamDrop v1.0.0 is tested and stable for daily 1GB–2GB+ video transfers on Windows. Below is the honest list of current platform and network limitations:

1. **Router AP / Client Isolation**: Public Wi-Fi networks (hotels, cafes, campuses) often block device-to-device traffic on the same Wi-Fi. **Workaround**: Enable **Windows Mobile Hotspot** and connect your phone directly to your PC.
2. **Windows Defender Firewall (Public Profile)**: If your Wi-Fi network is marked *Public* in Windows, Defender Firewall may block inbound connections on port `5050` until allowed.
3. **MKV / AVI / AC3 In-Browser Playback**: Mobile browsers (Safari/Chrome) natively stream MP4, MOV, and WebM. Non-browser codecs like MKV or AC3 download at full LAN speed for playback in VLC or Infuse.
4. **Plain HTTP on LAN**: Over `http://192.168.x.x`, iOS/Android browsers restrict native `navigator.clipboard` and PWA install prompts. BeamDrop works around clipboard restrictions using a legacy copy fallback; local HTTPS is planned for `v1.2.0`.
5. **macOS & Linux Packaging**: Source runs on Node.js/Electron, while prebuilt `.dmg` / `.AppImage` installers are scheduled for `v1.2.0`.
