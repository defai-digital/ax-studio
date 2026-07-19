# winget packaging

AX Studio's trust baseline on Windows remains the Authenticode-signed NSIS
installer from GitHub Releases. winget is the preferred **easy CLI** install
path once the package is accepted into
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).

Planned package id: **`DEFAI.AXStudio`** (see
[`docs/release/windows-cert.json`](../../docs/release/windows-cert.json)).

NSIS is built with **per-machine** scope (`installMode: perMachine`), matching
winget `Scope: machine`.

## Generate manifests for a release

### Preferred: from signed setup EXEs

```bash
# After downloading the two setup EXEs into ./artifacts
yarn prepare:windows-distribution -- \
  --version 2.2.0 \
  --artifacts-dir ./artifacts \
  --out-dir ./windows-distribution
```

This writes:

```text
windows-distribution/SHA256SUMS-windows.txt
windows-distribution/windows-distribution.json
windows-distribution/winget/d/DEFAI/AXStudio/<version>/
  DEFAI.AXStudio.yaml
  DEFAI.AXStudio.locale.en-US.yaml
  DEFAI.AXStudio.installer.yaml
```

(The leading `d/` is the first letter of the publisher segment `DEFAI`, matching
the winget-pkgs multi-file layout.)

Stable release CI runs the same preparation after Authenticode verification,
publishes `SHA256SUMS-windows.txt` on the GitHub release (Minisign-signed with
other assets), and uploads the winget tree as workflow artifact
`ax-studio-winget-manifests-<version>`.

### Manual hashes

```bash
yarn generate:winget -- \
  --version 2.2.0 \
  --x64-sha256 <64-char-hex-of-x64-setup.exe> \
  --arm64-sha256 <64-char-hex-of-arm64-setup.exe> \
  --out-dir packaging/winget/manifests \
  --release-date 2026-07-19
```

Installer URLs point at:

- `AX.Studio_<version>_x64-setup.exe`
- `AX.Studio_<version>_arm64-setup.exe`

Both must already pass Authenticode verification (DEFAI Private Limited + pinned
thumbprint) and Minisign checks from the release pipeline. Cross-check hashes
against the release asset `SHA256SUMS-windows.txt` when present.

## Submit to winget-pkgs

### Automated (optional CI job)

After a stable release is **published**, job `submit-winget-manifest` runs when
both secrets are set:

| Secret | Purpose |
| --- | --- |
| `WINGET_PKGS_TOKEN` | PAT/GitHub App token that can push to your fork and open PRs on `microsoft/winget-pkgs` |
| `WINGET_PKGS_FORK` | Your fork as `owner/winget-pkgs` |

The job re-downloads public setup EXEs, re-hashes them, regenerates manifests,
and opens a PR via `scripts/release/submit-winget-pr.mjs`. If the token is
unset, the job logs a notice and the rest of the release stays green.

Local dry-run (no PR):

```bash
yarn submit:winget -- \
  --version 2.2.0 \
  --manifests-dir ./windows-distribution/winget \
  --dry-run
```

### First publish (manual)

1. Generate manifests for the stable public version (or download the CI artifact).
2. Open a PR against `microsoft/winget-pkgs` following their contribution docs
   (or enable the automated job above).
3. Do **not** claim `winget install DEFAI.AXStudio` in product docs until the
   package is live in the community repository.
4. After acceptance, document the install one-liner in the root README.

## Policy

- Never point winget at unsigned or portable-only builds for the default package.
- Never replace GitHub NSIS with a remote PowerShell install script.
- Keep Microsoft Store packaging on the separate offline-NSIS Store lane
  ([`docs/release/microsoft-store.md`](../../docs/release/microsoft-store.md)).
