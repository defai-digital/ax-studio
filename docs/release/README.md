# Release

| Document | Description |
| --- | --- |
| [release.md](release.md) | Public desktop release pipeline (signing, updater, Homebrew, optional winget) |
| [windows-signing.md](windows-signing.md) | Windows Authenticode, Key Vault, verify policy, cert lifecycle |
| [windows-cert.json](windows-cert.json) | Public Windows code-signing certificate pin / metadata |
| [microsoft-store.md](microsoft-store.md) | Microsoft Store NSIS submission runbook |
| [ax-minisign.pub](ax-minisign.pub) | Minisign public key for verifying release assets |
| [`../../packaging/winget/README.md`](../../packaging/winget/README.md) | winget manifests + optional winget-pkgs PR automation |
| [`../../.github/workflows/windows-cert-expiry.yml`](../../.github/workflows/windows-cert-expiry.yml) | Weekly Windows signing-cert expiry check |

Scripts that implement these flows live under [`../../scripts/release/`](../../scripts/release/).

Useful local commands:

```bash
yarn validate:release
yarn prepare:windows-distribution -- --version <ver> --artifacts-dir <dir> --out-dir <dir>
yarn generate:winget -- --version <ver> --x64-sha256 <hex> --arm64-sha256 <hex> --out-dir <dir>
```
