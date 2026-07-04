# Tech Spec: Agent Workspace Quick Wins

**Status:** Draft
**Date:** 2026-07-04
**Scope:** Frontend UX quick wins with no backend migration

## 1. Current State

The app already has a first-run setup wizard, model provider configuration,
MCP tool approval, system monitor, local API settings, provider settings, and
multi-agent planning docs. The quick-win implementation should extend those
surfaces instead of creating new parallel abstractions.

## 2. Implementation Slice 1: Workspace Mode Selection

### Files

- `web-app/src/containers/SetupScreen.tsx`
- `web-app/src/constants/localStorage.ts`
- `web-app/src/containers/__tests__/SetupScreen.test.tsx`

### Data Contract

Add a local storage key:

```ts
workspaceMode: 'workspace-mode'
```

Stored value is one of:

```ts
type WorkspaceModeId =
  | 'simple-chat'
  | 'local-private-ai'
  | 'developer-agent'
  | 'knowledge-workspace'
  | 'controlled-workspace'
```

### UI Behavior

- Insert a mode-selection step after the welcome step.
- Default selection: `developer-agent`.
- Selection is local UI state until setup completion.
- On setup completion or skip, write both:
  - `setup-completed = true`
  - `workspace-mode = selected mode`
- The final setup step should summarize the selected mode in plain language.

### Test Coverage

Update setup tests to cover:

- The wizard now has 6 steps.
- The mode step appears after welcome.
- The default mode is visible.
- Selecting a different mode persists it on completion.
- Skip persists the default mode.

## 3. Implementation Slice 2: Sidebar IA

Do not add empty top-level routes. Future sidebar work should group existing
routes first:

- Runtime: system monitor, local API server, downloads
- Tools: MCP servers, tool approvals
- Models: hub, providers, engine settings
- Activity: logs

When implementing, prefer small navigation changes with tests around route
targets and collapsed sidebar behavior.

## 4. Implementation Slice 3: Trust Panel

The current MCP approval dialog already has action buttons and parameter
display. Future work should add:

- Human-readable action summary
- Permission scope
- Risk classification
- Persistence choice
- Tool/server identity
- Link to MCP settings

Risk labels must be derived from explicit rules. Do not show high-confidence
security claims from weak heuristics.

## 5. Implementation Slice 4: Model Intent UX

Future model selection improvements should reuse:

- `web-app/src/lib/ax-bi/model-intent.ts` patterns for intent extraction
- router settings in `web-app/src/hooks/settings/useRouterSettings.ts`
- provider/model metadata from existing provider services

The UI can add model hints, but routing behavior must remain separate from
decorative labels.

## 6. Implementation Slice 5: Runtime Health

The existing system monitor shows CPU and memory. A local AI health dashboard
should wait for authoritative status APIs for:

- ax-engine
- ax-serving
- llama.cpp
- MLX
- MCP servers
- Local API
- embedding DB
- memory index

Until then, avoid pretending that unknown services are healthy or unhealthy.

## 7. Rollout Plan

1. Ship workspace mode selection.
2. Add settings visibility for the selected mode.
3. Group existing runtime/tool/model links in the sidebar.
4. Improve MCP approval layout with explicit action/scope/risk fields.
5. Add real runtime health cards as backend status APIs become available.

## 8. Validation

Minimum validation for Slice 1:

```sh
yarn test -- --run web-app/src/containers/__tests__/SetupScreen.test.tsx
```

Broader validation before merging a UX batch:

```sh
yarn lint
yarn test -- --run web-app/src/containers/__tests__/SetupScreen.test.tsx
```
