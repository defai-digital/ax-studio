# Code Organization Conventions

This document defines the boundaries between the primary directories in the
`web-app` and `src-tauri` codebases. Follow these rules when adding new files
so the project stays navigable as it grows.

## Web app (`web-app/src/`)

### `components/` — pure presentation
A file belongs in `components/` if it:
- **Does not** import from `@/hooks/*` Zustand stores (except the truly
  generic `hooks/ui/*` hooks like `useClickOutside`)
- **Does not** import from `@/services/*` or call `serviceHub()`
- **Does not** perform navigation (`useNavigate`, `useRouter`, `router.navigate`)
- Takes props in, returns JSX out

**Sub-folders:**
- `components/ui/` — shadcn-style primitives (button, dialog, dropdown, sidebar)
- `components/ai-elements/` — AI-message-specific presentation (reasoning, tool, code block)
- `components/common/` — shared app-level presentational components (CopyButton,
  Card, AvatarEmoji, GlobalError, PlatformMetaKey, ProvidersAvatar, Capabilities)
- `components/left-sidebar/`, `components/research/`, etc. — feature-scoped
  presentational clusters
- `components/animated-icon/` — Lottie/animation assets

### `containers/` — smart components
A file belongs in `containers/` if it:
- Consumes one or more Zustand stores via `@/hooks/*`
- Calls `serviceHub()` to invoke backend services
- Manages navigation, modals, or cross-cutting side effects
- Composes presentational children with business logic

Containers may legitimately grow large. When a container exceeds ~500 lines,
look for pure-presentation sub-pieces that can be extracted into
`components/common/` or a feature sub-folder under `components/`.

### `hooks/` — organized by feature
Hooks are sub-foldered by the domain they belong to:
- `hooks/chat/` — chat send, attachments, messages
- `hooks/threads/` — thread list, pinned threads, management
- `hooks/models/` — model providers, favorites, loading
- `hooks/settings/` — general/interface/router settings
- `hooks/tools/` — MCP, tool approval, availability
- `hooks/research/` — deep research hooks
- `hooks/ui/` — generic UI utilities (theme, hotkeys, media query, click outside)

### `lib/` — pure utilities and feature libraries
- Feature clusters go in sub-folders: `lib/bootstrap/`, `lib/chat/`,
  `lib/markdown/`, `lib/multi-agent/`, `lib/research/`, `lib/artifacts/`, etc.
- Top-level files should be small, widely-shared utilities (`utils.ts`, `crypto.ts`).
- Any file that crosses 500 lines should be moved into its own sub-folder.

### `routes/` — file-based routing only
Files under `routes/` are consumed by TanStack Router. Keep them thin:
- Route definition + layout composition
- Data loading via loaders
- Delegate business logic to containers and hooks

If you find yourself writing complex rendering logic inside a `routes/*.tsx`
file, that logic belongs in a container.

### `constants/` vs `types/` vs `schemas/`
- `constants/` — runtime constant values (strings, numbers, config objects)
- `types/` — TypeScript `type`/`interface` definitions, enums that describe data shapes
- `schemas/` — Zod validators; types should be derived via `z.infer<typeof X>`

## Rust backend (`src-tauri/src/`)

### Module layout
Each `core/<feature>/` module follows this pattern:
```
core/<feature>/
├── mod.rs          # module root
├── commands.rs     # #[tauri::command] entry points
├── helpers.rs      # pure functions used by commands
├── models.rs       # structs, enums, serde types
├── constants.rs    # const values (optional)
└── tests.rs        # integration tests (optional)
```

### Tests
- **Unit tests** — inline `#[cfg(test)] mod tests` at the bottom of the file
  being tested.
- **Integration tests** — separate `tests.rs` file in the module, used when
  tests need a mock app or shared fixtures.

### File size
Any Rust file over ~800 lines should be split into sub-modules. For example:
- `mcp/helpers.rs` → `mcp/lifecycle.rs`, `mcp/monitoring.rs`, `mcp/shutdown.rs`, `mcp/config.rs`
- `filesystem/commands.rs` → `filesystem/fs_commands.rs`, `filesystem/akidb.rs`

## Adding a new feature

Before creating files, ask:
1. Is there an existing feature folder this belongs to? Prefer grouping over
   creating a new top-level directory.
2. Does the new code need a store/service? → container or hook.
3. Is it pure rendering? → component.
4. Is it a utility function? → `lib/<feature>/*`.
5. Is it a type? → `types/` or co-locate with the feature if only one place
   uses it.

When in doubt, match the closest existing pattern in the same folder.
