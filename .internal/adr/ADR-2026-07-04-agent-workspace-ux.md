# ADR: Position AX Studio as a Local-First Agent Workspace

**Status:** Accepted for UX direction
**Date:** 2026-07-04
**Deciders:** Product and Engineering

## Context

AX Studio has inherited a chat-oriented product shape, while its strategic
value is broader: local inference, model routing, MCP tools, projects, local
knowledge, and trusted execution. A large app-shell rewrite would be risky and
would delay value, but leaving the UI as a generic chat client weakens the
product identity.

The repository already contains useful foundation surfaces:

- First-run setup in `web-app/src/containers/SetupScreen.tsx`
- Model/provider selection in `web-app/src/containers/DropdownModelProvider.tsx`
- MCP approval in `web-app/src/containers/dialogs/mcp/ToolApproval.tsx`
- System monitor in `web-app/src/routes/system-monitor.tsx`
- Multi-agent planning docs in `.internal/prd/PRD-Multi-Agent-Framework.md`

## Decision

Use an incremental "agent workspace" UX strategy:

1. Keep chat as the default operational surface.
2. Add a first-run workspace mode selection now.
3. Persist the mode locally for future personalization.
4. Evolve existing screens into workspace surfaces before adding empty routes.
5. Treat trust, runtime health, artifacts, and agent timelines as progressive
   enhancements backed by real data.

The first implementation slice is the onboarding mode selection because it is
low risk, user-visible, testable, and aligned with future navigation and routing
work.

## Rationale

- Onboarding is the earliest moment to set product identity.
- A local-only preference avoids backend migration risk.
- The current setup flow already has a wizard structure and test coverage.
- Persisting mode creates a stable hook for future default recommendations
  without committing to a full personalization system now.
- Avoiding empty nav items keeps the app honest and reduces user confusion.

## Consequences

### Positive

- AX Studio immediately feels less like a generic chat clone.
- The quick win is isolated to frontend setup state.
- Future IA, model routing, and trust work can reuse the stored preference.
- The implementation is easy to test with existing Vitest patterns.

### Negative

- The mode does not yet customize the whole app experience.
- Users may expect deeper personalization before Phase 2 ships.
- The chosen labels become product vocabulary and should be kept stable.

## Alternatives Considered

### Full sidebar redesign first

Rejected for Phase 1. The app has existing screens, but not every desired
workspace area has a complete route. Adding navigation before backing screens
would create dead ends.

### Trust panel first

Deferred. The current MCP approval dialog can be improved, but real risk
classification requires a stronger permission model than copy changes alone.

### Agent timeline first

Deferred. Timeline UX should be backed by structured run events from the
multi-agent/tool execution path, not handcrafted UI placeholders.

### Model picker first

Deferred. Better intent routing is important, but it needs a careful contract
between provider metadata, router settings, privacy constraints, and model
availability.

## Follow-Up Decisions

- Define whether workspace mode belongs in settings and whether changing it
  should rerun a guided setup checklist.
- Define the data contract for runtime health statuses.
- Define the event schema for agent run timeline entries.
- Define where artifacts are persisted and how they attach to threads/projects.
