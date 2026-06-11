# docs/drafts

Final repository-aligned PRD and ADR baseline documents produced from codebase and documentation review.

These files are final for the current repository assessment. They still identify client sign-off decisions where product scope, release policy, or acceptance thresholds cannot be inferred from the codebase alone.

## Contents

| File | Type | Description |
|---|---|---|
| `PRD-AX-Studio-Master.md` | PRD | Final master product requirements baseline covering product scope, NFRs, release acceptance, traceability, and sign-off decisions |
| `ADR-004-desktop-framework-choice.md` | ADR | Accepted decision for Tauri + React over Electron/Flutter/native-per-platform |
| `ADR-005-mcp-as-tool-integration-layer.md` | ADR | Accepted decision for MCP as the primary model/tool integration layer |
| `ADR-006-local-first-data-storage.md` | ADR | Accepted decision for local-first user workspace data |
| `ADR-007-multi-agent-orchestration-design.md` | ADR | Accepted direction for TypeScript-layer multi-agent orchestration |
| `ADR-008-extension-system-design.md` | ADR | Accepted decision for bundled TypeScript extensions and core lifecycle contracts |

## Existing docs (in docs/)

ADR-001 through ADR-003 and existing PRDs cover testing strategy, coverage hardening, and test stabilization — see `docs/adr/` and `docs/PRD-*.md`.
