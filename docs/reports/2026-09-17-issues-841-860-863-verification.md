# Issues #841, #860 and #863: branch verification — 2026-09-17

Verified branch: `fix/windows-issues-20260916`, revision `b0cce441b67da47e103ec0c6694f1ff6256b7fd0`.

## Scope and disposition

The requested sequence is repair, test, report and push, followed by PR/merge/issue closure only when complete resolution is established. During this verification the user explicitly instructed that #860 and #863 should remain open and that #851 must always remain open. No change to #851, repository security policy, issue state or main was made.

The existing branch already contains the documented chat race repairs and dependency updates from `b6d3ae30`. This pass found no newly reproducible source defect and made no additional application or dependency change. It reran the relevant checks and obtained new remote evidence. This report is an acceptance record, not a claim that a new crash fix was implemented.

| Issue | Result | Closure decision |
| --- | --- | --- |
| #841 | Focused regressions, desktop stress and real local-model split conversations all pass. Original hang/process termination remains unreproduced. | Keep open: original affected environment and crash evidence remain missing. |
| #860 | A fresh branch CodeQL run and actual analysis upload succeeded. Default-setup configuration still returns 403 with the available credential. | Keep open as requested; inspect configuration/policy with an administrator. |
| #863 | Both local dependency graphs have zero vulnerability advisory entries; GitHub reports zero open Dependabot alerts. Latest hosted updater run remains an old failed job. | Keep open as requested; hosted updater acceptance remains unverified. |
| #851 | Excluded and unchanged. | Keep open. |

## #841: split-mode stability

Existing fixes reserve sends by thread ID across mounted views until asynchronous requests settle, observe rejection, isolate per-thread provider/model state and reject stale sends after thread changes during attachment processing. They address reproducible races but do not establish the cause of the original reported native termination.

Fresh checks on this branch:

| Check | Evidence |
| --- | --- |
| Focused regression suites | `use-thread-chat.test.ts`, `use-chat-send-handler.test.ts`, `DropdownModelProvider.focus.test.tsx`: **3 files / 52 tests passed**, exit 0. |
| Desktop fixture stress | **50 sequential right-pane turns plus concurrent turns in both panes; 52 upstream requests**, isolated model/history assertions pass, renderer error count 0, process exit 0. |
| Real-model desktop run | Local **qwen3:4b**, maximum 64 output tokens per request; **5 sequential right-pane turns plus concurrent turns; 7 upstream requests**, renderer error count 0, process exit 0. |
| Additional desktop assertions | Four arithmetic prompts persist expected answers without upstream calls; context-setting focus and model-search history tests pass. |

Desktop tests use the actual Electron bridge and built renderer, hidden BrowserWindows and isolated profiles/data folders. Both use `scripts/testing/issues-840-843-smoke.cjs`, with `--stress` or `--real-ollama`. They are not installer-upgrade tests or validation of every model, tool or LLM Router setting. Application sources are unchanged since the prior successful full production build.

The original issue and its current comments were reread. They still contain no original OS/app-version/model/backend/tool configuration or native crash dump sufficient to reproduce the termination. These details were requested during this task; none were supplied at report time. A targeted check of standard local AX Studio/Windows crash-log locations did not provide original crash evidence; this is not proof that no crash ever occurred.

The original failure was also not demonstrated by earlier simulated pre-fix runs, as explicitly recorded in the issue. Therefore passing present-day tests cannot be represented as a before/after reproduction of that crash. No speculative runtime change was introduced merely to produce a new “fix” commit.

Remaining acceptance: obtain the affected configuration and reproduction/crash evidence, reproduce or establish a supported causal diagnosis, then validate the correction under that workload. Until then, #841 is not certified fully resolved and the conditional PR/merge/closure step is not executed.

## #860: actual branch scan and configuration boundary

Manually dispatched the existing `.github/workflows/codeql.yml` on the target branch:

- [Run 35186569794](https://github.com/defai-digital/ax-studio/actions/runs/35186569794): **success** on `b0cce441b67da47e103ec0c6694f1ff6256b7fd0`.
- Code-scanning analysis **1790881971**, created `2026-09-17T05:40:51Z`, same branch/revision, empty `error` field. This confirms actual uploaded results, not merely a green job label.
- Available credential permissions: `maintain=true`, `push=true`, **`admin=false`**.
- `GET /code-scanning/default-setup`: **403**, “You are not authorized to read code scanning default setup.”
- `GET /branches/main/protection`: **404**; not treated as proof of intended policy or absence of protection.
- Rulesets list exposes one disabled repository rule, “Code Quality Copilot review for default branch”; this does not establish the intended CodeQL policy or every effective organization-level restriction.

The user selected “inspect current state first” rather than choosing a managed/custom scanner or required-check policy, then instructed that #860 remain open. No scanner was disabled and no merge requirement was changed. Administrator confirmation remains needed for the configuration portion of the issue. GitHub documents the default-setup endpoint and its permissions in the [Code scanning REST reference](https://docs.github.com/en/rest/code-scanning/code-scanning#get-a-code-scanning-default-setup-configuration).

## #863: vulnerability resolution versus hosted updater health

Fresh `yarn npm audit --all --recursive --json` runs:

| Dependency graph | Vulnerability advisory entries | Deprecation entries | Raw exit |
| --- | ---: | ---: | ---: |
| Root | 0 | 11 | 1 |
| Extensions | 0 | 1 | 1 |

All emitted entries were classified as deprecations. The raw nonzero exits are retained; they are not relabeled as successful exit codes. `GET /dependabot/alerts?state=open&per_page=100` returned **an empty array**. GitHub's repository alerts concern the default branch and are not a substitute for the separate local branch audit.

The latest hosted Dependabot run is still [34910975429](https://github.com/defai-digital/ax-studio/actions/runs/34910975429), failed on **old revision `4548fdff`**. Its [job 104198158072](https://github.com/defai-digital/ax-studio/actions/runs/34910975429/job/104198158072) was read directly:

- It processed a Vitest 3.2.6 dependency during the `/extensions` update phase, whereas the current manifests have already been aligned to 5.0.0.
- An attempted `yarn install --mode=update-lockfile` exited 1, followed by `record_update_job_unknown_error`. The available excerpt does not establish the underlying exception; no specific root cause is invented.
- Other reported security-update constraints concern the old dependency graph. Current audits and the empty GitHub alert list provide newer vulnerability evidence.

This distinguishes the repaired dependency/security state from the remaining hosted updater-health question. Rerunning an old Actions event would not, by itself, prove a fresh update on the repaired revision. GitHub's documented [Dependabot retry procedure](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/re-run-dependabot-jobs) uses the corresponding security alert's **Try again** action and identifies repository administrators/organization owners as eligible users. With no current open alerts, an administrator should inspect whether the historical task is now obsolete or obtain an appropriate fresh updater check; a successful nonexistent/no-op job must not be fabricated.

The user explicitly requested that #863 remain open. No alerts were dismissed, no dependency checks were disabled and no artificial configuration churn was used to force a green result.

## Reproduction and evidence

Focused tests:

```text
node node_modules/vitest/vitest.mjs run web-app/src/hooks/threads/__tests__/use-thread-chat.test.ts web-app/src/hooks/chat/__tests__/use-chat-send-handler.test.ts web-app/src/containers/__tests__/DropdownModelProvider.focus.test.tsx
```

Run the repository Electron executable against `scripts/testing/issues-840-843-smoke.cjs --stress`, then against the same script with `--real-ollama` when local qwen3:4b is available. The test harness itself creates isolated profiles/data. The local launcher clears `ELECTRON_RUN_AS_NODE` and `VITE_DEV_SERVER_URL` from the child environment.

Raw evidence retained locally under `tmp/three-issues-20260917/`: `read.json`, `codeql-runs.json`, `analyses.json`, `alerts.json`, `root-audit.json`, `extensions-audit.json`, `dependabot.log`, `stress.log`, `real.log`. Temporary data and prior unrelated workspace changes are excluded from the report commit.

No new full-suite, coverage, installer or macOS validation is claimed by this targeted pass. No PR was created, main was not merged and none of these issues was closed. Continue #841 when the requested original-environment evidence is available; preserve #860/#863/#851 as instructed.
