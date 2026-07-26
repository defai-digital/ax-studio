# Example: embedding AX Studio in a host Electron app

The smallest possible host: one main-process file (`main.js`, ~100 LOC
excluding the smoke harness) that embeds the full AX Studio runtime via the
programmatic bridge exported by `@ax-studio/electron`.

See `docs/architecture/electron-embedding.md` for the full integration guide
(bridge contract, security rules, updater ownership, capability matrix).

## Prerequisites

From the repository root, build the renderer + Electron package once:

```sh
yarn build:electron
```

That compiles `electron/dist` + `electron/dist-preload` and stages the
renderer bundle at `electron/dist-renderer/` — everything the bridge hands to
the host (`getPreloadPath()` / `getRendererPath()`).

## Run

```sh
yarn workspace @ax-studio/electron-example-host start
```

A plain `BrowserWindow` opens running the bundled AX Studio renderer. All
renderer→main calls go through the host-registered `ax:invoke` bridge.

## Smoke test

```sh
yarn workspace @ax-studio/electron-example-host smoke
```

Headless run (hidden windows, throwaway userData + data folders) that asserts:

- the renderer boots and `window.axElectron` exists in two separate windows,
- `get_app_data_folder_path` reflects the `dataFolder` option,
- `list_threads` / `create_thread` / `delete_thread` round-trip over the full
  command registry in both windows,
- `bridge.events.emit(...)` broadcasts to both windows.

Prints PASS/FAIL per check and exits 0/1.

## Outside this monorepo

This example resolves `@ax-studio/electron` through the Yarn workspace. A
standalone host project would instead:

```sh
npm install @ax-studio/electron   # or: "file:/path/to/ax-studio/electron"
```

and use the exact same `main.js` — the API and paths
(`getPreloadPath()` / `getRendererPath()`) are resolved relative to the
installed package, not the monorepo.
