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
- `make dev-ios` / `make dev-android` — Mobile dev builds (Tauri mobile, `--features mobile`)

### Testing
- `yarn test` — Run all root Vitest projects (core, web-app, bundled extensions, and test infrastructure)
- `yarn test -- --run web-app/src/path/to/file.test.ts` — Run a single test file
- `yarn test:watch` — Run tests in watch mode
- `yarn test:coverage` — Run tests with v8 coverage
- `make test` — Full test suite: lint + Vitest + Rust cargo tests (src-tauri, tauri-plugin-hardware, src-tauri/utils)
- `make test-quality` — Module-level coverage audit + threshold gates
- `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri -- --test-threads=1` — Rust backend tests only

### Linting & Formatting
- `yarn lint` — ESLint for core and web-app workspaces
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

- **Frontend ↔ Backend**: Communication happens through Tauri IPC. Command handlers live in `src-tauri/src/core/<module>/commands.rs`; `src-tauri/src/commands/mod.rs` exposes the `desktop_handlers!` macro that registers them.
- **Core SDK**: Provides shared TypeScript types, contracts, and extension-facing APIs consumed by both `web-app/` and `extensions/`.
- **Extensions**: Packaged feature modules loaded by the app at runtime. Each extension is a separate workspace package under `extensions/` with its own build.
- **Build order matters**: `core` must be built before `web-app` or `extensions` (the `make` targets handle this).

### Frontend Structure (`web-app/src/`)

The frontend is organized by concern. Domain-specific code is grouped under top-level `hooks/`, `lib/`, `components/`, and `services/` folders.

- `hooks/` — Domain-organized hooks such as `chat/`, `threads/`, `models/`, `settings/`, `tools/`, `research/`, and `ui/`
- `components/` — Shared UI primitives, AI elements, common presentation components, animated icons, settings views, and left sidebar pieces
- `containers/` — Smart composed components that consume stores, call services, and manage navigation or dialogs
- `lib/` — Shared utilities and feature libraries such as `providers/`, `bootstrap/`, `platform/`, `markdown/`, `shortcuts/`, `models/`, `transport/`, and `ax-bi/`
- `services/` — Platform-abstracted API/IPC service adapters (each with `default.ts`/`tauri.ts`/`types.ts`)
- `routes/` — TanStack Router route definitions
- `stores/` — Zustand stores
- `schemas/` — Zod validation schemas
- `locales/` and `i18n/` — i18n translations and setup
- Path alias: `@` maps to `web-app/src/`

**Conventions:**
- Tests are co-located next to source files (`Foo.tsx` + `Foo.test.tsx`)
- Hooks use camelCase naming (`useChat.ts`, not `use-chat.ts`)
- Keep reusable cross-domain code in `components/`, `hooks/`, `lib/`, or `services/` rather than reaching into another domain-specific subfolder directly

### Rust Backend Structure (`src-tauri/src/`)

Organized as domain modules under `core/`, each exposing its Tauri commands from a `commands.rs`:

- `core/mcp/` — MCP server orchestration
- `core/downloads/` — Binary and model download management
- `core/threads/` — Thread/conversation persistence
- `core/research/` — Research workflow backend
- `core/server/` — Local API server and remote provider proxying
- `core/mlx/` — In-process MLX inference via ax-engine-sdk on macOS
- `core/extensions/`, `core/app/`, `core/filesystem/`, `core/system/`, `core/updater/` — Extension loading, app config, FS access, system utilities, and auto-update
- `commands/` — `desktop_handlers!` macro registering desktop commands

## Code Style

- **TypeScript**: No semicolons, single quotes, trailing commas (es5). ESLint + Prettier enforced. Prefer explicit types, avoid `any`. Functional React components.
- **Rust**: `cargo fmt` + `cargo clippy`. Structured error handling with `thiserror`. Edition 2021.
- **Vitest**: jsdom environment for web-app tests. `@testing-library/react` for component tests. Test files use `.test.ts`/`.test.tsx` suffix.

## Prerequisites

- Node.js 20+
- Yarn 4.5.3
- Rust toolchain (1.77.2+)
- Tauri CLI (`cargo install tauri-cli`)
