# Issue #870 Windows verification after latest-main integration

Date: 2026-09-17. Branch: `fix/windows-issues-20260916`.
Issue: https://github.com/defai-digital/ax-studio/issues/870

## Scope and repair

Fetched `origin/main` at `336001b0` and merged it into the requested branch
in `320586da`. The branch already contained the original repair `848a14af`;
latest main still invoked distribution directly through Node. The merge retains
`yarn dist:electron:win`, which supplies the Yarn discovery context required by
the nested `build:electron` process, and preserves latest-main macOS settings.
Windows Authenticode credentials and `--publish never` remain intact.

This follow-up makes Windows artifact upload fail when no files are found and
strengthens regression coverage for the workflow-to-package-script contract:
the Windows command must use Yarn, its package script must forward `--win`,
and upload must include installer and update-manifest paths. Together with the
existing branch repair, these changes prevent recurrence of the reported entry
point failure and an empty upload being reported as successful.

## Fresh validation

- Focused runtime and packaging regressions: **28 tests / 2 files passed**,
  exit 0, after the final workflow/test changes.
- Full local Windows distribution: **exit 0**, directly captured from Corepack
  invoking `dist:electron:win`; no `--skip-build`. Both x64 and ARM64 packaged.
  This confirming run used Node 22.19.0, Yarn 4.5.3, Electron 43.2.0 and
  electron-builder 26.15.7 on Windows 10.0.26200. The earlier redirected run
  used Node 24.20.0; hosted validation uses the project's required Node 24.
- Installer: `AX Studio Setup 2.2.2.exe`, 219,772,513 bytes. SHA-256:
  `7ac23c857f2c7e03e655bae7fbcaa87319205906fe78f7aecec93fb6b9e7987b`.
  Blockmap: 229,175 bytes; `latest.yml`: 347 bytes. Manifest size and SHA-512
  were verified against the installer.
- Packaged x64 application: renderer loaded from `resources/app.asar`, preload
  bridge present, thread/message created and read back through IPC, zero captured
  renderer exceptions. A dedicated temporary profile/data directory was used.
- `git diff --check`: passed.

The first sandboxed build/test attempts encountered directory-access restrictions;
the authorized external runs bypassed that environment limitation. PowerShell's
redirected build returned 1 despite producing the installer, after treating Vite
stderr warnings as NativeCommandError. It is not counted as a passing command.
A second full build directly captures the child exit code without PowerShell's
stderr conversion. Existing chunk-size warnings are retained.

## Acceptance boundary

Windows acceptance for #870 requires a new `publish=false` hosted run on the
repaired revision, successful packaging and a downloadable artifact. Hosted
verification follows the local-test/report commit and push and will be appended
below. No release publication or issue closure is performed.

This is packaging acceptance, not comprehensive Windows product certification.
The local installer is unsigned; ARM64 runtime, elevated install/uninstall and
signed upgrade flows are not claimed. The original issue also includes macOS
artifact/signing acceptance, which Windows validation cannot establish.

Pre-existing changes to `web-app/src/routeTree.gen.ts`, the untracked acceptance
report and temporary directories were not staged. Raw local evidence lives in
`tmp/issue870-*` and `tmp/windows-packaged-cdp.*`; generated installers remain
outside Git.
