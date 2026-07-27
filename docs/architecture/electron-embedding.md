# Embedding AX Studio in a Host Electron App

Phase 5 of the Tauri→Electron migration (see
`electron-migration-phase0-matrix.md`) turns `@ax-studio/electron` into an
embeddable package: a host Electron app registers one bridge in its main
process and gets the full AX Studio runtime — the complete IPC command
registry (threads, models, downloads, llama.cpp, ax-engine sidecar, secrets,
internal API proxy), the `ax-file://` protocol, and the bundled renderer SPA.

The standalone AX Studio shell (`electron/src/main.ts`) consumes the exact
same API, so embedded and standalone behavior cannot drift apart.

A complete minimal host lives in `examples/electron-host/`.

## Quickstart

```sh
npm install @ax-studio/electron electron
```

Host main process:

```js
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { registerAxStudioBridge } from '@ax-studio/electron/embed'

// 1. Register EARLY — before app.whenReady(). The ax-file scheme privileges
//    cannot be declared after the app is ready, so the function throws if
//    you call it too late. It awaits readiness internally.
const bridgePromise = registerAxStudioBridge()

function createWindow(bridge) {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      contextIsolation: true,
      sandbox: false, // required: the preload is a compiled CommonJS file
      preload: bridge.getPreloadPath(),
    },
  })
  // 2. Load the bundled renderer (or your own copy of the web-app build).
  void win.loadFile(path.join(bridge.getRendererPath(), 'index.html'))
  return win
}

void app.whenReady().then(async () => {
  const bridge = await bridgePromise
  createWindow(bridge)
})
```

That is the whole integration. The renderer detects `window.axElectron`
(exposed by the preload) and routes every desktop service call over the
bridge.

## API surface

```ts
registerAxStudioBridge(options?): Promise<AxStudioBridgeHandle>
```

Options:

| Option | Default | Meaning |
|---|---|---|
| `dataFolder` | persisted config | Pins the AX Studio data folder (threads, models, llamacpp backends, HF cache). Wins over `userData/configuration.json`; `change_app_data_folder` then has no effect on resolution. |
| `userDataFolder` | Electron default | Overrides `app.getPath('userData')` (configuration.json, secrets.json, `stores/`, logs). Applied via `app.setPath` before ready — pass it here instead of calling `setPath` yourself. |
| `enableUpdater` | `false` | Initialize electron-updater. Embedded default is OFF: the host owns its update story. Even when `true`, the updater activates only in packaged production builds (never dev/smoke). |
| `log` | `console.log` with `[ax-studio]` prefix | Bridge log sink. |
| `getMainWindow` | first open `BrowserWindow` | Window used as dialog parent and target of `window_*` commands. |
| `createChildWindow` | plain window with bridge preload + bundled renderer | Factory for the `window_create` command. |

Handle:

| Member | Meaning |
|---|---|
| `getPreloadPath()` | Absolute path of the built CommonJS preload — pass as `webPreferences.preload`. |
| `getRendererPath()` | Absolute path of the bundled renderer directory (contains `index.html`). Resolution order: packaged-shell `web-dist/` (asar) → `<pkg>/dist-renderer/` → monorepo `web-app/dist/` fallback. |
| `events.emit(name, payload?)` | Broadcast a main→renderer event to every window (`ax:event` fan-out). |
| `dispose()` | Detach the `ax:invoke`/`ax:event-emit` IPC handlers and the `ax-file` protocol handler. A later `registerAxStudioBridge()` call then registers fresh. |

`registerAxStudioBridge()` is idempotent: a second call logs and returns the
existing handle, because `ax:invoke` is an app-global `ipcMain.handle`
channel and can only have one handler.

### Data-folder resolution order

1. `dataFolder` option (if provided — always wins).
2. `data_folder` in `<userData>/configuration.json` (what
   `change_app_data_folder` writes).
3. `<appData>/AX Studio/data`.

Note the hardcoded `AX Studio` display name in (3): hosts that want full
isolation from a co-installed standalone AX Studio should pass `dataFolder`
(and usually `userDataFolder`) explicitly.

## Bridge contract

### Channels

| Channel | Direction | Purpose |
|---|---|---|
| `ax:invoke` | renderer→main (`ipcRenderer.invoke`) | `invoke(cmd, args)` — command dispatch into the registry. Unknown commands reject with a structured `{ code: 'unimplemented_command', cmd }` error; handler failures reject with `{ code, cmd, message }` encoded in the Error message. |
| `ax:event-emit` | renderer→main (`ipcRenderer.send`) | Renderer-originated event (`{ name, payload }`), fanned out to all OTHER windows (the sender's shim dispatches locally). |
| `ax:event` | main→renderer | Event envelope `{ kind: 'event', name, payload }` (broadcasts, renderer-originated fan-out) or `{ kind: 'channel', channelId, payload }` (Tauri `Channel` streaming, e.g. download progress). |

The preload exposes exactly `window.axElectron = { invoke, onEvent, sendEvent, smoke }`
(plus a `window.__TAURI_INTERNALS` marker object the web-app feature-detects
on). `contextIsolation` stays on; `sandbox: false` is required because the
preload is a separately compiled CommonJS file.

### Command naming

Commands keep their historical Tauri names. Plugin commands use the
`plugin:<name>|<command>` convention:

- `plugin:llamacpp|load_llama_model`, `plugin:llamacpp|unload_llama_model`,
  `plugin:llamacpp|read_gguf_metadata`, `plugin:llamacpp|get_devices`, …
  (27 commands, incl. all backend version-management commands)
- `plugin:hardware|get_system_info`, `plugin:hardware|get_system_usage`

Everything else is a plain snake_case name: `list_threads`, `create_thread`,
`get_app_data_folder_path`, `start_server`, `download_files`,
`ax_engine_ensure`, `mlx_list_hf_cache_models`, `updater_check`, … The full
list is assembled in `electron/src/commands/registry.ts`
(`createCommandRegistry`). `plugin:llamacpp|start_ax_serving` is deliberately
unimplemented (ax-serving is discontinued).

### Events the renderer listens for / emits

Main→renderer (via `emitToAllWindows` / `bridge.events.emit`):

- `download-<taskId>` — download progress (`{ transferred, total, taskId, modelId? }`)
- `onModelValidationStarted` — `{ modelId, downloadType: 'Model' }`
- `updater-event` — `UpdaterStatus` (only flows when the updater is enabled)
- `dock-file-drop` — file paths from macOS open-file / second-instance argv
  (standalone shell only; hosts can emit the same name via `bridge.events.emit`)

Renderer-originated (via `sendEvent`, fanned out to other windows): app-level
events such as `theme-changed` — any name the web-app's event service uses.

**Multi-window semantics.** The registry is app-global and stateless per
window: any number of windows with the bridge preload can invoke commands
concurrently. Broadcasts go to EVERY `BrowserWindow` in the app — including
the host's own non-ax windows, which simply have no `ax:event` listener and
ignore them. Renderer-originated events fan out to all windows except the
sender (which dispatches locally), matching Tauri's exactly-once broadcast.

### `ax-file://` scope rules

`ax-file://<absolute-path>` serves local files to the renderer (the
`convertFileSrc` replacement — media playback, image preview). The handler:

- only serves paths inside the data folder, plus paths explicitly approved
  this session (file-dialog picks, OS open-file requests);
- canonicalizes the deepest existing ancestor before checking, so symlink
  escapes and `..` traversal return 403;
- is registered with `secure`, `supportFetchAPI`, `stream`, and
  `corsEnabled` privileges — the renderer can `fetch()` it and stream
  bodies.

### safeStorage / secrets

`get_secret` / `set_secret` / `delete_secret` encrypt values with Electron
`safeStorage` and persist them in `<userData>/secrets.json`. On macOS the
encryption key lives in the host app's Keychain entry — the key is keyed by
the RUNNING app's identity, so secrets written by the standalone AX Studio
build are NOT readable by a host app (and vice versa). Treat secrets as
per-host-app.

### Internal API proxy

`start_server` binds an OpenAI-compatible gateway on loopback (default port
31419, API key required when CORS is on or the bind is non-loopback). It
injects provider credentials upstream — the renderer never holds cloud keys.
Embedded hosts should not auto-start it on a fixed port if they also run
their own loopback servers; pick a free port via the persisted configuration
or let the renderer's auto-start handle it.

## What the host must NOT do

- **Do not register your own `ax-file` scheme or handler.** One scheme, one
  handler per app. If you need your own privileged scheme, pick a different
  name.
- **Do not use the channel names `ax:invoke`, `ax:event`, or
  `ax:event-emit`** for your own IPC. They are app-global; a conflicting
  `ipcMain.handle('ax:invoke', …)` throws at registration time.
- **Do not call `registerAxStudioBridge()` after `app.whenReady()`** — it
  throws by design (scheme privileges must predate readiness).
- **Do not load the renderer over `http(s)://` from an origin you don't
  control.** The bridge gives the renderer confined-FS and secrets access;
  only load the bundled `dist-renderer` copy or a build you shipped.
- **Do not enable `sandbox: true`** on windows using the bridge preload —
  the preload is CommonJS and requires `sandbox: false`. Keep
  `contextIsolation: true` and `nodeIntegration: false`.
- **Do not ship two copies of `@ax-studio/electron`** in one app — paths are
  resolved module-relative, and duplicate bridges would race on the global
  channels (the second registration returns the first handle anyway).

## Updater ownership

Embedded mode leaves electron-updater OFF (`enableUpdater: false` default):
the `updater_check` / `updater_download` / `updater_install` commands stay
registered but return `{ enabled: false, reason: 'embedded', state: 'idle' }`
without touching the network, and the renderer hides its update banner. The
host ships and updates the whole bundle through its own channel. Opting in
(`enableUpdater: true`) only makes sense if the host republishes AX Studio's
GitHub release feed semantics — it still activates solely in packaged
production builds.

## Capability matrix

| Command group | OS permissions / requirements |
|---|---|
| FS basics (`read_file_sync`, `write_text_file`, …) | Confined to the data folder + session-approved paths; no OS grants needed. |
| Dialogs (`open_dialog`, `save_dialog`) | User gesture; approved paths become session-scoped FS/`ax-file://` grants. |
| Secrets (`get/set/delete_secret`) | OS keychain via safeStorage (macOS Keychain, Windows DPAPI, Linux libsecret). Keyed per app identity. |
| Threads/messages, store, app config | Data folder + userData only. |
| Internal proxy (`start_server`, …) | Loopback bind (default 127.0.0.1:31419); no inbound firewall prompt on macOS for loopback. |
| Downloads (`download_files`) | Outbound HTTPS; private/internal URLs rejected by policy; writes confined to the data folder + HF cache. |
| llamacpp (`plugin:llamacpp|*`) | Spawns `llama-server` from trusted roots only (`<data>/llamacpp/backends`, system bin dirs); models under `<data>/llamacpp/models`; `nvidia-smi`/`vulkaninfo` probed when present (missing probes degrade gracefully). |
| Hardware (`plugin:hardware|*`) | None required; richer GPU data when `nvidia-smi` / `vulkaninfo` exist. |
| ax-engine sidecar (`ax_engine_*`) | macOS arm64 only; macOS ≥ 26 and ≥ 64 GB RAM recommended (warnings, not hard gates); managed mode requires an `ax-engine` binary ≥ 6.9.0 (config override → `AX_ENGINE_BIN` → PATH → managed `<data>/ax-engine/`); attach mode validates an existing loopback `/v1` server and stores its bearer token through `safeStorage`. |
| mlx HF-cache helpers (`mlx_*`) | Reads the Hugging Face cache (`HF_HUB_CACHE` or default); `mlx_generate_model_manifest` shells out to `ax-engine-bench`. |
| Window (`window_*`) | None. |
| Updater (`updater_*`) | Inert unless `enableUpdater: true` AND packaged production; then outbound HTTPS to the GitHub release feed. |
| `open_external_url` | http(s)/mailto only. |

## Packaging a host app

The published package's `files` are `dist/` (compiled main, ESM),
`dist-preload/` (CommonJS preload), and `dist-renderer/` (the bundled SPA).
No native modules are required at runtime, so no `asarUnpack` is needed for
the bridge itself; the renderer loads fine from inside the host's asar. The
package is ESM (`"type": "module"`) — host mains can `import` it directly,
or `require('@ax-studio/electron/embed')` from CommonJS on Node ≥ 22
(require(esm)).
