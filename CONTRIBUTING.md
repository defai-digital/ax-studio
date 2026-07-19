# Contributing to AX Studio

AX Studio is currently **not accepting unsolicited public code contributions or pull requests**.

The most helpful ways to contribute right now are:

- open bug reports
- submit feature requests and wishlist items
- share product feedback and reproducible problem reports

If the contribution policy changes in the future, this document will be updated.

This repository is a Yarn workspace for the AX Studio desktop application. The app combines a React frontend, a Rust Tauri host, shared TypeScript packages, and packaged extensions.

Use this file as the contributor entry point, then follow the package-specific guides for the area you are changing.

## Start Here

- [Web App Guide](./web-app/CONTRIBUTING.md)
- [Core SDK Guide](./core/CONTRIBUTING.md)
- [Extensions Guide](./extensions/CONTRIBUTING.md)
- [Tauri Backend Guide](./src-tauri/CONTRIBUTING.md)
- [Tauri Plugins Guide](./src-tauri/plugins/CONTRIBUTING.md)

## Repository Overview

| Path | Purpose |
| --- | --- |
| `web-app/` | React frontend, routes, components, stores, services |
| `core/` | Shared TypeScript SDK used by the app and extensions |
| `extensions/` | Packaged feature extensions |
| `src-tauri/` | Rust host app, IPC commands, capabilities, plugins |
| `autoqa/` | Automated quality assurance and end-to-end runners |
| `docs/` | Public documentation (legal, release, architecture, ADRs, product) |
| `scripts/` | Build, test, and quality-gate utilities |

## Prerequisites

- Node.js 24+
- Yarn `4.5.3`
- Rust toolchain
- Tauri CLI

Install Tauri CLI if needed:

```bash
cargo install tauri-cli
```

## Development Setup

The default development flow from the repository root is:

```bash
git clone https://github.com/defai-digital/ax-studio
cd ax-studio
make dev
```

`make dev` installs dependencies, builds the shared packages and extensions, downloads required binaries, and launches the Tauri app in development mode.

Local development ports:

| Port | Use |
| --- | --- |
| **31419** | AX Studio local inference API (`/v1`) |
| **31420** | AX Studio Vite / Tauri frontend |
| **31421** | AX BI MCP (`MCP_PORT`, `…/mcp`) |
| **31422** | AX BI frontend dev (`NODE_PORT`) |
| **31423** | AX BI web app (`AXBI_PORT`) |
| **31424**–**31426**, **31429** | AX BI services / WS / nginx |
| **31430** | AX Studio Vite HMR (explicit host only) |
| **5432** / **6379** | Postgres / Redis (AX BI) |

Keep the Studio frontend triple in sync if you change it:
`web-app/vite.config.ts` (`server.port`), `src-tauri/tauri.conf.json`
(`build.devUrl`), and `Makefile` `DEV_PORT`. AX BI port constants:
`web-app/src/lib/ax-bi/endpoints.ts` and `src-tauri/src/core/mcp/constants.rs`.

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
- `extensions/` package feature logic that is loaded by the application
- `src-tauri/` handles native capabilities, local filesystem access, downloads, and process management
- `src-tauri/plugins/` contains lower-level Rust plugins for specialized native integrations

Most frontend-to-native communication happens through Tauri IPC, while shared app logic is exposed through the core SDK and extension system.

## Choosing Where to Work

- UI, routes, settings, and interaction behavior: `web-app/`
- Shared TypeScript contracts and extension interfaces: `core/`
- Feature packaging and extension lifecycle code: `extensions/`
- Native app commands, capabilities, and system integration: `src-tauri/`
- Plugin-specific native behavior: `src-tauri/plugins/`
- End-to-end testing and automation flows: `autoqa/`

## Testing Expectations

Add or update tests when you change behavior.

Common commands:

```bash
yarn test
make test
cargo test --manifest-path src-tauri/Cargo.toml
```

For focused work, package-level guides list more targeted commands.

## Coding Standards

### TypeScript

- Prefer explicit types and avoid `any`
- Keep React components functional and strongly typed
- Follow workspace ESLint and Prettier conventions
- Add or update tests for changed behavior

### Rust

- Run `cargo fmt`
- Run `cargo clippy -- -D warnings` for touched crates when practical
- Validate command inputs and use structured error handling

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
