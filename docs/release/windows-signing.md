# Windows Signing and Deployment

This runbook is the source of practice for Windows Authenticode signing,
verification, and distribution. Public certificate metadata lives in
[`windows-cert.json`](windows-cert.json). Do not treat local PFX exports or
macOS keychain imports as the production signing path.

## Trust model

| Layer | Tool | Where private key lives |
| --- | --- | --- |
| Sign release PE / NSIS | AzureSignTool via `src-tauri/sign.ps1` | Azure Key Vault (`keyvault-defai` / `cert-defai`) |
| Verify after sign / after download | PowerShell Authenticode | N/A (public cert only) |
| Extra release integrity | Minisign detached `.minisig` | Separate Minisign key (not DigiCert) |
| macOS desktop | Apple Developer ID + notarization | Apple `.p12` / CI secrets — **separate** from Windows |

Production Windows signing always runs on **Windows** runners with Key Vault
credentials. The private key must remain in Azure Key Vault (prefer
non-exportable when DigiCert issuance allows).

## Do and do not

**Do**

- Sign with AzureSignTool + DigiCert timestamp (`timestampUrl` in `windows-cert.json`).
- Fail closed when Azure secrets, signing, thumbprint, or timestamp checks fail.
- Verify downloaded installers with Authenticode (`Valid` + DEFAI subject + pinned thumbprint).
- Distribute signed NSIS setup executables from GitHub Releases as the trust baseline.
- Keep Apple Developer ID material conceptually separate from DigiCert Windows material.

**Do not**

- Use `security import` of a Windows DigiCert PFX into a macOS keychain for product signing.
- Use macOS `codesign` / `productbuild` with the DigiCert Authenticode certificate.
- Install AX Studio via third-party `curl | sh` or PowerShell `irm | iex`.
- Commit PFX files, private keys, or Key Vault export passwords.
- Routinely download exportable PFX from the portal onto laptops.
- Publish unsigned Windows artifacts under any release channel.

## Certificate metadata

Pinned public fields are in [`windows-cert.json`](windows-cert.json):

| Field | Purpose |
| --- | --- |
| `thumbprintSha1` | Fail-closed pin in `sign.ps1` and verify script |
| `subjectPattern` | Authenticode subject must contain this |
| `publisher` | Matches `tauri.conf.json` `bundle.publisher` |
| `notAfter` | Renewal calendar (update JSON before reissue) |
| `azureKeyVaultName` / `azureCertificateName` | Ops reference for vault objects |
| `packageIdentifier` | Planned winget package id (`DEFAI.AXStudio`) |

When DigiCert reissues the certificate, update `windows-cert.json` first, then
confirm CI, `sign.ps1`, and the verify script still load the new pin. Re-run a
signed PE smoke test (for example DigiCert Partner Center challenge or Store
installer smoke) before the next public tag.

## CI signing flow

1. Windows build templates require Azure secrets (`AZURE_*`).
2. Release CI installs AzureSignTool and validates secrets before `make build`.
3. Tauri invokes `powershell -ExecutionPolicy Bypass -File ./sign.ps1 %1`.
4. `sign.ps1` signs with SHA-256 file digest and DigiCert timestamp, then verifies
   Authenticode status and the pinned thumbprint from `windows-cert.json`.
5. Draft EXEs are uploaded to the GitHub release.
6. Job `verify-windows-authenticode` downloads every EXE and runs
   [`scripts/release/verify-windows-authenticode.ps1`](../../scripts/release/verify-windows-authenticode.ps1).
7. Job `prepare-windows-distribution` writes `SHA256SUMS-windows.txt` for both
   setup installers, uploads it to the draft release, and emits winget manifests
   as a 90-day workflow artifact (`ax-studio-winget-manifests-<version>`).
8. Minisign signs assets (including `SHA256SUMS-windows.txt`); the release
   publishes only after all checks pass.

Required GitHub secrets are documented in [`release.md`](release.md). The Azure
service principal should be limited to certificate `Get`, secret `Get`, and key
`Sign` on the signing vault. Avoid granting routine export if policy allows.

## Local verification (ops or advanced users)

From a Windows machine with the repo or a downloaded installer:

```powershell
# Single installer
.\scripts\release\verify-windows-authenticode.ps1 -Path .\AX.Studio_2.2.0_x64-setup.exe

# Release artifact directory (CI shape)
.\scripts\release\verify-windows-authenticode.ps1 -Path .\artifacts -RequireVersion 2.2.0
```

Users who only downloaded the EXE can still check:

```powershell
Get-AuthenticodeSignature ".\AX.Studio_*_x64-setup.exe" |
  Format-List Status, StatusMessage, SignerCertificate
```

Expect `Status = Valid` and a subject that identifies **DEFAI Private Limited**.
Do not install if Windows reports an unknown publisher or an invalid signature.

## Distribution ladder

| Path | Audience | Status |
| --- | --- | --- |
| GitHub Releases NSIS (`*_x64-setup.exe` / `*_arm64-setup.exe`) | Everyone; trust baseline | Active |
| Portable EXE | Users who need no-install packages | Optional release asset (signed PE copy of main binary) |
| winget (`DEFAI.AXStudio`) | CLI / IT | Manifest generator ready; publish separately to winget-pkgs |
| Microsoft Store (offline NSIS) | Consumers | Separate Store runbook |
| MSI | — | **Not built** (public lane is NSIS-only) |

Primary public artifact is **NSIS setup.exe** with `installMode: perMachine`
(machine scope, aligned with winget `Scope: machine`). Portable artifacts, when
present, inherit Authenticode from the main PE signed during the build. See
[`microsoft-store.md`](microsoft-store.md) for Store submission.

## Local cert hygiene (operators)

- Prefer Key Vault signing only; keep private keys off developer laptops.
- If a public `.cer` is kept offline for inspection, that is fine.
- If a PFX was exported, treat it as highly sensitive: encrypt at rest, restrict
  ACLs, and delete when no longer required. Prefer non-exportable vault keys.
- Do not import Windows DigiCert material into the macOS login keychain for
  release automation.
- Keep Apple `DeveloperID-*.p12` workflows separate from DigiCert Authenticode.

## Certificate expiry policy (CI)

`yarn validate:release` and the weekly
[`.github/workflows/windows-cert-expiry.yml`](../../.github/workflows/windows-cert-expiry.yml)
workflow evaluate `notAfter` from [`windows-cert.json`](windows-cert.json):

| Remaining | Behavior |
| --- | --- |
| ≥ 90 days | OK |
| &lt; 90 days | GitHub Actions `notice` |
| &lt; 60 days | GitHub Actions `warning` |
| &lt; 30 days | **Fail** validate / release preflight |
| Expired | **Fail** |

## Renewal checklist

1. Issue / import the new DigiCert code-signing cert into Azure Key Vault.
2. Update [`windows-cert.json`](windows-cert.json) (`thumbprintSha1`, dates, issuer text if needed).
3. Confirm `AZURE_CERT_NAME` still points at the correct vault certificate object.
4. Run a Windows CI build or Store smoke that exercises `sign.ps1`.
5. Verify a produced EXE with `verify-windows-authenticode.ps1`.
6. Tag the next release only after Authenticode + Minisign gates pass.

## Related files

| Path | Role |
| --- | --- |
| [`windows-cert.json`](windows-cert.json) | Public cert pin / metadata |
| [`../../src-tauri/sign.ps1`](../../src-tauri/sign.ps1) | AzureSignTool wrapper |
| [`../../scripts/release/verify-windows-authenticode.ps1`](../../scripts/release/verify-windows-authenticode.ps1) | Shared verify gate |
| [`../../scripts/release/write-winget-manifest.mjs`](../../scripts/release/write-winget-manifest.mjs) | winget manifest generator |
| [`../../scripts/release/prepare-windows-distribution.mjs`](../../scripts/release/prepare-windows-distribution.mjs) | SHA256SUMS + winget package for a version |
| [`../../packaging/winget/README.md`](../../packaging/winget/README.md) | winget publish notes |
| [`microsoft-store.md`](microsoft-store.md) | Store NSIS submission |
| [`release.md`](release.md) | Full multi-platform release pipeline |
