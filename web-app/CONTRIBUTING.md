# Contributing to the Web App

[Back to main contributing guide](../CONTRIBUTING.md)

The web app is the React frontend for AX Studio. It handles chat UX, settings, routing, artifacts, and most of the desktop-visible product behavior.

## What Lives Here

- `src/components/` reusable UI primitives
- `src/containers/` feature-level UI and larger composed views
- `src/routes/` TanStack Router routes
- `src/stores/` Zustand stores
- `src/lib/` provider, service, and shared frontend logic
- `src/hooks/` custom hooks
- `src/locales/` translations

## Common Commands

Run these from the repository root unless noted otherwise.

```bash
make dev-web-app
yarn workspace @ax-studio/web-app dev
yarn workspace @ax-studio/web-app build
yarn workspace @ax-studio/web-app lint
yarn workspace @ax-studio/web-app test
```

Use `make dev-web-app` for a frontend-only loop. Use `make dev` when you need the full Tauri shell and native integrations.

## Working Model

- Routes define top-level application screens
- Stores manage persistent application state
- `src/lib/` contains shared frontend logic that should not be duplicated across components
- Tauri calls should generally be wrapped behind services or hooks instead of being scattered through leaf components

## UI and React Expectations

- Keep components functional and strongly typed
- Avoid `any` unless there is a concrete reason
- Prefer composition over deep prop drilling where existing store or provider patterns fit
- Follow existing route, store, and service patterns before introducing new abstractions
- All user-facing strings should go through i18n

## Tauri Integration

Browser mode and desktop mode are not equivalent. If a feature depends on native APIs, test it through the Tauri app as well.

Typical Tauri usage:

```ts
import { invoke } from '@tauri-apps/api/core'

const result = await invoke('command_name', { param: 'value' })
```

Prefer placing that call inside a service or hook so the UI layer stays simple.

## Testing

Frontend tests use Vitest.

```bash
yarn workspace @ax-studio/web-app test
yarn workspace @ax-studio/web-app test:coverage
```

Add tests when you change behavior in:

- route logic
- hooks
- stores
- rendering behavior with meaningful state transitions

## Common Pitfalls

- Browser mode can hide native integration issues
- Translation keys drift if English strings are added directly in components
- Provider logic becomes hard to maintain if duplicated across routes or containers
- Large UI features usually need both state and rendering tests
