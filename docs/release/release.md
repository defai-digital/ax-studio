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

## CI release pipeline

`.github/workflows/ax-studio-electron-build.yml` replaced the retired Tauri
release workflows. It triggers on version-tag pushes (`v*`) and on
`workflow_dispatch` (optional `publish` boolean, default `false` = dry build
that only uploads workflow artifacts).

Jobs:

- `build-macos` (`macos-latest`): installs deps via the bundled Yarn
  (`node .yarn/releases/yarn-4.5.3.cjs install --immutable` — corepack is not
  relied upon), builds core/web/electron, then runs
  `node scripts/dist-electron.mjs --mac`. Uploads `*.dmg`, `*.zip`,
  `latest-mac.yml`, and `*.blockmap` as the `electron-dist-macos` artifact.
- `build-windows` (`windows-latest`): same flow with `--win` (NSIS x64 +
  arm64), uploading `*.exe`, `latest.yml`, and `*.blockmap` as
  `electron-dist-windows`.
- `release` (needs both builds; runs on tag pushes or dispatch with
  `publish: true`): downloads both artifacts and attaches every file —
  installers plus the electron-updater feeds — to the GitHub Release for the
  tag via `softprops/action-gh-release`. On a manual publish from a non-tag
  ref the tag name is derived from the root `package.json` version.

Both build jobs fail fast when a pushed tag's version does not match the root
`package.json` version — `scripts/dist-electron.mjs` injects that value into
the build, so a mismatch would ship a mis-versioned release.

## Signing / notarization

CI wires credentials through environment variables electron-builder
understands; everything degrades gracefully when secrets are absent:

- macOS: set `APPLE_CERTIFICATE` (base64 .p12) + `APPLE_CERTIFICATE_PASSWORD`
  or `APPLE_SIGNING_IDENTITY` to sign. Notarization uses either
  `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` or the API-key
  variant `APPLE_API_KEY_B64` (base64 .p8) + `APPLE_API_KEY_ID` +
  `APPLE_API_ISSUER`. When signing AND notary credentials are present the
  workflow passes `-c.mac.notarize=true` (the yml keeps `notarize: false` for
  local builds); electron-builder runs the notary step itself — no separate
  `notarytool` step. Without any signing secrets the build runs unsigned with
  `CSC_IDENTITY_AUTO_DISCOVERY=false` and still succeeds.
  `electron/build/entitlements.mac.plist` carries the minimal Chromium/V8
  entitlement set.
- Windows: set `CSC_LINK` + `CSC_KEY_PASSWORD` for Authenticode signing;
  without them electron-builder skips signing with a warning.

## Homebrew cask

The Homebrew cask for macOS continues to be published to the shared tap; the
DMG/zip it references now comes from the electron-builder output above.
