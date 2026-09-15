# Open issue repair and verification

Branch: `fix/issues-840-843-20260914`. Audit date: 2026-09-14.

This work covers the 21 open issues present at the start of the audit. Issues remain open until the repair branch is merged and any outstanding acceptance checks are satisfied. PR #861 must remain unmerged. This report does not claim that changes to a development branch repair previously shipped Tauri binaries.

## Changes

Merged main `e83bd99d` into the repair branch without conflicts. Incorporated the existing macOS port-reservation and AX Engine doctor-version repairs as `2f51c79e` and `4e7319ee`. The existing arithmetic, split conversation, focus, search history and local runtime repairs remain included.

New changes preserve existing model files on failed download replacement; accept genuine ZIP root-directory entries while rejecting files and special entries at the root; restrict pending OS-open-file draining to the main renderer's main frame; resolve window labels independently of focus and display titles; accept bounded Homebrew Cellar targets; skip Vulkan probing on macOS; and make reports trackable without force-add.

CI now tests the MLX TypeScript source instead of requiring an unbuilt Electron artifact. The automatic labeling workflow creates missing mapped labels, supports scoped conventional titles, and no longer needs a checkout. Published macOS builds require signing/notarization credentials and must pass codesign, stapler and Gatekeeper checks before artifact upload. The packaging workflow initializes pinned Yarn rather than referencing a nonexistent checked-in Yarn file. CodeQL gains an explicit manual trigger.

Authentication compares API-key bytes with timingSafeEqual rather than using fast password hashes. Two smoke-test code-construction findings were removed by returning credential data for comparison outside the renderer and using fixed fixture thread IDs in static renderer code.

Vitest and its coverage provider are aligned at 5.0.0 across workspaces with the required Vite peer. Updated dependency constraints include qs 6.16.0, Homebrew-related ip-address resolution 10.5.0, postcss 8.5.26, brace-expansion 2.1.4 for the old pinned range, and tar 7.5.22. Both lockfiles were regenerated. The pre-existing local extension lockfile was backed up under tmp before regeneration; unrelated routeTree.gen.ts changes were excluded from commits.

## Issue disposition

| Issue | Repair/evidence | Remaining acceptance |
| --- | --- | --- |
| #840 | Existing deterministic arithmetic repair; fixture and real-model desktop checks pass. | Review/merge. |
| #841 | Existing pane isolation and busy-send guards; five sequential turns and concurrent pane requests pass with real qwen3:4b. | Original native hang/exit was not reproduced; original-environment confirmation remains necessary. |
| #842 | Settings trigger separated from model popover; desktop input retains focus/value. | Review/merge. |
| #843 | Search-history keyboard recall and draft restoration; desktop checks pass. | Review/merge. |
| #847 | Publishing now fails without signing/notarization and verifies the produced app before upload. | A signed, notarized release must be built and assessed on macOS with release credentials. This Windows session cannot certify an actual distributed artifact. |
| #848 | Incorporated reserved-port fallback repair; existing Electron single-instance lock remains in place. | Cross-build coexistence with the already shipped Tauri executable needs macOS validation; this branch cannot retrofit that executable with a shared lock. |
| #849 | macOS Vulkan probing now returns before invoking vulkaninfo; regression test verifies no invocation. | Previously released Tauri binary/build-path leakage is not changed retroactively. |
| #850 | Retired Rust migration path is absent from this Electron branch; fresh store creation is covered by a real filesystem test. | Validate first-run migration on the replacement release; no claim that the old Tauri package itself was patched. |
| #851 | Electron updater and latest-mac.yml/latest.yml release feeds replace the obsolete Tauri latest.json verifier; packaged updater IPC exercised with a controlled provider. | Real signed release upgrade and legacy Tauri-to-Electron migration remain release acceptance checks. |
| #852 | Incorporated --version then doctor --json/install.version fallback and tests from the macOS branch. | Review/merge; source branch report includes physical Mac evidence. |
| #853 | Added !docs/reports/** to .gitignore. | Review/merge. |
| #854 | Removed destructive unlink/retry fallback; failed rename preserves old file and replacement. Fault-injection plus successful real replacement tests. | Review/merge. |
| #855 | Genuine ./ directory is a no-op; root files, traversal and special entries remain rejected. Real ZIP fixtures. | Review/merge. |
| #856 | Trust only canonical Cellar targets reached through explicitly trusted Homebrew bin aliases; escaping links rejected. | Physical Homebrew smoke verification remains desirable; both Mac prefixes tested with simulated metadata. |
| #857 | IPC sender and main-frame identity checked before queue drain/readiness changes. Child/subframe rejection and correct main drain tested. | Review/merge. |
| #858 | Stable child label registry plus live main-window getter; focused child and recreated main tested. | Review/merge. |
| #859 | MLX suite imports source; no runtime artifact prerequisite remains for that suite. | Full clean CI verification after push. |
| #860 | Current main and PR Analyze jobs succeeded before this repair, unlike the historical failure. Manual revalidation trigger added. | Repository-level scanner settings are not exposed to the available credential; successful runs do not establish every admin setting. |
| #863 | Removed known old workspace pins and aligned Vitest/coverage; both dependency graphs refreshed. | Upstream tar advisory has no fixed version according to the failed updater log (lowest-non-vulnerable-version=null); npm latest remains 7.5.22. Cannot claim the Dependabot job is fully repaired until an upstream fix and rerun succeed. |
| #864 | Missing labels created via API before assignment; scoped titles supported. | GitHub PR job must pass after push. |
| #865 | Addressed both API-key hash findings and both smoke-code construction findings. | CodeQL must rescan the pushed revision; no alerts were dismissed or checks suppressed. |

## Validation

The first full Vitest 5 run exposed one non-constructible FileReader mock; that fixture was corrected. A new updater test required consistent module resolution across the Electron and test workspaces; the test alias was corrected. ZIP rejection assertions check the safety outcome rather than requiring a particular rejection stage. Added actual open-menu selection/submenu navigation and session callback/title-edit tests to meet the existing coverage thresholds without lowering them. Windows uses the same thread-worker pool as its CI lane. A nonzero coverage exit despite passing assertions was traced to an unawaited, unused importActual in DropdownModelProvider.phase4.test.tsx, not a proven worker-cleanup defect; the placeholder test was replaced with an actual empty-provider rendering assertion, eliminating the late module import after environment teardown.

- Final CI-equivalent coverage command exited 0: 287 files, 3,374 tests passed, zero failed assertions and no unhandled errors. The subsequent module gate command also exited 0.
- All 18 module coverage gates passed: stores lines/functions 100%/100%; components/ui lines/functions 85.2%/91.2%; all other modules exceed their existing thresholds.
- Aggregate coverage: lines 64.13%, statements 62.33%, functions 67.14%, branches 53.96% (includes Electron and infrastructure code as well as web app).
- Full Electron build and final runtime rebuild passed.
- Whole-project lint passed.
- Root and extensions immutable dependency installs passed.
- All workflow YAML files parsed successfully.
- Isolated Electron fixture dialogue passed: 7 model requests, all four behavior checks, zero renderer errors.
- Isolated real Ollama qwen3:4b dialogue passed: 7 model requests, all four behavior checks, zero renderer errors; generation capped at 64 tokens per request.
- Isolated credential smoke passed: legacy plaintext scrub, OS-encrypted disk value, secret preservation, and provider restoration after reload/startup refresh.

## GitHub verification follow-up

At 75f0c678, Windows/macOS/Ubuntu full tests, both desktop compatibility lanes, CodeQL analysis and the alert gate, labeling, workflow lint and secret scanning passed. The coverage job passed its head tests and module gates but failed when downloading the absent main-branch baseline artifact. The baseline job checks out old main code, so the head's source-import fix cannot repair that checkout. The workflow now builds baseline Electron runtime before baseline coverage and treats a missing baseline artifact as an explicit upload error rather than silently reporting success. This follow-up changes CI setup only; the previously validated application code is unchanged.

No issue is closed by this work. No release is published, no updater signatures are bypassed, and PR #861 is not merged.

Final remote verification at `2ac4f886a3d7bba73374fa0e5b7e5793fe57e549`: all 13 reported checks completed successfully, including Windows/macOS/Ubuntu tests, baseline coverage and final coverage comparison, both desktop compatibility lanes, both CodeQL analyses and the alert gate, PR labeling, workflow lint and secret scanning. See [tests and coverage run](https://github.com/defai-digital/ax-studio/actions/runs/34882552412). This supersedes the pending GitHub verification entries for #859, #864 and #865 above; the other stated acceptance limitations still apply.
