# Release Deployment

AX Studio public desktop deployment supports macOS Apple Silicon, Windows x64,
and Windows ARM64. Linux desktop builds are not published, tested as release
blockers, or covered by the support/SLA policy.

Since the Electron migration (Phase 4), packaging is
[electron-builder](https://www.electron.build/) and auto-update is
[electron-updater](https://www.electron.build/auto-update). The Tauri
toolchain (bundler, `latest.json` updater manifest, minisign signatures) is
retired.

## Artifacts

| Platform | Artifact | Installer |
| --- | --- | --- |
| macOS arm64 | `AX Studio-<ver>-arm64.dmg`, `AX Studio-<ver>-arm64-mac.zip` | DMG drag-install / zip |
| Windows x64 / arm64 | `AX Studio-<ver>-<arch>-setup.exe` | NSIS per-machine assisted |

Build locally with:

```bash
yarn dist:electron:mac    # macOS DMG + zip (unsigned locally)
yarn dist:electron:win    # Windows NSIS (x64 + arm64)
```

`scripts/dist-electron.mjs` runs `build:electron` and then electron-builder
with `--publish never`, injecting the version from the ROOT `package.json`
via `-c.extraMetadata.version`. Output lands in `electron/dist-installer/`.
Config: `electron/electron-builder.yml`. Local mac builds are unsigned — run
with `CSC_IDENTITY_AUTO_DISCOVERY=false` when no Developer ID identity is
available.

## Auto-update

The packaged app initializes electron-updater (only when
`app.isPackaged && !--smoke`; see `electron/src/updater.ts`) against the
GitHub releases feed (`defai-digital/ax-studio`, `latest-mac.yml` /
`latest.yml`, configured under `publish:` in `electron/electron-builder.yml`).
A release must therefore attach those generated metadata files alongside the
installers for update checks to succeed. The renderer UI is
`web-app/src/containers/ElectronUpdateBanner.tsx`.

## Signing / notarization

CI concern, intentionally not solved locally:

- macOS: sign with a Developer ID Application identity and notarize
  (`notarize: false` in `electron-builder.yml` until CI wires credentials;
  `electron/build/entitlements.mac.plist` carries the minimal Chromium/V8
  entitlement set).
- Windows: Authenticode-sign the NSIS installer per DEFAI Private Limited
  policy.

## Homebrew cask

The Homebrew cask for macOS continues to be published to the shared tap; the
DMG/zip it references now comes from the electron-builder output above.
