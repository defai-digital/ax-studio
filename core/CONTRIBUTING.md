# Contributing to the Core SDK

[Back to main contributing guide](../CONTRIBUTING.md)

`@ax-studio/core` is the shared TypeScript SDK used by the app and packaged extensions. It defines contracts, shared APIs, and extension-facing building blocks.

## What Lives Here

- `src/browser/` browser-facing core APIs
- `src/browser/extensions/` extension system internals
- `src/types/` shared type definitions
- tests and build configuration for the SDK package

## Common Commands

Run these from `core/` or from the repository root with `yarn workspace`.

```bash
yarn workspace @ax-studio/core build
yarn workspace @ax-studio/core test
yarn workspace @ax-studio/core test:coverage
```

The root `make dev` and `make test` flows already build this package as part of the workspace.

## Expectations

- Keep exports intentional and stable
- Preserve compatibility for existing consumers in `web-app/` and `extensions/`
- Prefer explicit types over loose shapes
- Add tests when changing contracts, event behavior, or shared helpers

## Typical Change Areas

- extension lifecycle APIs
- shared event or messaging contracts
- browser-side abstractions used by the web app and extensions
- types that need to remain aligned across packages

## Testing Guidance

When changing shared contracts, verify both:

- type-level usage still compiles for downstream consumers
- runtime behavior is covered with Vitest where applicable

## Common Pitfalls

- changing exports without checking downstream imports
- widening types in ways that make extension behavior less predictable
- mixing package-internal helpers with public API surface without clear intent
