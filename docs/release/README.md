# Release

| Document | Description |
| --- | --- |
| [release.md](release.md) | Public desktop release pipeline (electron-builder packaging, electron-updater, signing/notarization, Homebrew) |

The Tauri-era runbooks (Microsoft Store submission, Windows Key Vault
signing, minisign verification) were retired with the Tauri toolchain in the
Electron migration (see
[`../architecture/electron-migration-phase0-matrix.md`](../architecture/electron-migration-phase0-matrix.md)).
Windows Authenticode policy for the electron-builder NSIS installer is
summarized in [release.md](release.md).

Useful local commands:

```bash
yarn dist:electron:mac   # unsigned local DMG (CSC_IDENTITY_AUTO_DISCOVERY=false)
yarn dist:electron:win   # NSIS x64 + arm64
```
