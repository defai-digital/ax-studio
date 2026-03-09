# AX Studio Web App

The web app is the React frontend for AX Studio. It powers chat, settings, model selection, artifacts, and most user-facing product workflows.

## Stack

- React 19
- TypeScript
- Vite
- TanStack Router
- Zustand
- Tailwind CSS 4
- Radix UI
- Vercel AI SDK

## Directory Map

```text
src/
  components/   reusable UI primitives
  containers/   feature-level UI
  hooks/        custom hooks
  lib/          shared frontend logic and services
  locales/      translations
  providers/    React providers
  routes/       route definitions
  stores/       Zustand stores
  types/        TypeScript types
```

## Development

From the repository root:

```bash
make dev-web-app
```

Direct workspace commands:

```bash
yarn workspace @ax-studio/web-app dev
yarn workspace @ax-studio/web-app build
yarn workspace @ax-studio/web-app lint
yarn workspace @ax-studio/web-app test
```

Use the full desktop flow when testing native behavior:

```bash
make dev
```

## Notes

- Browser mode is useful for fast UI iteration, but it does not replace testing in the Tauri shell
- Prefer routing, state, and service patterns that already exist in `src/`
- All user-facing strings should remain localizable

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contributor guidance.
