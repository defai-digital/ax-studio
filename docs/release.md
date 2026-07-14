# Release Deployment

AX Studio public desktop deployment supports macOS Apple Silicon, Windows x64,
and Windows ARM64. Linux desktop builds are not published, tested as release
blockers, or covered by the support/SLA policy. Linux users should use AX Serving,
OpenAI-compatible endpoints, or source builds without official release
expectations.

Stable releases must produce signed and notarized macOS artifacts, Windows x64
and Windows ARM64 installer artifacts, a Tauri updater manifest for the
supported desktop platforms, and a Homebrew cask update for macOS.

## Required GitHub Secrets

Stable macOS release builds are intentionally fail-closed. Configure these
repository secrets before running `Tauri Builder - Tag` for a stable release:

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

Windows x64 and ARM64 artifacts are part of the supported desktop release.
Authenticode signing is fail-closed: all Azure signing secrets are required,
and missing credentials, signing failures, certificate mismatches, or invalid
Authenticode signatures must fail the release. The release workflow must never
publish unsigned Windows artifacts:

| Secret | Purpose |
| --- | --- |
| `AZURE_KEY_VAULT_URI` | Azure Key Vault URI for the Windows signing certificate. |
| `AZURE_CLIENT_ID` | Azure service principal client ID. |
| `AZURE_TENANT_ID` | Azure tenant ID. |
| `AZURE_CLIENT_SECRET` | Azure service principal secret. |
| `AZURE_CERT_NAME` | Azure Key Vault certificate name. |

The Azure service principal must be scoped to the signing vault and have
certificate `Get`, secret `Get`, and key `Sign` permissions. Public Windows
artifacts must be independently verified after upload and show
`DEFAI Private Limited` as the valid Authenticode signer.

Stable releases require detached Minisign signatures. Configure all three
secrets before publishing:

| Secret | Purpose |
| --- | --- |
| `AX_STUDIO_MINISIGN_SECRET_KEY_B64` | Base64-encoded minisign secret key. |
| `AX_STUDIO_MINISIGN_PUBLIC_KEY` | Minisign public key for verification. |
| `AX_STUDIO_MINISIGN_PASSWORD` | Password for the encrypted Minisign secret key. |

The matching public verification key is committed at
[`docs/ax-studio.minisign.pub`](ax-studio.minisign.pub). Verify a downloaded
asset with:

```bash
minisign -Vm AX.Studio_2.0.0_aarch64.dmg \
  -p docs/ax-studio.minisign.pub \
  -x AX.Studio_2.0.0_aarch64.dmg.minisig
```

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

The workflow creates or reuses a draft release, uploads macOS Apple Silicon,
Windows x64, and Windows ARM64 artifacts, writes and verifies `latest.json`,
publishes the release only after asset verification passes, and then updates the
Homebrew cask.
