# PRD: Source Folder Structure Restructure

**Version**: 1.0
**Date**: 2026-04-04
**Status**: Draft
**Author**: Engineering

---

## 1. Overview

### 1.1 Problem Statement

The AX Studio codebase has grown organically to ~700+ TypeScript files in `web-app/src/` alone. While the overall monorepo layout (web-app, core, extensions, src-tauri) is sound, the internal file organization within each package exhibits several structural issues that slow down developer onboarding, reduce discoverability, and create maintenance friction:

- **Mixed naming conventions** in hooks (6 kebab-case vs 50 camelCase files)
- **Flat, layer-based organization** for large directories like `hooks/` (56 top-level hooks) and `containers/` (39 top-level files + 32 dialogs)
- **Tests separated from source** via centralized `__tests__/` subdirectories across all major directories
- **Orphaned/dead files** such as dash-prefixed files in `routes/threads/` (`-MainThreadPane.tsx`, `-MessagesArea.tsx`, etc.)
- **Unclear type ownership** with types scattered between a centralized `types/` directory (15 files) and service-local `types.ts` files (20+)
- **No feature-based grouping** for the frontend — related components, hooks, stores, and services for a single feature live in entirely separate directory trees

### 1.2 Objective

Restructure the source folder layout to follow **feature-first organization** where feasible, enforce **consistent naming conventions**, **co-locate tests with source**, and **clean up dead code** — without changing runtime behavior or requiring a big-bang migration.

### 1.3 Design Philosophy

- **Incremental migration** — move files feature-by-feature, not all at once. Each migration PR should be self-contained and reviewable.
- **Feature-first, layer-second** — group by domain feature at the top level, then by layer (components, hooks, services) within each feature.
- **Shared code stays shared** — truly cross-cutting utilities, UI primitives, and global types remain in shared directories.
- **Co-locate what changes together** — tests, types, and styles that belong to a module live next to it.
- **Convention over configuration** — standardize naming patterns so developers never have to guess.

### 1.4 Success Criteria

- All hook files follow a single naming convention (camelCase)
- Dead/orphaned files are removed
- At least the 3 largest feature areas (chat, settings, multi-agent) are migrated to feature-based structure
- Tests are co-located with their source files
- A documented folder convention guide exists for contributors
- Zero runtime regressions — all existing tests pass throughout migration

---

## 2. Current State Analysis

### 2.1 Monorepo Structure (Healthy — No Changes Needed)

```
ax-studio/
├── web-app/          # React 19 frontend
├── core/             # Shared TypeScript SDK
├── extensions/       # Bundled feature extensions (4)
├── src-tauri/        # Rust Tauri backend
├── autoqa/           # E2E test framework
├── scripts/          # Build and release utilities
└── docs/             # Architecture and design docs
```

The monorepo-level separation is clean and well-defined. No changes proposed at this level.

### 2.2 web-app/src/ Current Layout (Layer-Based)

```
web-app/src/
├── components/       118 files — UI primitives + feature components
├── containers/       116 files — smart/logic-heavy components
├── hooks/            124 files — custom React hooks (naming inconsistency)
├── lib/              139 files — feature-scoped utilities (well-organized)
├── services/          72 files — platform abstraction layer (well-organized)
├── routes/            47 files — TanStack Router definitions
├── types/             15 files — global type definitions
├── stores/             4 files — Zustand stores
├── providers/         13 files — React context providers
├── utils/             18 files — utility functions
├── schemas/           14 files — data validation schemas
├── constants/          8 files — application constants
├── i18n/               7 files — internationalization setup
├── locales/           12 dirs  — translation files
├── data/               1 file  — static data
└── styles/             2 files — global CSS
```

### 2.3 Identified Issues

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| 1 | Mixed hook naming (kebab-case vs camelCase) | High | `hooks/` |
| 2 | Orphaned dash-prefixed files | High | `routes/threads/` |
| 3 | Centralized `__tests__/` dirs separate tests from source | Medium | All major dirs |
| 4 | Flat hook directory with 56 top-level files | Medium | `hooks/` |
| 5 | Flat containers dir with 39 top-level + 32 dialog files | Medium | `containers/` |
| 6 | Partial barrel exports (dialogs exports 12 of 32) | Medium | `containers/dialogs/` |
| 7 | Mixed `.ts` and `.d.ts` pattern in types | Low | `types/` |
| 8 | `components/` mixes UI primitives with feature components | Low | `components/` |
| 9 | No feature grouping — related hook/component/service in separate trees | Medium | Throughout |

### 2.4 What Already Works Well

These patterns should be preserved and extended:

- **`services/` platform abstraction**: Each service uses `default.ts` / `tauri.ts` / `types.ts` with a barrel `index.ts`. Excellent pattern.
- **`lib/` feature-scoped utilities**: Subdirectories like `multi-agent/`, `research/`, `chat/` are well-organized with barrel exports.
- **`core/src/` structure**: Domain-scoped types (`types/model/`, `types/assistant/`, etc.) with co-located tests. Good model to follow.
- **`core/src/browser/`**: Co-locates tests next to source (`core.ts` + `core.test.ts`). Target pattern.
- **`src-tauri/src/core/`**: Feature-based Rust modules (`mcp/`, `downloads/`, `threads/`) each with `commands.rs`, `helpers.rs`, `models.rs`, `mod.rs`, `tests.rs`. Clean and consistent.

---

## 3. Proposed Structure

### 3.1 Target web-app/src/ Layout (Feature-First Hybrid)

```
web-app/src/
├── features/                    # NEW — feature-scoped modules
│   ├── chat/
│   │   ├── components/          # ChatInput, MessagesArea, etc.
│   │   ├── hooks/               # useChat, useChatSendHandler, useChatAttachments
│   │   ├── lib/                 # chat utilities (from lib/chat/)
│   │   ├── stores/              # chat-session-store
│   │   └── types.ts
│   ├── settings/
│   │   ├── components/          # Settings containers/dialogs
│   │   ├── hooks/               # useGeneralSetting, useInterfaceSettings, etc.
│   │   └── routes/              # settings route files
│   ├── multi-agent/
│   │   ├── components/          # AgentEditor, AgentTeamBuilder, etc.
│   │   ├── hooks/               # related hooks
│   │   ├── lib/                 # from lib/multi-agent/
│   │   └── stores/              # agent-team-store
│   ├── threads/
│   │   ├── components/          # ThreadView, MainThreadPane, etc.
│   │   ├── hooks/               # useThreads, useThreadManagement, usePinnedThreads
│   │   └── routes/              # thread route files
│   ├── research/
│   │   ├── components/          # from components/research/
│   │   ├── hooks/               # useResearch, useResearchPanel
│   │   └── lib/                 # from lib/research/
│   ├── models/
│   │   ├── components/          # AddModel, EditModel, DeleteModel, etc.
│   │   └── hooks/               # useModelProvider, useModelLoad, useFavoriteModel
│   ├── providers/
│   │   ├── components/          # AddProviderDialog, DeleteProvider
│   │   └── hooks/               # useProviderModels
│   ├── assistants/
│   │   ├── components/          # AddEditAssistant, DeleteAssistant
│   │   └── hooks/               # useAssistant
│   ├── mcp/
│   │   ├── components/          # AddEditMCPServer, DeleteMCPServerConfirm
│   │   └── hooks/               # useMCPServers
│   └── downloads/
│       ├── components/
│       └── hooks/               # useDownloadStore
│
├── components/                  # SHARED UI primitives only
│   ├── ui/                      # shadcn/ui library (unchanged)
│   ├── animated-icon/           # Icon animations (unchanged)
│   └── left-sidebar/            # Navigation (unchanged)
│
├── hooks/                       # SHARED cross-cutting hooks only
│   ├── useHotkeys.ts
│   ├── useMediaQuery.ts
│   ├── useClickOutside.ts
│   ├── useTheme.ts
│   └── ...                      # ~15 truly shared hooks
│
├── services/                    # Unchanged — already well-organized
├── lib/                         # SHARED utilities only (platform, bootstrap, markdown, transport)
├── routes/                      # Route shell files (delegate to feature components)
├── providers/                   # React context providers (unchanged)
├── types/                       # Global/shared types only
├── utils/                       # Shared utility functions (unchanged)
├── schemas/                     # Validation schemas (unchanged)
├── constants/                   # App constants (unchanged)
├── i18n/                        # Internationalization (unchanged)
├── locales/                     # Translation files (unchanged)
├── data/                        # Static data (unchanged)
└── styles/                      # Global styles (unchanged)
```

### 3.2 Feature Module Convention

Each feature directory follows this internal structure:

```
features/<feature-name>/
├── components/
│   ├── FeatureComponent.tsx
│   └── FeatureComponent.test.tsx      # Co-located test
├── hooks/
│   ├── useFeatureHook.ts
│   └── useFeatureHook.test.ts         # Co-located test
├── lib/                               # Feature-specific utilities (optional)
├── stores/                            # Feature-specific Zustand stores (optional)
├── types.ts                           # Feature-scoped types (optional)
└── index.ts                           # Barrel export
```

Rules:
- **Co-locate tests**: `Foo.tsx` and `Foo.test.tsx` live side by side. No separate `__tests__/` directories.
- **Barrel exports**: Each feature has an `index.ts` exporting its public API.
- **Feature-scoped types**: Types used only within a feature live in `features/<name>/types.ts`. Shared types stay in `types/`.
- **No cross-feature imports**: Features import from `@/services`, `@/components/ui`, `@/hooks`, `@/lib` (shared), and `@ax-studio/core`. Features should not import directly from other features — if sharing is needed, extract to a shared location.

### 3.3 Naming Conventions (Standardized)

| Category | Convention | Example |
|----------|-----------|---------|
| React components | PascalCase | `ChatInput.tsx` |
| Hooks | camelCase with `use` prefix | `useChat.ts` |
| Utilities/lib | camelCase | `costEstimation.ts` |
| Types files | camelCase | `types.ts` |
| Test files | Same name + `.test` suffix | `useChat.test.ts` |
| Directories | kebab-case | `multi-agent/`, `left-sidebar/` |
| Constants | camelCase file, UPPER_SNAKE exports | `routes.ts` → `export const THREAD_ROUTE = ...` |
| Schemas | kebab-case with `.schema` suffix | `assistants.schema.ts` |
| Route files | kebab-case (TanStack convention) | `agent-teams.tsx` |

### 3.4 core/ Structure (Minor Improvements)

The core SDK is already well-organized. Proposed minor changes:

```
core/src/
├── browser/              # Unchanged — co-located tests already in place
├── types/                # Unchanged — domain-scoped subdirectories
│   ├── model/
│   ├── assistant/
│   ├── thread/
│   ├── inference/
│   ├── config/
│   ├── engine/
│   ├── mcp/              # Already exists
│   ├── message/          # Already exists
│   ├── hardware/         # Already exists
│   └── ...
└── @global/              # Unchanged
```

No structural changes needed. Core already follows the co-located test pattern.

### 3.5 src-tauri/ Structure (No Changes)

The Rust backend is already well-organized with feature-based modules:

```
src-tauri/src/core/
├── mcp/           # commands.rs, helpers.rs, models.rs, tests.rs, mod.rs
├── downloads/     # Same pattern
├── threads/       # Same pattern
├── filesystem/    # Same pattern
├── server/        # Same pattern
├── app/           # Same pattern
├── research/      # Same pattern
├── integrations/  # Same pattern
├── code_execution/
├── updater/
├── extensions/
├── system/
├── state.rs
├── agent_teams.rs
├── agent_run_logs.rs
└── mod.rs
```

This is already a good feature-based structure. No changes proposed.

### 3.6 extensions/ Structure (No Changes)

Extensions are isolated workspace packages, each with a clean structure. No changes needed.

---

## 4. Migration Plan

### 4.1 Phase 0: Cleanup (1-2 PRs)

**Goal**: Remove dead code and fix naming inconsistencies without moving files.

| Task | Details |
|------|---------|
| Remove dash-prefixed files | Delete `-MainThreadPane.tsx`, `-MessagesArea.tsx`, `-SplitThreadContainer.tsx`, `-ThreadView.tsx` from `routes/threads/` after confirming they are unused |
| Standardize hook naming | Rename 6 kebab-case hooks to camelCase: `use-chat.ts` → `useChat.ts`, `use-mobile.ts` → `useMobile.ts`, `use-chat-send-handler.ts` → `useChatSendHandler.ts`, `use-document-attachment-handler.ts` → `useDocumentAttachmentHandler.ts`, `use-image-attachment-handler.ts` → `useImageAttachmentHandler.ts`, `use-sidebar-resize.ts` → `useSidebarResize.ts` |
| Fix partial barrel exports | Update `containers/dialogs/index.ts` to export all 32 dialogs, or remove the barrel and use direct imports |

### 4.2 Phase 1: Co-locate Tests (3-4 PRs)

**Goal**: Move tests from `__tests__/` subdirectories to sit next to their source files.

Migration order:
1. `hooks/__tests__/` → move each test next to its hook (50 files)
2. `components/__tests__/` → move each test next to its component (13 files)
3. `containers/__tests__/` → move each test next to its container (28 files)
4. `lib/__tests__/`, `utils/__tests__/`, `providers/__tests__/`, `schemas/__tests__/`, `constants/__tests__/` (remaining)

Each PR:
- Move test files
- Update any relative imports in test files
- Verify `vitest` still discovers and passes all tests
- Remove empty `__tests__/` directories

### 4.3 Phase 2: Introduce features/ Directory (4-6 PRs, one per feature)

**Goal**: Migrate the highest-value feature areas into `features/` modules.

Recommended migration order (by impact and cohesion):

**PR 1: `features/multi-agent/`**
- Move from: `lib/multi-agent/*`, `components/AgentEditor.tsx`, `components/AgentTeamBuilder.tsx`, `components/AgentOutputCard.tsx`, `components/TeamVariablePrompt.tsx`, `stores/agent-team-store.ts`, relevant hooks
- Rationale: Most self-contained feature, minimal cross-dependencies

**PR 2: `features/chat/`**
- Move from: `hooks/useChat.ts`, `hooks/useChatSendHandler.ts`, `hooks/useChatAttachments.ts`, `containers/ChatInput.tsx`, `lib/chat/*`, `stores/chat-session-store.ts`, `lib/transport/*`
- Rationale: Core feature with clear boundaries

**PR 3: `features/threads/`**
- Move from: `routes/threads/*` (component files, not route definitions), `hooks/useThreads.ts`, `hooks/useThreadManagement.ts`, `hooks/usePinnedThreads.ts`, `hooks/thread/*`
- Rationale: Already partially grouped in routes/threads/

**PR 4: `features/research/`**
- Move from: `components/research/*`, `hooks/useResearch.ts`, `hooks/useResearchPanel.ts`, `lib/research/*`
- Rationale: Clean feature boundary

**PR 5: `features/settings/`**
- Move from: `routes/settings/*` (component logic), `containers/dialogs/*` (settings-related), `hooks/useGeneralSetting.ts`, `hooks/useInterfaceSettings.ts`, `hooks/useRouterSettings.ts`
- Rationale: Largest route section, benefits most from grouping

**PR 6: `features/models/`, `features/providers/`, `features/assistants/`, `features/mcp/`**
- Smaller features batched together
- Move CRUD containers (AddModel, EditModel, DeleteModel, etc.) and their hooks

### 4.4 Phase 3: Thin Out Shared Directories

After feature extraction, the shared directories should be significantly smaller:

| Directory | Before | After (estimated) |
|-----------|--------|-------------------|
| `hooks/` | 56 files | ~15 truly shared hooks |
| `containers/` | 39 + 32 files | ~10 cross-cutting containers |
| `components/` | 118 files | ~60 shared UI + primitives |
| `lib/` | 139 files | ~30 shared utilities |

### 4.5 Phase 4: Path Alias Updates

Update `web-app/vite.config.ts` and `web-app/tsconfig.json` to add a feature path alias:

```ts
// vite.config.ts resolve.alias
'@/features': path.resolve(__dirname, './src/features')
```

This is optional since `@/features/chat/...` already resolves via the existing `@` → `src/` alias.

---

## 5. Import Path Migration Strategy

### 5.1 Approach: Barrel Re-exports During Transition

To avoid a big-bang migration of all import paths:

1. Move files to `features/<name>/`
2. Create `features/<name>/index.ts` barrel export
3. Add a temporary re-export in the old location pointing to the new location
4. Over subsequent PRs, update consumers to import from the new path
5. Remove re-exports once all consumers are updated

Example:
```ts
// OLD: hooks/useChat.ts (temporary re-export)
export { useChat } from '@/features/chat/hooks/useChat'

// NEW: features/chat/hooks/useChat.ts (actual implementation)
export function useChat() { ... }
```

### 5.2 Lint Rule

Add an ESLint rule (or comment convention) to flag deprecated re-export files so they don't persist indefinitely.

---

## 6. Validation & Rollback

### 6.1 Per-PR Validation Checklist

- [ ] All existing tests pass (`yarn test`)
- [ ] Lint passes (`yarn lint`)
- [ ] Dev server starts without errors (`yarn dev:web`)
- [ ] Tauri app builds and launches (`make dev`)
- [ ] No circular dependency warnings
- [ ] Import paths are updated (no broken imports)

### 6.2 Rollback Strategy

Each migration PR is independently revertable. Feature moves are isolated — reverting a single PR restores the previous file locations and re-export shims ensure no downstream breakage during transition.

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large diff PRs are hard to review | Medium | One feature per PR. Move files first (no logic changes), then refactor imports in a follow-up |
| Import path churn across the codebase | Medium | Temporary re-export shims at old locations. IDE "update imports" automation. |
| Merge conflicts with concurrent feature work | High | Coordinate migration PRs during low-activity periods. Merge Phase 0 and Phase 1 first as they are lower risk. |
| Unclear feature boundaries — some hooks/components span features | Medium | When in doubt, keep in shared directory. Only move files with clear single-feature ownership. |
| TanStack Router file-based routing breaks if route files move | High | Route files in `routes/` stay as thin wrappers. Only move component logic into features, not the route definitions themselves. |

---

## 8. Out of Scope

- **Monorepo-level restructuring** — The top-level split (web-app, core, extensions, src-tauri) is sound and not changing.
- **Rust backend restructuring** — `src-tauri/src/core/` is already well-organized with feature-based modules.
- **Core SDK restructuring** — `core/src/` already follows co-located tests and domain-scoped types.
- **Extension restructuring** — Extensions are isolated packages and don't need changes.
- **Runtime behavior changes** — This is purely a file organization effort. No logic changes.
- **Build system changes** — Vite, Vitest, and Tauri configs may need minor path updates but no fundamental changes.

---

## 9. Appendix

### A. Files to Delete (Phase 0)

```
web-app/src/routes/threads/-MainThreadPane.tsx
web-app/src/routes/threads/-MessagesArea.tsx
web-app/src/routes/threads/-SplitThreadContainer.tsx
web-app/src/routes/threads/-ThreadView.tsx
```

### B. Files to Rename (Phase 0)

```
hooks/use-chat.ts                        → hooks/useChat.ts
hooks/use-chat-send-handler.ts           → hooks/useChatSendHandler.ts
hooks/use-document-attachment-handler.ts  → hooks/useDocumentAttachmentHandler.ts
hooks/use-image-attachment-handler.ts     → hooks/useImageAttachmentHandler.ts
hooks/use-mobile.ts                      → hooks/useMobile.ts
hooks/use-sidebar-resize.ts              → hooks/useSidebarResize.ts
```

### C. Hook Classification (Shared vs Feature-Scoped)

**Remain in shared `hooks/`** (~15 hooks):
- `useClickOutside`, `useHotkeys`, `useMediaQuery`, `useMobile`, `useTheme`, `useSidebarResize`, `useServiceHub`, `useAppState`, `useBackendUpdater`, `useAppUpdater`, `useHardware`, `useReleaseNotes`, `useTokensCount`, `useProxyConfig`, `useLocalApiServer`

**Move to `features/chat/hooks/`**:
- `useChat`, `useChatSendHandler`, `useChatAttachments`, `useMessages`, `useAttachments`, `useAttachmentIngestionPrompt`, `useDocumentAttachmentHandler`, `useImageAttachmentHandler`, `usePrompt`, `useCodeExecution`

**Move to `features/threads/hooks/`**:
- `useThreads`, `useThreadManagement`, `usePinnedThreads`, `thread/*` (9 files)

**Move to `features/settings/hooks/`**:
- `useGeneralSetting`, `useInterfaceSettings`, `useRouterSettings`, `useIntegrations`, `useMemory`

**Move to `features/models/hooks/`**:
- `useModelProvider`, `useModelLoad`, `useFavoriteModel`, `useModelSources`, `useModelContextApproval`, `useLlamacppDevices`, `useProviderModels`

**Move to `features/multi-agent/hooks/`**:
- `useToolApproval`, `useToolAvailable`, `useTools`

**Move to `features/research/hooks/`**:
- `useResearch`, `useResearchPanel`

**Move to `features/mcp/hooks/`**:
- `useMCPServers`

**Move to `features/assistants/hooks/`**:
- `useAssistant`
