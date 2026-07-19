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

The Vite dev server is fixed on **http://localhost:31420** (see `vite.config.ts`
`server.port` and the root `Makefile` `DEV_PORT`). Tauri loads the same URL via
`src-tauri/tauri.conf.json` `build.devUrl`. Remote-host HMR uses port **31430**.

The local OpenAI-compatible inference API defaults to
**http://127.0.0.1:31419/v1** (`DEFAULT_SERVER_PORT` in
`src/hooks/settings/useLocalApiServer.ts`).

Local AX BI defaults (see `src/lib/ax-bi/endpoints.ts`):

| Variable | Port | Service |
| --- | ---: | --- |
| `MCP_PORT` | 31421 | MCP |
| `NODE_PORT` | 31422 | Frontend dev |
| `AXBI_PORT` | 31423 | Web app |
| `AX_SERVICES_PORT` | 31424 | AX Services |
| `WEBSOCKET_PORT` | 31425 | Async WS |
| `WEBSOCKET_HTTP_PORT` | 31426 | WS HTTP |
| `NGINX_PORT` | 31429 | Nginx |
| `DATABASE_PORT` | 5432 | Postgres |
| `REDIS_PORT` | 6379 | Redis |

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
- Do not change the dev port in only one place — keep Vite, Tauri `devUrl`, and `DEV_PORT` aligned

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contributor guidance.
