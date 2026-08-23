# Contributing to AX Studio

AX Studio is currently **not accepting unsolicited public code contributions or pull requests**.

The most helpful ways to contribute right now are:

- open bug reports
- submit feature requests and wishlist items
- share product feedback and reproducible problem reports

If the contribution policy changes in the future, this document will be updated.

This repository is a Yarn workspace for the AX Studio desktop application. The app combines a React frontend, an Electron host (Node.js main process), shared TypeScript packages, and bundled extensions.

Use this file as the contributor entry point, then follow the package-specific guides for the area you are changing.

## Start Here

- [Web App Guide](./web-app/CONTRIBUTING.md)
- [Core SDK Guide](./core/CONTRIBUTING.md)
- [Extensions Guide](./extensions/CONTRIBUTING.md)
- [Electron Shell Guide](./electron/README.md)

## Repository Overview

| Path | Purpose |
| --- | --- |
| `web-app/` | React frontend, routes, components, stores, services |
| `core/` | Shared TypeScript SDK used by the app and extensions |
| `electron/` | Electron desktop shell: main/preload, IPC command handlers, packaging |
| `extensions/` | Bundled feature extensions |
| `scripts/` | Build, dev, test, and quality-gate utilities |
| `docs/` | Public docs (legal, release, architecture) |
| `mlx.version` | Pinned MLX runtime version (reserved for the future ax-engine runtime download) |
| `package.json` / `yarn.lock` / `vitest.config.ts` / `Makefile` | Workspace orchestration at repo root |

**Do not reorganize** package paths (`core/`, `web-app/`, `electron/`, `extensions/`, `mlx.version`) without updating CI and scripts. Generated roots such as `coverage/`, `report/`, and `node_modules/` stay gitignored and are removed by `make clean`.

## Prerequisites

- Node.js 24+
- Yarn `4.5.3`

## Development Setup

The default development flow from the repository root is:

```bash
git clone https://github.com/defai-digital/ax-studio
cd ax-studio
make dev
```

`make dev` installs dependencies, builds the shared core package, and launches the Electron app in development mode against the Vite dev server.

Local development ports:

| Port | Use |
| --- | --- |
| **31419** | AX Studio local inference API (`/v1`) |
| **31420** | AX Studio Vite dev server (loaded by the Electron shell) |
| **31430** | AX Studio Vite HMR (explicit host only) |

Keep the Studio frontend port in sync if you change it:
`web-app/vite.config.ts` (`server.port`) and `Makefile` `DEV_PORT`.

Useful alternatives:

```bash
make dev-web-app
make lint
make test
yarn test:coverage
bash scripts/testing/run-quality-gates.sh
```

## How the Pieces Fit Together

At a high level:

- `web-app/` renders the UI and user workflows
- `core/` provides shared TypeScript contracts and extension-facing APIs
- `extensions/` package feature logic that is bundled into the application
- `electron/` handles native capabilities, local filesystem access, downloads, and process management

Most frontend-to-native communication happens through Electron IPC (the web-app's `@tauri-apps/*` imports are aliased to a shim that bridges to the Electron main process), while shared app logic is exposed through the core SDK and extension system.

## Choosing Where to Work

- UI, routes, settings, and interaction behavior: `web-app/`
- Shared TypeScript contracts and extension interfaces: `core/`
- Feature packaging and extension lifecycle code: `extensions/`
- Native app commands, capabilities, and system integration: `electron/`
- End-to-end testing and automation flows: `autoqa/`

## Testing Expectations

Add or update tests when you change behavior.

Common commands:

```bash
yarn test
make test
make smoke
```

For focused work, package-level guides list more targeted commands.

## Coding Standards

### TypeScript

- Prefer explicit types and avoid `any`
- Keep React components functional and strongly typed
- Follow workspace ESLint and Prettier conventions
- Add or update tests for changed behavior

## Issues and Feedback

- Use GitHub Issues for bug reports, wishlist items, and product feedback
- Include reproduction steps, environment details, logs, or screenshots when relevant
- Search existing issues before opening a new one
- If you are unsure whether something is a bug or a feature request, open an issue with context

## Documentation Changes

Documentation improvements are welcome and needed. Prefer:

- one canonical source for setup instructions
- package-specific docs that describe only that package
- stable guides in `README.md`, `CONTRIBUTING.md`, or the index at `docs/README.md`
- release runbooks under `docs/release/`
- architecture decisions under local-only `.internal/adr/` (not public `docs/`)

Do not add expired reviews, gap dumps, or unchecked implementation plans to
`docs/`. Speculative design and ADRs belong under `.internal/`, not the public
docs tree.

## Getting Help

- Open or search GitHub issues in the repository
- Use the package-specific contributing guides for area-specific conventions
- When updating docs, prefer fixing inaccurate instructions rather than adding more parallel guidance
