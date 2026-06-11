# Release Deployment

AX Studio public deployment supports macOS Apple Silicon only. Stable releases
must produce signed and notarized macOS artifacts, a Tauri updater manifest, and
a Homebrew cask update.

## Required GitHub Secrets

Stable release builds are intentionally fail-closed. Configure these repository
secrets before running `Tauri Builder - Tag` for a stable release:

| Secret | Purpose |
| --- | --- |
| `CODE_SIGN_P12_BASE64` | Base64-encoded Apple Developer ID Application certificate `.p12`. |
| `CODE_SIGN_P12_PASSWORD` | Password for the Apple signing certificate. |
| `NOTARIZE_P8_BASE64` | Base64-encoded App Store Connect API key `.p8`. |
| `NOTARY_ISSUER` | App Store Connect issuer ID. |
| `NOTARY_KEY_ID` | App Store Connect key ID. |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater private key. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the Tauri updater private key. |
| `TAURI_UPDATER_PUBKEY` | Public key paired with the Tauri updater private key. |
| `AX_STUDIO_SIGNING_KEY` | Application signing key consumed by the release build. |

Optional detached minisign signatures require both of these secrets:

| Secret | Purpose |
| --- | --- |
| `AX_STUDIO_MINISIGN_SECRET_KEY_B64` | Base64-encoded minisign secret key. |
| `AX_STUDIO_MINISIGN_PUBLIC_KEY` | Minisign public key for verification. |
| `AX_STUDIO_MINISIGN_PASSWORD` | Minisign key password, if the key is password protected. |

The Homebrew tap update accepts either `HOMEBREW_TAP_TOKEN` or the legacy
`TAP_TOKEN`. Prefer `HOMEBREW_TAP_TOKEN` for new configuration. The token needs
write access to `defai-digital/homebrew-ax-studio`.

## v1.3.3 Repair Run

After the required secrets are configured, rebuild the existing `v1.3.3` tag
from the `Tauri Builder - Tag` workflow:

```bash
gh workflow run "Tauri Builder - Tag" \
  --repo defai-digital/ax-studio \
  --ref main \
  -f version=1.3.3
```

The workflow creates or reuses a draft release, uploads macOS Apple Silicon
artifacts, writes and verifies `latest.json`, publishes the release only after
asset verification passes, and then updates the Homebrew cask.
