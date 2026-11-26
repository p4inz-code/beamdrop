# Privacy Policy

**BeamDrop** is built by **Atharva Patil (`p4inz-code`)** with a strict **zero-telemetry, zero-cloud** guarantee.

## What BeamDrop Does Not Do
- **No Analytics or Telemetry**: BeamDrop does not collect usage metrics, crash reports, device IDs, or IP addresses.
- **No External Servers**: BeamDrop never contacts any external server, update API, or cloud relay.
- **No Accounts**: There is no sign-up, login, or tracking cookie.

## What Stays on Your Machine
- **Shared Files & Uploads**: Files are streamed directly between your PC and your phone over your local Wi-Fi or Windows Mobile Hotspot.
- **Trusted Devices (`trusted_devices.json`)**: If you explicitly click **Allow & Trust** for a device, its cryptographic `trustKey` is stored locally in Electron's `userData` directory and can be deleted anytime via **Forget**.
- **Temporary Upload Chunks (`.beamdrop_tmp`)**: Partial `.part` files are stored in your Save Folder during active uploads and automatically cleaned up on completion, cancellation, or restart.
