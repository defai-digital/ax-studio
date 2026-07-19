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
