# AGENTS.md

This file provides guidance to agentic coding agents working in this repository.

## Project Overview

AX Studio is a cross-platform AI workspace built with a React 19 frontend (Vite + TypeScript) and a Rust Tauri 2.8 backend. It is a Yarn 4.5.3 monorepo.

## Commands

### Development
- `make dev` — Full dev setup: install deps, build core+extensions, download binaries, launch Tauri app with hot reload
- `make dev-web-app` — Frontend-only dev server (Vite on port 1420), no Rust/Tauri needed
- `yarn dev:web` — Start just the Vite dev server (requires core already built)
- `yarn build:core` — Build the shared core SDK (run from root)
- `yarn build:extensions` — Build all bundled extensions
- `make dev-ios` / `make dev-android` — Mobile dev builds (Tauri mobile, `--features mobile`)

### Testing
- `yarn test` — Run all Vitest tests (core, web-app, extensions)
- `yarn test -- --run web-app/src/path/to/file.test.ts` — Run a single test file
- `yarn test -- --run -t "test name pattern"` — Run tests matching a name pattern
- `yarn test:watch` — Run tests in watch mode
- `yarn test:coverage` — Run tests with v8 coverage
- `make test` — Full suite: lint + Vitest + Rust cargo tests (src-tauri, tauri-plugin-hardware, src-tauri/utils)
- `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri -- --test-threads=1` — Rust backend tests only
- `make test-quality` — Module-level coverage audit + threshold gates

### Linting & Type Checking
- `yarn lint` — ESLint for both core and web-app workspaces
- `cargo fmt --manifest-path src-tauri/Cargo.toml` — Format Rust code
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` — Lint Rust code

### Building
- `make build` — Production build for current platform
- `make clean` — Remove all build artifacts, node_modules, caches

## Architecture

### Monorepo Layout

| Path | Role |
|------|------|
| `web-app/` | React 19 frontend — routes, components, stores, services |
| `core/` | Shared TypeScript SDK (`@ax-studio/core`) used by app and extensions |
| `extensions/` | Bundled feature extensions (assistant, conversational, download, llamacpp) |
| `src-tauri/` | Rust Tauri backend — IPC commands, native capabilities, MCP, downloads |
| `src-tauri/plugins/` | Rust plugins for specialized native integrations (hardware, llamacpp) |
| `scripts/` | Build, test, and release utilities |

**Nested workspaces gotcha**: The root Yarn workspace only covers `core` and `web-app`. `extensions/` and `src-tauri/plugins/` are *separate* Yarn workspaces with their own `yarn.lock` — a root `yarn install` does not install their dependencies (the `make` targets and `yarn build:extensions` handle this).

### How the Pieces Connect

- **Frontend ↔ Backend**: Tauri IPC. Command handlers live in `src-tauri/src/core/<module>/commands.rs`; `src-tauri/src/commands/mod.rs` is the `desktop_handlers!` macro that registers them all.
- **Core SDK**: Provides shared TypeScript types, contracts, and extension-facing APIs consumed by both `web-app/` and `extensions/`.
- **Extensions**: Packaged feature modules loaded by the app at runtime. Each extension is a separate workspace package under `extensions/` with its own build.
- **Build order matters**: `core` must be built before `web-app` or `extensions` (the `make` targets handle this).

### Frontend Structure (`web-app/src/`)

Organized by **concern**, not by feature. Domain-specific code is spread across `hooks/`, `lib/`, `components/`, and `services/` directories, each sub-foldered by domain.

- `hooks/` — Domain-organized hooks: `chat/`, `threads/`, `models/`, `settings/`, `tools/`, `research/`, `ui/` (generic UI hooks like theme, hotkeys, media query)
- `components/` — Shared UI primitives (Radix/shadcn-based in `ui/`), AI-specific presentation (`ai-elements/`), common presentational components (`common/`), left sidebar, animated icons
- `containers/` — Smart components that consume stores, call services, manage navigation/modals. Compose presentational children with business logic.
- `lib/` — Pure utilities and feature libraries: `bootstrap/`, `chat/`, `markdown/`, `providers/`, `shortcuts/`, `themes/`, `models/`, `platform/`, `transport/`, `prompts/`, etc.
- `services/` — Platform-abstracted API/IPC service adapters (each with `default.ts`/`tauri.ts`/`types.ts`)
- `routes/` — TanStack Router route definitions (thin wrappers that delegate to containers/hooks): `hub/`, `project/`, `settings/`, `threads/`
- `stores/` — Zustand stores (e.g., `chat-session-store.ts`)
- `schemas/` — Zod validation schemas
- `locales/` — i18n translations
- Path alias: `@` maps to `web-app/src/`

**Component placement rules** (from `docs/CONVENTIONS.md`):
- `components/` — Pure presentation: no Zustand stores, no `serviceHub()` calls, no navigation. Props in, JSX out.
- `containers/` — Smart components: consume stores, call services, manage navigation/modals/side effects.

### Rust Backend Structure (`src-tauri/src/`)

Organized as domain modules under `core/`, each exposing Tauri commands from a `commands.rs`:

- `core/mcp/` — MCP server orchestration (lifecycle, monitoring, tool calls, cancellation)
- `core/downloads/` — Binary and model download management
- `core/threads/` — Thread/conversation persistence (CRUD for threads, messages, thread assistants)
- `core/filesystem/` — File I/O commands, YAML read/write, binary files, akidb config
- `core/app/` — App configuration, data folder management
- `core/extensions/` — Extension loading, install/uninstall
- `core/system/` — System utilities (relaunch, factory reset, logs, file explorer)
- `core/server/` — Local API server and remote provider proxying
- `core/research/` — Research workflow backend (URL scraping)
- `core/updater/` — Auto-update
- `core/mlx/` — In-process MLX inference via ax-engine-sdk (macOS only, `#[cfg(target_os = "macos")]`)
- `core/state.rs` — Central `AppState` struct
- `core/setup.rs` — App setup and run lifecycle handlers
- `commands/mod.rs` — `desktop_handlers!` macro registering all commands

**Module layout convention**: Each `core/<feature>/` module contains: `mod.rs`, `commands.rs`, `helpers.rs`, `models.rs`, optionally `constants.rs` and `tests.rs`.

## Code Style

### TypeScript Formatting (Prettier + ESLint enforced)
- **No semicolons**, **single quotes**, **trailing commas** (es5 style)
- **Strict TypeScript**: `strict: true`, `noUnusedLocals`, `noUnusedParameters`
- **Named exports only** — never use `export default`
- Prefix unused variables/params/catch with `_` (ESLint `argsIgnorePattern: '^_'`)
- Avoid `any`; use explicit types. `interface` for contracts, `type` for unions/compositions
- Use `import type` for type-only imports

### Imports
Order: external packages → internal packages → path-alias (`@/`) → relative (`./`)
```ts
import { useState } from 'react'
import { create } from 'zustand'
import { useChat } from '@ai-sdk/react'
import type { ModelProvider } from '@ax-studio/core'
import { useServiceHub } from '@/hooks/useServiceHub'
import { extractModelName } from './models'
```

### React Hooks & Components
- **Hooks**: `function` declarations, never arrow. Always `use` prefix (`useChat`, `useTheme`)
- **Zustand stores**: `create<StateType>()(persist(...))` pattern
- **Components**: Functional React components only
- Hook structure: type aliases → refs → store selectors → useMemo/useCallback → effects → return

### Service Adapter Pattern
Each service directory (`services/<name>/`) contains:
- `types.ts` — Interface contract (e.g., `ProvidersService`)
- `default.ts` — Web/fallback implementation (class implementing interface, stubs return empty/no-op)
- `tauri.ts` — Desktop implementation (extends `default.ts`, overrides methods needing Tauri IPC)

Access via `useServiceHub()` hook in React, `getServiceHub()` in non-React code. The `ServiceHub` singleton is initialized once at startup via `initializeServiceHub()`, which dynamically imports Tauri service modules or sets up web fallbacks based on `isPlatformTauri()`.

### Error Handling (TypeScript)
- **Services**: `try/catch` + `console.error` + return fallback values (empty arrays, null)
- **Hooks**: Let errors propagate through async/promise chains
- **Lib utilities**: Return `undefined` for invalid inputs rather than throwing

### Error Handling (Rust)
- Central `AppError` enum using `thiserror` with `#[serde(tag = "kind", content = "message")]`
- `From` impls for `io::Error`, `serde_json::Error`, etc. enabling `?` operator
- Tauri commands return `Result<T, String>` — AppError converts to String via `From` impl
- Logging: `log::info!`, `log::warn!`, `log::error!` macros

### Naming Conventions
- **TS files**: camelCase for hooks (`useChat.ts`), camelCase or kebab-case for libs
- **TS types**: PascalCase (`ThemeState`, `CustomChatOptions`)
- **TS constants**: camelCase for functions, UPPER_SNAKE_CASE for enum-like objects
- **Rust**: snake_case functions/files, PascalCase structs/enums, UPPER_SNAKE_CASE constants
- **Test files**: co-located, `.test.ts` / `.test.tsx` suffix (e.g., `useChat.ts` + `useChat.test.ts`)

### Testing (Vitest)
- **Environment**: jsdom with `@testing-library/react`
- **Setup**: `web-app/src/test/setup.ts` provides mock `ServiceHub`, `matchMedia`, `globalThis.core/fs`, `localStorage`
- **Hook tests**: Use `renderHook` from `@testing-library/react`
- **Zustand tests**: Use `store.getState()`, `store.setState()` directly
- **Mocking**: `vi.hoisted()` + `vi.mock()` for module mocks; `vi.fn()` for function mocks
- **Assertions**: `expect` BDD style (`toBe`, `toEqual`, `toContain`, `toHaveBeenCalledWith`)
- **Reset**: `vi.clearAllMocks()` in `beforeEach`

### Cross-Domain Imports
Keep reusable cross-domain code in `components/`, `hooks/`, `lib/`, or `services/` rather than reaching into another domain-specific subfolder directly.

### Rust Conventions
- Each domain has a directory under `core/` with `commands.rs`, `helpers.rs`, `models.rs`, `constants.rs`, `mod.rs`
- Tauri commands: `pub async fn name<R: Runtime>(app: AppHandle<R>, state: State<'_, XState>, ...) -> Result<T, String>`
- State: `Arc<Mutex<...>>` with tokio Mutex; lock minimally (collect refs, drop lock, then operate)
- File size: Rust files over ~800 lines should be split into sub-modules
- Tests: unit tests as inline `#[cfg(test)] mod tests`; integration tests in a separate `tests.rs` file

## Prerequisites

- Node.js 20+
- Yarn 4.5.3
- Rust toolchain (1.77.2+)
- Tauri CLI (`cargo install tauri-cli`)
