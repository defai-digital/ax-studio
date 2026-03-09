# Contributing to the Tauri Backend

[Back to main contributing guide](../CONTRIBUTING.md)

`src-tauri/` contains the Rust host application for AX Studio. This layer handles native system access, IPC commands, local storage, downloads, integrations, and other desktop-specific behavior.

## Core Areas

- `src/core/app/` application configuration and state
- `src/core/downloads/` download management
- `src/core/extensions/` extension-related native hooks
- `src/core/filesystem/` scoped file access
- `src/core/integrations/` integration-specific native logic
- `src/core/mcp/` MCP process and tool management
- `src/core/research/` research-related native flows
- `src/core/server/` local API server features
- `src/core/system/` OS and system-level behavior
- `src/core/threads/` conversation persistence
- `src/core/updater/` application update behavior

## Security Model

Tauri permissions are capability-based. When adding or changing commands, review the files under `capabilities/` and update permissions intentionally.

## Common Commands

From the repository root:

```bash
yarn dev:tauri
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml
```

## Expectations

- validate all inputs coming from the frontend
- keep filesystem access scoped and explicit
- use structured error handling
- update capabilities when adding new IPC surface
- add tests for behavior changes where practical

## Typical Workflow for a New Command

1. Add the Rust implementation in the relevant `src/core/*` area.
2. Register or expose the command through the existing backend wiring.
3. Update capability files if the command requires permissions.
4. Wire frontend usage through a service or hook rather than spreading raw IPC calls.
5. Test both success and failure paths.

## Common Pitfalls

- forgetting capability updates after adding a command
- assuming browser-mode frontend behavior matches desktop behavior
- returning poorly structured errors to the UI
