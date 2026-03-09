# Contributing to Tauri Plugins

[Back to main contributing guide](../../CONTRIBUTING.md) | [Back to Tauri backend guide](../CONTRIBUTING.md)

`src-tauri/plugins/` contains Rust plugins used by AX Studio for specialized native integrations.

## Current Plugins

- `tauri-plugin-hardware/` hardware and system information
- `tauri-plugin-llamacpp/` llama.cpp process and inference integration

## When to Add a Plugin

Use a plugin when the behavior is:

- native-specific
- reusable at the plugin boundary
- permission-sensitive
- awkward to keep inside the general backend command layer

Do not create a plugin just to avoid organizing code inside `src-tauri/src/core/`.

## Typical Structure

```text
tauri-plugin-name/
  Cargo.toml
  src/
  guest-js/
  permissions/
```

## Common Commands

Run commands from the specific plugin directory unless noted otherwise.

```bash
cargo test
cargo build
```

Test the plugin through the main app from the repository root when integration behavior matters:

```bash
make dev
```

## Expectations

- validate command inputs
- define explicit permissions
- handle platform differences intentionally
- keep plugin APIs small and clear
- test plugin behavior in isolation and, where needed, through the app

## Security Notes

Permission files should stay specific. Avoid wildcard-style permissions and make the allowed surface easy to reason about during review.
