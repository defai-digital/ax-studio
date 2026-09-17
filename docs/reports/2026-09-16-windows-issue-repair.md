# Windows issue repair and verification

Base: latest fetched main `9b268613cfb4d7f5560374491db2b22cc258ddd9`.
Branch: `fix/windows-issues-20260916`.

The user requested local Windows repairs, tests and a report committed together on a new branch. Issue #851 is explicitly excluded: no updater implementation, updater configuration or release workflow is modified. No PR is merged, no issue is closed, and main is not modified by this work.

## Repairs

### #841: reproducible overlapping-send race

The old hook-local send guard was released immediately after starting the asynchronous SDK request. Before status synchronization, another send could enter; a second mounted view of the same thread also had an independent guard. A new regression failed against main because a rapid repeat was accepted instead of rejected.

Reservations are now shared by thread ID and remain held until the SDK request settles. Rejection releases the reservation and is observed without an unhandled promise rejection. Independent threads can still send concurrently, and the composer is not forced to await the entire stream. Attachment polling also checks the thread generation, so switching a mounted pane to another thread cannot resume a stale send after the shared mounted flag resets.

Regression coverage includes same-view repeats, two views of one thread, success and error cleanup, another thread sending in parallel, and switching threads during attachment processing. The isolated desktop smoke script now supports `--stress` for 50 sequential turns plus a concurrent turn in both panes.

This proves and fixes the sending races; it does not prove that either race caused the original reported native process crash. Original-environment crash acceptance remains distinct from the passing regression and stress evidence.

### #848: Windows secondary-process initialization

The Electron bridge used to initialize before single-instance ownership was acquired. The shell now acquires the existing Electron lock first; a rejected secondary process quits without registering bridge services. A regression imports the actual main entry with lock rejection and verifies no bridge registration or window creation. Existing file hand-off and reserved-port behavior remain covered.

This protects the current Electron process family. It does not retrofit a shared lock into an already shipped Tauri binary; the original macOS cross-build acceptance is not claimed complete.

### #866: consistent test UI

The core manifest still pinned `@vitest/ui` 3.2.6. Root and web workspaces did not explicitly declare a matching UI dependency. Root, core and web now declare UI 5.0.0 alongside the Vitest 5.0.0 runtime and coverage provider. The root lockfile was regenerated.

`scripts/testing/vitest-ui-smoke.cjs` launches a loopback-only Vitest server and an isolated Electron browser, opens the authenticated startup URL, verifies the selected test file and initial results, clicks the UI's Run current file control and checks that another test run passes. It preserves Vitest API authentication. Only the child process started by the smoke script is terminated during cleanup.

### #863: security dependency constraints

Current root audit contained 20 advisory entries affecting xmldom, brace-expansion and nanoid; extensions contained 2 brace-expansion entries. Updated bounded resolution ranges retain the installed major versions: xmldom 0.9.12, brace-expansion 2.1.4/5.0.12 and nanoid 5.1.16. Both lockfiles were regenerated.

After installation, both dependency graphs report **zero advisory entries**. Root still reports 11 deprecation notices and extensions 1; Yarn returns exit 1 for these notices, so this report does not mislabel the raw audit command as exit 0. Current registry tar latest is 7.5.22 and neither audit lists tar; the older report's tar-blocker statement is not current audit evidence. This is local dependency verification, not a claim that a hosted Dependabot update job was rerun successfully.

## Remaining issue boundaries

| Issue | Windows disposition |
| --- | --- |
| #850 | Current Electron missing-store load/save already creates a fresh store correctly; the existing real-filesystem regression was rerun. No legacy Tauri migration implementation was changed. |
| #860 | Both current main CodeQL workflows have successful result runs. Read-only default-setup inspection still returns HTTP 403; branch-protection inspection returns 404, which does not establish the administrator's intended check policy. No local source change can certify those settings. Administrator confirmation remains required. |
| #847, #849 | Remaining macOS signing/artifact acceptance is outside this Windows task. |
| #851 | Explicitly excluded and untouched. |

Main evidence for #860: [custom CodeQL](https://github.com/defai-digital/ax-studio/actions/runs/34911386026), [managed analysis](https://github.com/defai-digital/ax-studio/actions/runs/34911386107).

## Validation

Tests used Windows, Node 24.20.0, Yarn 4.5.3 and isolated desktop profiles. No actual signed installer upgrade or multi-GPU hardware matrix is claimed.

| Check | Result |
| --- | --- |
| New #841 race test against original main implementation | Failed as expected: rapid second send was incorrectly accepted. |
| Final full `yarn test:coverage` | Exit 0; 287 test files / **3,378 tests passed**. |
| Module coverage audit and blocking gate | Both exited 0; **all 18 modules passed**, thresholds unchanged. |
| Aggregate coverage | Statements 62.41%, branches 54.04%, functions 67.19%, lines 64.19%. |
| Whole-project `yarn lint` | Exit 0. |
| Final root and extensions `yarn install --immutable` | Both exited 0; no dependency graph changes required. |
| Full `yarn build:electron` | Exit 0; existing large-chunk notices remain. |
| Fixture desktop `issues-840-843-smoke.cjs --stress` | Exit 0; 50 sequential turns plus concurrent pane requests, **52 requests**, four behavior checks passed, zero renderer errors. |
| Real desktop `issues-840-843-smoke.cjs --real-ollama` | Exit 0; local qwen3:4b, **7 requests**, four checks passed, zero renderer errors; max_tokens=64. |
| Desktop credential smoke | Exit 0; legacy plaintext scrub, OS encryption, secret preservation and provider reload/startup restoration passed. |
| Real Vitest UI browser smoke | Exit 0; authenticated UI loaded, initial test results displayed, Run current file clicked and rerun passed. |
| Root/extension security audit | 20/2 advisory entries before; **0/0 after**. Deprecation-only notices remain (11/1), explaining raw audit exit 1. |

The UI smoke initially waited on an unauthenticated HTTP probe, then on an authentication redirect without a cookie jar. The final helper recognizes Vitest's 302 cookie bootstrap and lets Chromium follow it, and targets the actual Run current file control. These were validation-harness corrections; API authentication was never disabled. Final UI evidence is the successful run, not the earlier timed-out attempts.

Reproduction: run the usual root/extension installs, `yarn test:coverage`, the existing module audit/gate commands, `yarn lint` and `yarn build:electron`. Run desktop scripts with the repository Electron executable after building. For `vitest-ui-smoke.cjs`, set `AX_STUDIO_TEST_NODE` to a Node 24 executable. Raw logs are retained locally under `tmp/windows-*`; temporary profiles and downloads are excluded from the commit.

No hosted Dependabot retry, privileged CodeQL configuration change, or issue closure was performed. These local passing checks do not certify those external acceptance steps. The submitted report and repairs preserve the explicit #851 exclusion.
