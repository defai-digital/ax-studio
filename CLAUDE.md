# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AX Studio is a cross-platform AI workspace built with a React 19 frontend (Vite + TypeScript) and a Rust Tauri 2.8 backend. It is structured as a Yarn 4.5.3 monorepo.

## Common Commands

### Development
- `make dev` — Full dev setup: install deps, build core+extensions, download binaries, launch Tauri app with hot reload
- `make dev-web-app` — Frontend-only dev server (Vite on port 1420), no Rust/Tauri needed
- `yarn dev:web` — Start just the Vite dev server (requires core already built)
- `yarn build:core` — Build the shared core SDK (run from root)
- `yarn build:extensions` — Build all bundled extensions

### Testing
- `yarn test` — Run all Vitest tests (core, web-app, llamacpp-extension)
- `yarn test -- --run web-app/src/path/to/file.test.ts` — Run a single test file
- `yarn test:watch` — Run tests in watch mode
- `yarn test:coverage` — Run tests with v8 coverage
- `make test` — Full test suite: lint + Vitest + Rust cargo tests
- `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri -- --test-threads=1` — Rust backend tests only

### Linting & Formatting
- `yarn lint` — ESLint via web-app workspace
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
| `autoqa/` | Python-based E2E test framework |
| `scripts/` | Build, test, and release utilities |

### How the Pieces Connect

- **Frontend ↔ Backend**: Communication happens through Tauri IPC. The web-app invokes Tauri commands defined in `src-tauri/src/commands/`.
- **Core SDK**: Provides shared TypeScript types, contracts, and extension-facing APIs consumed by both `web-app/` and `extensions/`.
- **Extensions**: Packaged feature modules loaded by the app at runtime. Each extension is a separate workspace package under `extensions/` with its own build.
- **Build order matters**: `core` must be built before `web-app` or `extensions` (the `make` targets handle this).

### Frontend Structure (`web-app/src/`)

The frontend uses a **feature-first** organization. Domain-specific code lives in `features/`, while shared/cross-cutting code stays in top-level directories.

- `features/` — Feature modules, each with its own `components/`, `hooks/`, `lib/`, `stores/`
  - `chat/` — Chat hooks, transport layer, session store, input components
  - `multi-agent/` — Agent editor, team builder, orchestration lib, cost estimation
  - `threads/` — Thread management hooks, thread view components
  - `research/` — Research panel, parsers, scrapers
  - `models/` — Model CRUD dialogs, provider/download hooks
  - `assistants/` — Assistant CRUD, useAssistant hook
  - `mcp/` — MCP server dialogs, useMCPServers hook
  - `providers/` — Provider CRUD dialogs
- `components/` — Shared UI primitives (Radix UI based), animated icons, left sidebar
- `containers/` — Cross-cutting composed components and remaining dialogs
- `hooks/` — Shared cross-cutting hooks (theme, hotkeys, media query, sidebar, app state)
- `lib/` — Shared utilities: `providers/`, `bootstrap/`, `platform/`, `markdown/`, `shortcuts/`
- `services/` — Platform-abstracted API/IPC service adapters (each with `default.ts`/`tauri.ts`/`types.ts`)
- `routes/` — TanStack Router route definitions (thin wrappers that delegate to feature components)
- `schemas/` — Zod validation schemas
- `locales/` — i18n translations (15+ languages)
- Path alias: `@` maps to `web-app/src/`

**Conventions:**
- Tests are co-located next to source files (`Foo.tsx` + `Foo.test.tsx`)
- Hooks use camelCase naming (`useChat.ts`, not `use-chat.ts`)
- Feature modules should not import from other feature modules directly

### Rust Backend Structure (`src-tauri/src/`)

- `commands/` — Tauri IPC command handlers
- `core/mcp/` — MCP server orchestration
- `core/downloads/` — Binary and model download management
- `core/state/` — Application state management
- `core/providers/` — Provider integrations

## Code Style

- **TypeScript**: No semicolons, single quotes, trailing commas (es5). ESLint + Prettier enforced. Prefer explicit types, avoid `any`. Functional React components.
- **Rust**: `cargo fmt` + `cargo clippy`. Structured error handling with `thiserror`. Edition 2021.
- **Vitest**: jsdom environment for web-app tests. `@testing-library/react` for component tests. Test files use `.test.ts`/`.test.tsx` suffix.

## Prerequisites

- Node.js 20+
- Yarn 4.5.3
- Rust toolchain (1.77.2+)
- Tauri CLI (`cargo install tauri-cli`)
