# Technical Specification (as-built): AX Studio → AX BI Authoring Delegation

| Field | Value |
| --- | --- |
| Status | **Accepted / Phase 1 complete** (as-built note — not a migration plan) |
| Date | 2026-07-14 (original); refreshed 2026-07-19 |
| ADR | [../adr/ADR-002-AX-BI-OWNS-ANALYTICS-AUTHORING.md](../adr/ADR-002-AX-BI-OWNS-ANALYTICS-AUTHORING.md) |
| PRD | [../prd/PRD-AX-STUDIO-AX-BI-DELEGATION.md](../prd/PRD-AX-STUDIO-AX-BI-DELEGATION.md) (historical product context) |
| Supersedes | Pre–Phase 1 Studio-owned chart/dashboard generators |

This document describes **what shipped**, not a future work queue. Architectural ownership rules live in **ADR-002**. Prefer the code paths below if details diverge.

---

## 1. Outcome of Phase 1

- Studio **does not** own chart/dashboard domain compilation (no local metric SQL builders, viz type mapping, or dashboard layout engines).
- Studio **does** classify authoring intent, call AX BI high-level MCP tools, and project results (message + optional artifact URL / plan).
- Historical module `web-app/src/lib/ax-bi/dashboard-workflow.ts` was **removed**; do not reintroduce an equivalent generator.

---

## 2. Current module layout (`web-app/src/lib/ax-bi/`)

| Module | Role |
| --- | --- |
| `authoring-workflow.ts` | Intent classification, capability checks, delegation, result projection |
| `authoring-client.ts` | Thin adapter over `ServiceHub.mcp()` / MCP tool names |
| `sdk.ts` | Contract types + optional direct MCP client helpers |
| `datasets.ts` | MCP connection helpers, dataset listing for workspace |
| `endpoints.ts` | AX BI URL normalization |
| `mcp-result.ts` | Generic MCP envelope parsing |
| `tool-navigation.ts` | Safe result URL extraction for open-in-browser |
| `token-storage.ts` | Secure token storage for AX BI auth |
| `approved-file.ts` | Attachment/file approval helpers for upload flows |

**Call sites:** `web-app/src/containers/AxBiWorkspace.tsx`, `web-app/src/hooks/threads/use-thread-chat.ts`.

**Transport:** existing MCP stack under `web-app/src/services/mcp/` (headers, timeout, lifecycle). Authoring mutations avoid blind transport retries without idempotency.

---

## 3. High-level MCP operations (Studio → AX BI)

| Operation | Studio use |
| --- | --- |
| Capability discovery (authoring capabilities) | Negotiate before mutating calls; fail closed if missing/unauthorized |
| `create_chart_from_intent` | Chart / visualization authoring (incl. dry-run when not saving) |
| `plan_dashboard` | Dashboard plan / dry-run |
| `prompt_to_dashboard` | Dashboard create/build from prompt |
| `upload_and_plan` | Structured-data attachment upload + plan |

Studio must **not** invent chart form-data, SQL metrics, column inference, or dashboard layout on the client.

---

## 4. Classification rules (as implemented)

Classification only chooses **which high-level operation** to call — never chart config.

- **General chat:** intercept when the prompt clearly references AX BI **and** an authoring action, or when a supported data attachment is present with an explicit chart/dashboard/report ask. Do not intercept mere “graph/diagram” language for non-BI artifacts.
- **Dedicated AX BI workspace:** `force=true` (product context already implies AX BI).
- **Artifact kind:** dashboard/report language → dashboard path; otherwise chart path. Plan/dry-run language without create/build → plan tools.

See `authoring-workflow.ts` for the live regex/heuristics.

---

## 5. Workflow result shape (conceptual)

```ts
type AxBiAuthoringWorkflowResult =
  | { handled: false }
  | {
      handled: true
      delegated: true
      artifactType: 'chart' | 'dashboard' | 'plan'
      status: string // completed | partial | blocked | failed | dry_run (see SDK types)
      message: string
      artifactUrl?: string
      plan?: unknown | null
    }
```

UI shows `message`, optional plan, and opens `artifactUrl` only via safe external opener (not injected into the privileged Tauri webview).

---

## 6. Explicit non-goals (still true)

- No Studio-local chart/dashboard engine as fallback when AX BI is down.
- No second authoring implementation in REST/SDK that diverges from the MCP application service (future transports must share the same AX BI service).
- No automatic retry of mutating authoring calls without an AX BI idempotency contract.

---

## 7. Where to change what next

| Change | Owner doc / surface |
| --- | --- |
| Ownership / fail-closed policy | **ADR-002** |
| Product requirements / phases | PRD (historical); new work needs a new PRD if scope expands |
| Classification heuristics, tools, projection | **Code** under `web-app/src/lib/ax-bi/` |
| REST/SDK long-term transport | Future ADR + AX BI contract — not this as-built note |

---

## 8. Known issues (root-caused 2026-07-23)

### 8.1 Document attachment is dead on standard installs (AkiDB gate without AkiDB server)

**Symptom:** clicking "Attach Document" does nothing — the file picker never opens; only an error toast appears.

**Root cause (two-sided):**

- Frontend gate: `web-app/src/hooks/chat/use-document-attachment-handler.ts:372-389` (`handleAttachDocsIngest`) requires MCP tools `fabric_ingest_run` / `fabric_extract` from `serviceHub.mcp().getTools()` **before** opening the picker, and returns early otherwise. `getTools()` only lists tools from connected servers. A second hard requirement exists in `web-app/src/services/uploads/default.ts` (`ensureAkidbAvailable`).
- Backend removal: `src-tauri/src/core/mcp/constants.rs:12-53` — the `ax-studio` preset (`npx -y @ax-fabric/fabric-ingest mcp server`) was removed from `DEFAULT_MCP_CONFIG` because the npm package is unpublished (commit `894cf556`); migration v8 (`remove_unpublished_ax_studio_mcp_config`, `src-tauri/src/core/setup.rs`) also deletes it from existing user configs. The unit test at `constants.rs:60-64` asserts its absence.

Net effect: no `fabric_*` tools ever exist on fresh installs or upgraded installs that used the preset, so the gate always trips. The feature only works for users who manually point an `ax-studio` MCP entry at a local ax-fabric `cli.js` build.

**Scope note:** this is the AkiDB/fabric-ingest RAG attachment pipeline, orthogonal to AX BI delegation; recorded here because no other `.internal` doc covers attachments.

**Status (fixed):** graceful degrade shipped — pre-picker AkiDB hard gate removed; when `fabric_ingest_run` / `fabric_extract` are absent, attach forces inline mode and `parseDocument` falls back to local UTF-8 read for text-like types (`txt`/`md`/`csv`/`html`/`htm`). Embeddings ingest still requires AkiDB when chosen and tools are present. Binary formats still need fabric_extract for extract; embeddings path remains optional/enhanced.

### 8.2 ax-bi MCP toggle cannot be switched OFF

**Symptom:** the ax-bi switch in Settings → MCP servers flips back ON after toggling it off.

**Root cause chain:**

1. Toggle OFF → `toggleServer` writes `active: false` to config, then calls `deactivateMCPServer` (`web-app/src/routes/settings/mcp-servers.tsx:454-545`).
2. Backend `deactivate_mcp_server` (`src-tauri/src/core/mcp/commands.rs:158-163`) returns `"Server ax-bi not found"` when there is no running entry in `state.mcp_servers`.
3. The frontend catch block treats that as fatal and rolls the store back to `active: true` (HEAD version), rewriting the config — the switch reverts.

**Why ax-bi has no running entry while showing ON:** `connectAxBiMcpServer` (`web-app/src/lib/ax-bi/datasets.ts:104-131`) persists the config **without** the `Authorization` header (`removeAuthorizationHeader`, line 111) and injects the Bearer token only into the runtime activation call; the token lives in the OS keychain (`src-tauri/src/core/secrets/mod.rs`). At next app launch, boot-time activation (`run_mcp_commands`, `src-tauri/src/core/mcp/helpers.rs`) runs with the header-less config, fails (401 / endpoint down), and failed starts are never inserted into `state.mcp_servers` — yet `active: true` remains in config and UI. Same outcome when the HTTP connection drops mid-session.

**Secondary defect (still unfixed):** `connectAxBiMcpServer` bypasses the zustand store (`editServer`/`setServers`), so the settings toggle can show stale state until the next bootstrap reload; toggling ON from that stale state re-activates with the header-less config and also fails.

**Status (fixed):** frontend treats missing-running-server deactivate errors as success (`isMissingRunningServerError` in `web-app/src/lib/mcp/deactivate-errors.ts`, used by `mcp-servers.tsx` toggle OFF) so the switch stays OFF. Backend `deactivate_mcp_server` is idempotent: a missing map entry is success. Secondary defect (store sync after `connectAxBiMcpServer`) remains open and is out of scope for this toggle fix.
