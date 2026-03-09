# Contributing to Extensions

[Back to main contributing guide](../CONTRIBUTING.md)

Extensions package feature logic that can be loaded by AX Studio. They should stay focused, composable, and aligned with the `@ax-studio/core` contracts.

## Current Extensions

- `assistant-extension/`
- `conversational-extension/`
- `download-extension/`
- `llamacpp-extension/`

## Workspace Commands

From the repository root:

```bash
yarn build:extensions
```

From the `extensions/` workspace when working on extension packages directly:

```bash
yarn install
yarn workspaces foreach -Apt run build:publish
```

## Authoring Expectations

- Use `@ax-studio/core`, not legacy package names
- Keep one extension focused on one domain or feature area
- Clean up resources on unload
- Avoid hidden coupling between extensions
- Add tests where the extension package already supports them

## Typical Extension Shape

An extension package usually contains:

- `src/` implementation
- package metadata
- a build step that emits a distributable `.tgz`

Installation in the app uses the packaged artifact through the extensions settings UI.

## Common Pitfalls

- stale package names copied from older examples
- extension code assuming another extension is always present
- lifecycle cleanup being skipped for listeners or long-running tasks

## Related Docs

- [Core SDK Guide](../core/CONTRIBUTING.md)
- [Assistant extension README](./assistant-extension/README.md)
