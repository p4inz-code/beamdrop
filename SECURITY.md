# Security Policy

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `1.0.x` | Yes |

---

## Threat Model & Protections

BeamDrop is designed for **local Wi-Fi / Mobile Hotspot** transfers. Because local networks (cafes, dorms, shared routers) may contain untrusted devices, BeamDrop enforces:

- **Pairing Gate**: 4-digit cryptographic PIN (`crypto.randomInt`) with per-IP rate limiting (`PinRateLimiter`: 5 attempts / 60s $\rightarrow$ 120s lockout) or 128-bit `qrSecret`, verified in constant time (`crypto.timingSafeEqual`).
- **Explicit PC Approval**: Connected devices require manual `[Allow] / [Block]` confirmation on the PC before receiving a 256-bit `HttpOnly; SameSite=Strict` session token.
- **Path Traversal Prevention**: All uploaded filenames pass through `sanitizeFilename()` and `resolveSafePath()` to block `../` escapes, null bytes, and Windows reserved device names (`CON`, `NUL`, etc.).
- **CSRF & XSS**: State-changing requests validate `Origin === Host`; all PC and Mobile UI rendering uses `textContent` (zero `innerHTML`).
- **Electron Sandbox**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP, and blocked external navigation.

---

## Reporting a Vulnerability

If you discover a security vulnerability, **please do not open a public issue**.
Report it privately via GitHub Security Advisories or contact **Atharva Patil (`p4inz-code`)** via [GitHub](https://github.com/p4inz-code).
