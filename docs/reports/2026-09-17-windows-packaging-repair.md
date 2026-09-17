# Windows packaging repair and issue acceptance — 2026-09-17

Branch: `fix/windows-issues-20260916`. Baseline: `b6d3ae3039f0b2c711192b91306476c94e97839e`. Related issue: [#870](https://github.com/defai-digital/ax-studio/issues/870).

## Result

The Windows distribution command now completes locally and produces a combined x64/ARM64 NSIS installer, blockmap and update manifest. The actual packaged x64 application loads its renderer and passes an isolated preload/IPC/message-persistence check. The original CI entry-point failure is repaired for both Windows and macOS; hosted dual-platform acceptance is still required before #870 can be closed.

## Root cause and repair

The [original packaging run](https://github.com/defai-digital/ax-studio/actions/runs/35181025574) failed before compilation on both platforms. The workflow invoked `node scripts/dist-electron.mjs` directly. Its nested `build:electron` step calls `resolveYarnInvocation`, which expects a vendored Yarn release, `COREPACK_ROOT` or `npm_execpath`; installing a Yarn shim on PATH alone does not provide that context.

Local reproduction, `node scripts/dist-electron.mjs --win`, exited 1 with `could not locate yarn; run this command through yarn` (the original diagnostic surrounds yarn with backticks).

The workflow now uses the existing root scripts:

- Windows: `yarn dist:electron:win`.
- macOS: `yarn dist:electron:mac "${extra_args[@]}"`.

Yarn supplies the context needed by the nested build. Platform flags remain defined by package.json; the macOS signing/notarization arguments and Windows Authenticode environment remain intact. `--publish never` remains enforced by the packaging script. No dependency, application runtime or signing-policy change is needed. Direct `node` invocation without the documented Yarn discovery context remains unsupported; the workflow uses the supported entry point.

The existing signing-configuration regressions now check the corrected commands, including forwarding the macOS argument array.

## Local validation

Environment: Windows 10.0.26200, Node 24.20.0 through Yarn/Corepack, Yarn 4.5.3, Electron 43.2.0, electron-builder 26.15.7.

| Check | Result |
| --- | --- |
| Original direct-node invocation | Reproduced the Yarn discovery failure, exit 1. |
| `node node_modules/vitest/vitest.mjs run scripts/testing/electron-runtime.test.mjs scripts/testing/macos-compatibility.test.mjs` | Exit 0: 2 files, 27 tests passed. |
| `yarn.cmd dist:electron:win` | Exit 0: full core/web/runtime build, renderer staging, x64 and ARM64 packaging, NSIS generation and blockmap generation completed. No `--skip-build` was used. |
| Packaged x64 acceptance | Exit 0: launched `win-unpacked/AX Studio.exe`, loaded `resources/app.asar/web-dist/index.html`, rendered a nonempty UI, verified the preload bridge, created a thread/message and read the persisted message back through IPC. No renderer exceptions were captured during the observed interval. |
| Data isolation | Dedicated temporary user profile with a prewritten configuration pointing to a dedicated temporary data folder; IPC confirmed the exact folder before creating test data. |
| Update manifest | `latest.yml` version 2.2.2, file size and SHA-512 match the generated installer. |
| Whitespace check | `git diff --check` passed. |

Initial sandboxed Vitest/Vite attempts could not read ancestor directories required to load configuration; authorized runs outside the sandbox succeeded. Those sandbox errors were not treated as application defects.

### Generated artifacts

Local directory: `electron/dist-installer/` (ignored build output, excluded from Git).

| Artifact | Bytes |
| --- | ---: |
| `AX Studio Setup 2.2.2.exe` | 219,772,517 |
| `AX Studio Setup 2.2.2.exe.blockmap` | 229,177 |
| `latest.yml` | 347 |

Installer SHA-256: `17d415c5f54079b09aa0fdff62ae679cc410103fff1ceea0c109d060cfcbfa1b`.

The local installer is **NotSigned**, as verified by `Get-AuthenticodeSignature`; electron-builder's “signing with signtool.exe” log alone is not proof of a signature. No local signing credentials were supplied. ARM64 was packaged but not executed on ARM64 hardware. The NSIS installer was generated, not installed into the user's machine; elevation, installation/uninstallation and signed-upgrade acceptance are not claimed.

### Additional observations and limits

- The built-in `--smoke` run timed out before reporting any checks. Inspection found Unix-style shebang fixtures, a colon-separated PATH and direct spawning of an extensionless fake engine in that harness. This attempt is recorded as **failed**, not silently counted as success. It is not a passing Windows end-to-end test. The separate packaged x64 acceptance above exercises actual production startup without those fixtures and passed; it does not replace every assertion in the built-in suite.
- Normal packaged startup logs an updater 404 for `releases/download/v2.2.2/latest.yml`. The published release lacks that Electron feed; locally the feed was generated and its hash verified. This is not a packaging exit failure and the UI/IPC check still passed. No release or updater configuration was changed; #851 remains outside this repair.
- Existing Vite chunk-size/dynamic-import warnings remain. The build completed successfully.
- Raw evidence is retained locally in `tmp/windows-packaging-20260917.log`, `tmp/windows-packaged-smoke.json`, `tmp/windows-packaged-cdp.log` and `tmp/windows-packaged-cdp.json`. Temporary profiles, build products and pre-existing workspace changes are excluded from the commit.

## Issue log closure assessment

The current open issues were read from GitHub during this task. Local packaging success does not close unrelated crash, macOS or service-configuration acceptance gaps.

| Issue | Current disposition |
| --- | --- |
| #870 | Local Windows build/package and packaged startup accepted. Keep open until a new `publish=false` run on the pushed repair succeeds for both platforms and exposes downloadable artifacts; verify the required macOS artifact/signing evidence. |
| #847 | Requires the resulting macOS artifact and codesign/stapler/Gatekeeper acceptance. Local Windows output cannot certify this. |
| #849 | Requires inspection of a new macOS artifact and startup logs for the original Vulkan/build-machine-path problem. |
| #848 | Requires original legacy/current macOS simultaneous-start acceptance; this packaging change does not change cross-build locking. |
| #850 | Requires original macOS fresh-install/legacy-migration acceptance; Windows message persistence does not establish it. |
| #841 | Requires the originally affected split-mode workload and crash/hang evidence; no original reproduction details or native crash evidence were added by packaging. |
| #860 | Requires administrator confirmation of intended CodeQL configuration/check policy, in addition to successful analysis uploads. |
| #863 | Requires a successful fresh hosted Dependabot update on the final relevant main revision. |
| #851 | Not modified or closed. The separately observed Electron feed 404 is not proof that the original Tauri signature issue is resolved. |

No issue is closed by the local evidence in this report. Hosted follow-up should reference the pushed repair revision, job results and artifact IDs, and preserve failed/missing evidence explicitly.
