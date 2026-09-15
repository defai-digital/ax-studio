# Sequential dependency and repair integration

The user authorized PR #862 first, then a detailed repair PR, followed by tests on merged main. PR #861 remains closed and unmerged; a new PR carries the final repair integration.

## Sequence and conflict resolution

PR #862 (`86f61b05`) was merged into main as `4548fdff`. Main was then integrated into `fix/issues-840-843-20260914`. Seven files conflicted: root `package.json` and `yarn.lock`, `core/package.json`, and the package manifests for assistant-extension, conversational-extension, download-extension and llamacpp-api.

The resolved manifests retain the repair branch's exact Vitest 5.0.0 and coverage 5.0.0 versions and required Vite 7.3.5 peer dependencies. The lockfile combines dependency resolutions from both sides, selecting newer versions for shared descriptors; Yarn regenerated the canonical graph and removed unused entries. Every changed non-workspace dependency descriptor from #862 was checked against the resulting graph. The only removed descriptor is `vitest@npm:^5.0.0`, replaced by the exact `vitest@npm:5.0.0` at the same version.

This retains #862's humanfs, xmldom, browser-data, browserslist, fflate and js-yaml upgrades and its additional transitive updates, including ip-address, postcss and undici. It also retains the repair branch's desktop/chat fixes, security changes, workflows, regression tests and reports. No conflict was resolved by replacing the entire result with one branch's lockfile.

## Validation before the final merge

- Root and extensions immutable installs passed.
- All 15 scripts/testing files and 82 regression tests passed on Node 24.
- The earlier repair revision passed 3,374 tests, 18 coverage gates, the desktop fixture/real-model/credential checks, and all 13 GitHub checks. These historical results do not replace testing the final merged revision.
- A remaining @vitest/ui 3.2.6 versus Vitest 5.0.0 peer mismatch was observed during installation and is recorded as a new issue. CLI tests do not validate the interactive test UI.

## Post-merge validation and issue closure policy

Post-merge full coverage, module gates, lint, build, desktop fixture/real-model/credential checks and main CI results will be recorded on the final PR and applicable issues after execution. Close only issues with merged fixes and sufficient passing evidence. Keep #841, #847, #848, #850, #851 and #863 open for their previously documented reproduction, signed-release, migration/coexistence or upstream acceptance conditions. Preserve any other issue whose acceptance is not established by the final evidence.

See [the repair report](2026-09-14-open-issue-repair.md) for the complete 21-issue scope, detailed fixes, and validation limitations.
