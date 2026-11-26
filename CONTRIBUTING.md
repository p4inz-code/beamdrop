# Contributing to BeamDrop

Thank you for contributing to **BeamDrop**! This project prioritizes **speed, low thermal/RAM footprint, strict local-network security, and clean minimal UI**.

---

## Development Setup

```bash
git clone https://github.com/p4inz-code/beamdrop.git
cd beamdrop
npm install
npm start
```

### Running Tests
All pull requests must pass the syntax check and automated test suite:

```bash
node --check src/main.js
node --check src/server.js
npm test
```

---

## Engineering Standards

1. **Zero-RAM Streaming**: Never buffer full files in memory (`fs.readFile` / `Buffer.concat` on uploads/downloads). Always use streams or bounded chunks ($\le 16$ MB).
2. **XSS-Safe DOM**: Never pass untrusted filenames, device names, or clipboard strings to `innerHTML`. Use `textContent` and `document.createElement`.
3. **Electron Isolation**: Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` enabled in `src/main.js`.
4. **No Color Emojis in UI**: Use monochrome inline SVGs (`stroke="currentColor"`) to maintain the clean utility aesthetic.
5. **Thermal Efficiency**: Throttle IPC/WebSocket progress broadcasts ($\le 4$/sec) and keep ZIP streaming in `STORE` (`level: 0`) mode.

---

## Pull Request Checklist

- [ ] `npm test` passes with 0 failures
- [ ] New security boundaries (paths, auth, headers) have dedicated unit/integration tests in `tests/server.test.js`
- [ ] No new runtime dependencies added without justification
- [ ] Changes follow GPL-3.0-or-later licensing (see `LICENSE` and `NOTICE`)
