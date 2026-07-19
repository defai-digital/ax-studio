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
repository secrets before running `Tauri Builder - Tag` for a stable release.
The preferred names below match the current repository configuration; the
workflow also accepts the legacy aliases shown where applicable:

| Secret | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded Apple Developer ID Application certificate `.p12` (`CODE_SIGN_P12_BASE64` is accepted as a legacy alias). |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the Apple signing certificate (`CODE_SIGN_P12_PASSWORD` is accepted as a legacy alias). |
| `APPLE_API_KEY_B64` | Base64-encoded App Store Connect API key `.p8` (`NOTARIZE_P8_BASE64` is accepted as a legacy alias). |
| `APPLE_API_ISSUER` | App Store Connect issuer ID (`NOTARY_ISSUER` is accepted as a legacy alias). |
| `APPLE_API_KEY_ID` | App Store Connect key ID (`NOTARY_KEY_ID` is accepted as a legacy alias). |
| `APPLE_TEAM_ID` | Apple Developer team ID expected in the Developer ID signature. |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater private key. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the Tauri updater private key, when encrypted. |
| `TAURI_UPDATER_PUBKEY` | Public key paired with the Tauri updater private key. |
| `AX_STUDIO_SIGNING_KEY` | Optional application-level signing key consumed by the release build. |

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
[`docs/release/ax-studio.minisign.pub`](ax-studio.minisign.pub). Verify a downloaded
asset with:

```bash
minisign -Vm AX.Studio_2.0.0_aarch64.dmg \
  -p docs/release/ax-studio.minisign.pub \
  -x AX.Studio_2.0.0_aarch64.dmg.minisig
```

For local release signing, the repository defaults to these Minisign files:

```text
~/signkey/ax.minisign.key -> ax.sec
~/signkey/ax.pub
```

Keep `ax.sec` private with mode `0600`. Set `MINISIGN_PASSWORD` in the release
environment for unattended signing. When it is absent on macOS, the signer
looks up service `ax-minisign`, account `ax-release`, then falls back to
Minisign's terminal prompt. Store the password with:

```bash
security add-generic-password -U -s ax-minisign -a ax-release -w
```

The local Tauri build uses the same private/public key pair for updater
artifacts when updater signing is enabled.

## Release Download Policy

Use `gh release download` for release assets inside GitHub Actions. It handles
authenticated draft releases and allows the workflow to pin an exact tag and
asset pattern. Do not replace these calls with a generic `curl -fsSL` command.

Use `gh api` with `GH_TOKEN` for GitHub API metadata. API failures must remain
visible in the job log and return a nonzero status; do not use a silent
`curl | jq` pipeline that can hide an HTTP or parsing failure.

The public DMG download used to update the Homebrew cask is the narrow exception
where `curl` is appropriate. It must use an exact versioned HTTPS URL, fail on
HTTP errors, follow HTTPS redirects, retain diagnostic messages, retry transient
failures, enforce connection and transfer timeouts, and remove partial output:

```bash
curl --fail --location --no-progress-meter \
  --retry 6 --retry-all-errors --retry-delay 10 \
  --connect-timeout 15 --max-time 600 --remove-on-error \
  --proto '=https' --proto-redir '=https' \
  --output release.dmg "$DMG_URL"
```

Transport flags are not authenticity checks. After download, the release must
still pass Developer ID and notarization verification on macOS, Authenticode
verification on Windows, and detached Minisign verification before publication.
Release automation must never pipe downloaded content directly into a shell.

The Homebrew tap update accepts either `HOMEBREW_TAP_TOKEN` or the legacy
`TAP_TOKEN`. Prefer `HOMEBREW_TAP_TOKEN` for new configuration. The token needs
write access to `defai-digital/homebrew-ax-studio`. Stable releases fail when
neither token is configured. After updating the cask, CI installs it on a clean
macOS runner and verifies its version, Developer ID signature, and Gatekeeper
assessment.

## Stable Release Procedure

### 1. Commit the app version on `main` before tagging

Release CI still runs `scripts/release/set-version.mjs` when building artifacts,
but that rewrite is ephemeral. Local `yarn dev` and Settings → App Version read
the **committed** manifests (`web-app/package.json`, `src-tauri/tauri.conf.json`,
and related Cargo/`package.json` files). If those stay on an older number (for
example `1.3.24`) while the git tag is `v2.1.0`, developers see the wrong version.

Before cutting a release tag:

```bash
# Rewrite every app-version manifest to the release semver (no leading "v")
yarn set-version --version 2.1.0

# Confirm lockstep (fails if any manifest disagrees)
yarn validate:version
# optional: require an exact version
yarn validate:version --expect 2.1.0

git add package.json web-app/package.json \
  src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock \
  src-tauri/plugins/tauri-plugin-hardware/package.json \
  src-tauri/plugins/tauri-plugin-hardware/Cargo.toml \
  src-tauri/plugins/tauri-plugin-llamacpp/package.json \
  src-tauri/plugins/tauri-plugin-llamacpp/Cargo.toml
git commit -m "chore(release): bump version to 2.1.0"
git push origin main
```

`yarn validate:version` must pass on `main` after the bump.

### 2. Tag the bumped commit

Create an annotated release tag from that tested `main` commit and push it:

```bash
git tag -a v2.1.0 -m "AX Studio 2.1.0"
git push origin v2.1.0
```

The tag starts `Tauri Builder - Tag`. The workflow creates a draft release and
builds macOS Apple Silicon, Windows x64, and Windows ARM64 in parallel. It then:

1. Downloads the draft DMG and verifies the stapled notarization ticket,
   Developer ID signer, team ID, and Gatekeeper assessment.
2. Downloads every Windows executable and verifies its Authenticode status,
   DEFAI certificate thumbprint, subject, and trusted timestamp.
3. Writes and validates `latest.json` for Tauri updater delivery.
4. Signs every release asset with Minisign, downloads the signatures again,
   and verifies them with `docs/release/ax-studio.minisign.pub`.
5. Publishes the GitHub release only after all artifact checks pass.
6. Updates `defai-digital/homebrew-ax-studio`, installs the new cask on a clean
   macOS runner, and verifies the installed application with Gatekeeper.

Do not manually publish the draft when any required job fails. Fix the cause and
rerun the tagged release workflow so that the complete chain remains auditable.
