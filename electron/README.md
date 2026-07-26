# @ax-studio/electron — Electron shell (Phase 1)

Electron replacement shell for the Tauri desktop runtime. Loads the existing
React web-app: all `@tauri-apps/*` imports resolve (permanently, via vite
alias) to the shim in `web-app/src/lib/tauri-shim/`, which talks to this main
process over a small IPC bridge (`window.axElectron`).

See `docs/architecture/electron-migration-phase0-matrix.md` for the full
migration plan. The Tauri runtime (`src-tauri/`) was removed in Phase 4
slice 2a, and the web-app's Tauri-only code (dead routes, MCP/RAG/voice/
projects services, the in-process MLX backend, the Tauri updater UI, and the
`@tauri-apps/*` npm dependencies) was removed in slice 2b; this shell is the
only desktop runtime.

## Develop

```sh
yarn install
yarn dev:electron
```

This builds the main/preload (`tsc`), starts the web-app Vite dev server
(port 31420), waits for it, then launches Electron with
`VITE_DEV_SERVER_URL` pointing at the dev server.

## Build

```sh
yarn build:electron
```

Runs `yarn build:web` (`IS_ELECTRON` on, shim aliases always active) and
compiles this package to `electron/dist/` (ESM) plus `electron/dist-preload/`
(CommonJS — Electron preloads cannot be ESM `.js` files).

## Smoke test

```sh
yarn build:electron
yarn workspace @ax-studio/electron smoke
```

Loads `web-app/dist/index.html` with a hidden window, invokes
`get_app_data_folder_path` from the renderer through the full preload bridge,
then exercises the Phase 2 surfaces: create/modify/delete thread + message
round-trips, thread assistant commands, start_server →
register_provider_config → `GET /v1/models` through the proxy →
unregister → stop_server, and the downloads pipeline against a local
node:http fixture server (two-item download with byte-for-byte verification,
ordered progress events over the `download-<taskId>` event channel,
mid-stream cancel with partial-artifact cleanup, Range resume after a broken
connection, path-escape and managed-header rejections), the llamacpp plugin
surface (GGUF metadata parsing against a crafted fixture — header,
string/numeric/array values, KV-cache estimation — `get_random_port`, and a
full `load_llama_model` → HTTP probe → `unload_llama_model` cycle against a
fake `llama-server` placed under the trusted backend root, asserting
SessionInfo, session lookups, idempotent reload, and process-group teardown
of both the server and a grandchild), `start_ax_serving` staying
unimplemented, shaped `plugin:hardware|get_system_info` /
`get_system_usage` responses, and the ax-engine sidecar (macOS) against a
fake `ax-engine` node CLI in three variants (on PATH 6.9.0, managed install
7.0.0, below-floor 6.8.2): binary resolution order (override → AX_ENGINE_BIN
→ PATH → managed), version-floor rejection, port probing (31418 occupied →
31419), `server.json` written before readiness, ready phase, Bearer auth on
`/v1/models`, SSE chat, hot model swap via `POST /v1/model/load` without a
respawn, posture-change relaunch, SIGTERM→SIGKILL escalation against a
SIGTERM-ignoring server, pid-recycling protection (an innocent process is
never signaled), orphan reclaim via `server.json`, and `missing_dependency`
when the binary is absent. The renderer checks also cover the Phase 3 static
extension wiring: after app bootstrap `window.core.engineManager.get(
'llamacpp')` resolves (the bundled llamacpp extension's `onLoad()` ran), the
download and conversational extensions are registered by name, the engine's
`list()` reaches the model registry, and no
`get_active_extensions` / `install_extensions` /
`get_app_extensions_path` errors appear in the renderer console during
bootstrap. The renderer checks also cover the route pruning
(migration matrix §1, finalized in Phase 4 slice 2b): the app runs on hash
history under `file://`, the router is exposed as `window.__ax.router`, and
the suite asserts that the removed paths (logs, system-monitor, project, and
the deleted settings pages) are absent from the registered route tree,
`/settings/general` renders, and the sidebar/settings menu carry no links to
removed routes (Projects, assistants, MCP servers, hardware, extensions,
voice). The
renderer checks also cover the Phase 3 AX BI conversational-ization
(migration matrix §4): a node:http fixture plays the external AX BI
streamable-HTTP MCP server (initialize handshake, `tools/list`,
`tools/call`), and the suite drives the zero-config direct client through
the `window.__ax.axBi` seam — token seeded via the safeStorage secrets
bridge, connect → `connected`, `list_datasets` parsed, and a chat-style
`prompt_to_dashboard` run formatted with its dashboard URL — while the
fixture asserts every call carried the Bearer token and the renderer
console shows no `activate_mcp_server` / `call_tool` / `get_tools`
unimplemented-command errors (the Rust MCP bridge is never touched).
The renderer checks also cover the Phase 3 slice 4 mlx HF-cache helpers
(`electron/src/commands/mlx.ts`, ported from
`src-tauri/src/core/mlx/commands.rs`): a fixture Hugging Face cache inside
the throwaway data folder (one repo with a manifest-bearing snapshot plus a
newer weights-only snapshot, one weights-only repo, one empty repo) and a
fake `ax-engine-bench` CLI exercise `mlx_hf_snapshot_dir` (path construction
+ revision validation), `mlx_list_hf_cache_models` (manifest preference,
safetensors sizes, model-id sort), `mlx_has_model_manifest` (including the
outside-cache rejection), `mlx_resolve_model_dir` (manifest snapshot wins
over newer weights-only; weights fallback; unknown-model error),
`mlx_generate_model_manifest` (existing manifest left untouched; generation
through `ax-engine-bench`; safetensors and data-folder/HF-cache confinement
rejections), and `mlx_cleanup_import_artifacts` (in-cache removal;
outside-cache paths refused, asserted main-side). The Phase 4 updater
surface is checked too: `updater_check` / `updater_download` /
`updater_install` resolve over IPC but return `{ enabled: false,
reason: 'smoke' }` without any network access, and a main-side assertion
proves electron-updater was never initialized (`isUpdaterActive()` false).
Finally, after the
renderer suite completes the harness waits 10s for the app bootstrap to
fully settle and asserts the renderer console contains ZERO
`unimplemented_command` errors — the Electron boot must never probe
commands the main process does not implement (MCP, voice, akidb,
extension system are all gated off; see "Boot-path gating" below).
Smoke mode runs against a throwaway `userData` (fresh `mkdtemp` per run) so
the developer's real localStorage/secrets/stores are never touched — a
persisted local-API-server auto-start (default port 31419) would otherwise
race the suite's proxy checks and squat the ax-engine probe range. The
renderer learns about smoke mode through the `--ax-smoke`
`additionalArguments` flag, which the preload exposes as
`window.axElectron.smoke` (boot auto-starts gate on it). Smoke mode sets
`AX_STUDIO_DOWNLOAD_ALLOW_PRIVATE=1` so the fixture's 127.0.0.1 URLs pass the
download URL policy — never set this outside the smoke suite. Prints
PASS/FAIL per check and exits 0/1.

## Renderer entry point

Dev mode uses `VITE_DEV_SERVER_URL` (default `http://localhost:31420`).
Unpackaged prod loads `web-app/dist/index.html` from the repo root; a
packaged build loads the SPA staged inside the asar as
`app.asar/web-dist/index.html` (see `electron-builder.yml`).

## Packaging (Phase 4)

```sh
yarn dist:electron        # current platform
yarn dist:electron:mac    # macOS arm64: DMG + zip
yarn dist:electron:win    # Windows NSIS (x64 + arm64) — untested, config-only
```

`scripts/dist-electron.mjs` runs `build:electron` (`--skip-build` to reuse
output) and then electron-builder with `--publish never` and the version from
the ROOT `package.json` (single source of truth, injected via
`-c.extraMetadata.version`; `electron/package.json` stays `0.0.0`). Config:
`electron/electron-builder.yml`; output: `electron/dist-installer/`.
appId/productName mirror the former Tauri config (`ai.axstudio.app` /
"AX Studio"), NSIS mirrors the former `tauri.windows.conf.json` (per-machine,
assisted), icons live in `electron/build/` (derived from the former
`src-tauri/icons/`).

Local mac builds are unsigned: run with
`CSC_IDENTITY_AUTO_DISCOVERY=false` or electron-builder fails looking for a
Developer ID identity. In CI, `.github/workflows/ax-studio-electron-build.yml`
handles signing/notarization: it signs when the Apple secrets
(`APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` or
`APPLE_SIGNING_IDENTITY`, plus `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
`APPLE_TEAM_ID` or the `APPLE_API_KEY_*` variant for notarization) are present
— passing `-c.mac.notarize=true` to override the yml's `notarize: false` —
and otherwise builds unsigned with `CSC_IDENTITY_AUTO_DISCOVERY=false`; see
`docs/release/release.md`. The entitlements file (`electron/build/entitlements.mac.plist`)
is minimal — the Tauri Bun/MLX keys are not mirrored (no bundled Bun, MLX
runs in the ax-engine sidecar); only the Chromium/V8 keys every
hardened-runtime Electron app needs are kept.

### Auto-updates (electron-updater)

`electron/src/updater.ts` wraps electron-updater. It is initialized ONLY in
packaged production builds (`app.isPackaged && !--smoke`) — dev and smoke
never touch the network feed; the IPC commands stay registered but return
`{ enabled: false, reason: 'dev' | 'smoke' }`. The feed is GitHub releases
(`publish` in `electron-builder.yml`: `defai-digital/ax-studio`,
`latest-mac.yml` / `latest.yml`), replacing the Tauri updater's `latest.json`
endpoint. Main checks ~5s after launch and on `updater_check`; status is
broadcast to all windows as `updater-event`; `updater_download` /
`updater_install` (quitAndInstall) complete the flow. The renderer UI is
`web-app/src/containers/ElectronUpdateBanner.tsx`, mounted in
`routes/__root.tsx` only under Electron (hidden in smoke mode before any
IPC). `will-quit` skips the blocking engine cleanup while quitAndInstall is
in flight so the installer is never stalled.

## Embedding (Phase 5)

`@ax-studio/electron` is also a library: a host Electron app can embed the
full AX Studio runtime (command registry, `ax-file://` protocol, bundled
renderer) with one call from its own main process:

```js
import { registerAxStudioBridge } from '@ax-studio/electron/embed'

const bridgePromise = registerAxStudioBridge() // call BEFORE app.whenReady()
// … later: new BrowserWindow({ webPreferences: { preload: bridge.getPreloadPath(), sandbox: false } })
//          win.loadFile(path.join(bridge.getRendererPath(), 'index.html'))
```

The standalone shell itself (`src/main.ts`) consumes this same API, and the
build stages the renderer at `electron/dist-renderer/` (what `npm pack`
ships). Full guide: `docs/architecture/electron-embedding.md`; minimal
working host: `examples/electron-host/` (smoke: `yarn smoke:embed`).

## What is implemented

- IPC command registry (`electron/src/commands/`) with real handlers for:
  - FS: `join_path`, `mkdir`, `exists_sync`, `readdir_sync`, `read_file_sync`,
    `read_file_base64`, `rm`, `mv`, `copy_file`, `file_stat`,
    `write_file_sync`, `write_blob`, `unlink_sync`, `append_file_sync`,
    `write_binary_file`, `write_text_file`, `validate_sha256`, `read_yaml`,
    `write_yaml`, `get_gguf_files` (recursive scan for directories),
    `decompress` (.zip via unzipper, .tar/.tar.gz via system tar),
    `open_dialog`, `save_dialog`
  - App/system: `get_app_configurations`, `get_app_data_folder_path`,
    `default_data_folder_path`, `get_user_home_path`,
    `get_configuration_file_path`, `change_app_data_folder` (persists to
    `userData/configuration.json`; does not yet migrate data or kill engines),
    `relaunch`, `canonicalize_path`, `dir_name`, `base_name`,
    `is_subdirectory`, `log`, `open_file_explorer`, `factory_reset`,
    `read_logs`, `take_pending_open_files` (macOS `open-file` +
    second-instance argv, buffered until drained), `open_external_url`
  - Secrets: `get_secret`, `set_secret`, `delete_secret` via `safeStorage`,
    persisted as `userData/secrets.json`
  - Window (`window_*`): focus/minimize/maximize/toggle/close/hide/show/
    title/theme/create; `window_start_dragging` is a no-op (native frame in
    Phase 1)
  - Store: `plugin_store_load` / `plugin_store_save` (JSON per store under
    `userData/stores/`)
  - Threads/messages (`electron/src/commands/threads.ts`): `list_threads`,
    `create_thread`, `modify_thread`, `delete_thread`, `list_messages`,
    `create_message`, `modify_message`, `modify_messages`, `delete_message`,
    `get_thread_assistant`, `create_thread_assistant`, `modify_thread_assistant`
    — same on-disk layout as the Rust backend (`threads/<id>/thread.json` +
    `messages.jsonl`), atomic writes, per-thread locks, 5s list cache.
  - Internal API proxy (`electron/src/server/`, commands in
    `electron/src/commands/server.ts`): `start_server`, `stop_server`,
    `get_server_status`, `register_provider_config`,
    `register_provider_configs_batch`, `unregister_provider_config`,
    `list_provider_configs`, `abort_remote_stream`. Loopback-first
    OpenAI-compatible gateway: `GET <prefix>/models` aggregates registered
    providers, `POST /chat/completions|/completions|/embeddings|
    /messages/count_tokens` are routed model→provider (X-Ax-Provider hint,
    then `provider/model` prefix, then the model index), provider credentials
    are injected upstream (never held by renderer requests), SSE responses are
    streamed with the Rust `patch_sse_line` reasoning-field patching, and
    `abort_remote_stream` cancels in-flight upstream requests by
    `x-ax-stream-id`. Security parity with the Rust proxy: API key required
    when CORS is on or the bind host is non-loopback, bearer/X-Api-Key auth
    with constant-time compare + per-client lockout, trusted-host/origin
    checks, no redirect following, registration-time and per-request SSRF
    guards (private-IP rejection unless the provider is a known local engine).
  - Downloads (`electron/src/downloads/`, commands in
    `electron/src/commands/downloads.ts`): `download_files`,
    `cancel_download_task`. Node port of `src-tauri/src/core/downloads/`:
    full policy parity (task-id/URL/item/proxy/header validation, http(s)
    only, no embedded credentials, private/internal URL + DNS-answer
    rejection with connect-time lookup pinning, SHA-256 required for plain
    HTTP and for ignore-SSL, managed-header blocklist), save-path root
    enforcement (data folder + Hugging Face cache, symlink-aware), `.tmp`/
    `.url`-sidecar resume with `Range` + 206/Content-Range verification,
    transactional commit (validate before rename, batch-wide failure
    cancels siblings, per-task destination reservation), streamed writes
    with 1 MB progress throttling over `download-<taskId>` events, size
    and SHA-256 validation, `onModelValidationStarted`, up to 8 concurrent
    files per task and 16 active tasks, manual redirect chain (max 10,
    no HTTPS→HTTP downgrade, headers only on the original origin), and
    HTTP/HTTPS proxy support (absolute-form for http targets, CONNECT
    tunnel for https targets, basic auth, no_proxy bypass).
  - llamacpp plugin (`electron/src/llamacpp/`, commands in
    `electron/src/commands/llamacpp.ts`): Node port of
    `src-tauri/plugins/tauri-plugin-llamacpp/`. `load_llama_model` spawns
    `llama-server` as a process-group leader (`detached` on POSIX,
    `taskkill /T /F` on Windows) with the full `args.rs` argument-builder
    semantics, binary/model path validation against the same trusted roots
    (`<data>/llamacpp/backends`, `<data>/ax-serving`, `/usr/local/bin`,
    `/opt/homebrew/bin`, `/usr/bin`, `%ProgramFiles%`; models under
    `<data>/llamacpp/models`), dangerous-env filtering, CUDA/library path
    injection, stdout/stderr readiness scanning with early-exit and timeout
    handling, per-model startup locks, idempotent reload, exit-event reaper,
    and SIGTERM→SIGKILL group teardown on `unload_llama_model`,
    `cleanup_llama_processes`, and app quit. GGUF header parser
    (`read_gguf_metadata`, remote Range-chunk reading, `estimate_kv_cache_size`,
    `get_model_size` with the HF host allowlist, `is_model_supported`),
    `get_devices` (`--list-devices` output parsing), `generate_api_key`
    (HMAC-SHA256 base64), `is_process_running`, `get_random_port`
    (3000–3999, bind-checked), session queries, and all 14 backend
    version-management commands. `start_ax_serving` (and
    `engine_type: 'ax-serving'` loads) are deliberately unimplemented —
    ax-serving is discontinued.
  - hardware plugin (`electron/src/hardware/`, commands in
    `electron/src/commands/hardware.ts`): `plugin:hardware|get_system_info`
    and `get_system_usage` with the Rust return shapes. CPU/RAM from the `os`
    module, CPU feature flags from `/proc/cpuinfo` (Linux) / `sysctl`
    (Intel macOS), NVIDIA GPUs via `nvidia-smi` (info + memory usage),
    Vulkan GPUs via `vulkaninfo --summary` when installed, AMD VRAM usage
    from `/sys/class/drm` on Linux. Missing probes degrade to empty gpu
    lists / zeroed usage, same as the Rust plugin without NVML/Vulkan.
  - mlx HF-cache helpers (`electron/src/hf-cache.ts`, commands in
    `electron/src/commands/mlx.ts`): Node port of the fs/path-only commands
    in `src-tauri/src/core/mlx/commands.rs` + `src-tauri/src/core/hf_cache.rs`
    so the bundled llamacpp extension's MLX-via-HF-cache import workflow
    works under Electron. `mlx_hf_snapshot_dir`, `mlx_resolve_model_dir`
    (manifest-bearing HF snapshot → app-data import dir → weights-only HF
    snapshot), `mlx_list_hf_cache_models` (best-snapshot ranking by
    manifest/mtime, safetensors size sums), `mlx_has_model_manifest`
    (HF-cache-confined), `mlx_cleanup_import_artifacts` (best-effort,
    HF-cache-confined), and `mlx_generate_model_manifest` — the manifest
    itself is produced by the installed `ax-engine-bench generate-manifest`
    CLI (binary resolution: `AX_ENGINE_BENCH_BIN` → sibling of the resolved
    `ax-engine` binary → PATH) because the converter lives in
    `ax-engine-core`; the command is confined to the data folder ∪ HF cache
    and no-ops (with light JSON validation) when a manifest already exists.
    The in-process MLX runtime commands (`mlx_load_model`,
    `mlx_chat_stream`, …) stay unimplemented — Electron runs AX Engine as
    the sidecar.
  - ax-engine sidecar (`electron/src/ax-engine/`, commands in
    `electron/src/commands/ax-engine.ts`, macOS only): Node port of AX
    Code's `packages/ax-code/src/provider/ax-engine/` lifecycle. Commands:
    `ax_engine_status` (phase + baseURL + loaded models + binary detail),
    `ax_engine_ensure` (dependency check → start/reuse/reclaim the server
    for a model + launch posture), `ax_engine_load_model` /
    `ax_engine_unload_model` (runtime model mgmt over HTTP, no respawn),
    `ax_engine_stop`. Binary resolution: config override → `AX_ENGINE_BIN`
    env → PATH → managed `<data>/ax-engine/ax-engine`, version floor 6.9.0
    via `--version`. Platform gates mirror AX Code: macOS arm64 hard
    required, macOS < 26 and < 64 GB RAM are warnings. Spawns
    `ax-engine serve <model> --port <p> -- <posture flags>` detached with
    output appended to `server.log` (context window = `--total-blocks` ×
    `--block-size-tokens`; there is no `--context-length`), probes ports
    31418..31438, serializes lifecycle ops under a cross-process
    `server.lock` (exclusive-create + pid liveness), writes `server.json`
    (pid/port/baseURL/model/posture) BEFORE the readiness wait, polls
    `GET /v1/models` with Bearer every 500 ms (2 s probe timeout, 240 s
    total), swaps models via `POST /v1/model/load` (`load_mode:"add"`,
    `make_default`) / `/v1/model/unload`, relaunches only on posture
    change, and stops with SIGTERM → 5 s grace → SIGKILL — signaling only
    after `ps` confirms the pid's cmdline is really an ax-engine serve
    process (pid-recycling protection). Orphans from previous app runs are
    reclaimed from `server.json`. Managed auto-download is a TODO until
    ax-engine ships a self-contained release artifact; absence surfaces as
    `missing_dependency` with install guidance. Renderer side:
    `SidecarHttpLocalEngineBackend` probes/ensures through these commands,
    and `ModelFactory` routes the `ax-engine` provider straight to the
    sidecar baseURL with its Bearer key when `isPlatformElectron()`.
- `ax-file://` privileged protocol serving `convertFileSrc` URLs, confined to
  the app data folder + session-approved paths (dialog picks, OS open-file).
  Path traversal protection mirrors the Rust `resolve_path` helper.
- Static extension wiring (Phase 3): the dynamic extension system
  (`get_active_extensions` / `install_extensions`, tgz activation) is removed
  in Electron builds. Instead `ExtensionProvider` delegates to
  `web-app/src/lib/bootstrap/static-extensions.ts`, which instantiates the
  three built-in extensions from bundled source imports (vite aliases
  `@ax-studio/llamacpp-extension` / `@ax-studio/download-extension` /
  `@ax-studio/conversational-extension` → `extensions/*/src`), registers them
  under their package names in the shared ExtensionManager, and runs
  `onLoad()` — AIEngine.onLoad() publishes `llamacpp` into EngineManager,
  mirroring the dynamic path. Settings stay in localStorage keyed by
  extension name. The Tauri build dead-code-eliminates this module
  (`IS_ELECTRON=false`) and keeps the dynamic loader untouched. Inside the
  llamacpp extension, the `model-manifest.json` branch that used to route to
  ax-serving now delegates to the ax-engine sidecar under Electron
  (`ax_engine_ensure` / `ax_engine_unload_model` / `ax_engine_status` +
  authenticated OpenAI HTTP against the sidecar baseURL); ax-serving behavior
  under Tauri is unchanged.
- Route pruning (migration matrix §1; finalized in Phase 4 slice 2b): the
  router only registers `/`, `/threads/$threadId`, `/hub/*`, `/ax-bi`,
  `/settings/general`, and `/settings/providers/*` — the removed route files
  (logs, system-monitor, project, and 15 settings pages) are deleted, along
  with the Phase 3 redirect guard. `/settings/interface` and
  `/settings/privacy` render inline as sections of `/settings/general`. The
  sidebar has no Projects/assistants/MCP tools entries, `SettingsMenu` is
  General + Providers, and the search-dialog command list only contains kept
  destinations. Because the shell loads the SPA from `file://`, the router
  uses hash history (browser history cannot represent app routes there) and
  is exposed as `window.__ax.router` for the smoke suite.
- Boot-path gating (Phase 3 slice 4; finalized in slice 2b): an Electron
  boot probes ZERO unimplemented commands (enforced by the smoke suite's
  global console assertion). The Tauri self-updater bootstrap, the MCP tools
  fetch, the assistant-extension bootstrap (the store keeps its built-in
  default assistant, `defaultAssistant` in `hooks/chat/useAssistant.ts`,
  with temperature 0.7 / top_k 20 / top_p 0.8 / repeat_penalty 1.12), and
  the global-shortcut remap were all removed in slice 2b along with the
  services behind them. Updates surface through `ElectronUpdateBanner`
  (mounted in `routes/__root.tsx`, hidden in smoke mode). The AX Engine
  metadata extractor and `isDiffusionGemmaModelId` live in the IPC-free
  `web-app/src/lib/ax-engine-metadata.ts`.
- Renderer shim (`web-app/src/lib/tauri-shim/`): `api/core` (invoke, Channel,
  convertFileSrc), `api/event`, `api/window`, `api/webviewWindow`, `api/path`,
  plugin-opener, plugin-store, plugin-http (fetch passthrough — note CORS:
  Tauri's plugin-http bypassed CORS, Electron renderer fetch enforces it),
  plus phase-4 stubs for updater, deep-link, global-shortcut, log.
- Events: renderer→renderer (`emit`/`listen`), main→renderer (`dock-file-drop`
  and future backend events), cross-window fan-out via main.

## Security notes

- `contextIsolation: true`; the preload only exposes `invoke`/`onEvent`/
  `sendEvent`. `sandbox: false` is required because the preload is a
  separately-compiled CommonJS file.
- FS commands reject any path escaping the data folder (canonicalized with
  the deepest existing ancestor to close symlink TOCTOU), except paths the
  user approved this session via dialogs or OS open-file.
- `open_external_url` only accepts `http(s):`/`mailto:`.
- Anything not yet implemented throws a structured
  `{ code: 'unimplemented_command', cmd }` error — loud, not silent.

## Known gaps (Phase 3+)

- ax-engine sidecar: no managed auto-download yet (needs ax-engine's
  self-contained release artifact — see the migration matrix §5); install via
  Homebrew / PATH / `AX_ENGINE_BIN` until then. The renderer talks to the
  sidecar over plain `fetch`, so the real `ax-engine serve` must emit CORS
  headers for the webview origin (the smoke fixture does); if it doesn't,
  chat will need routing through the internal proxy. In-process MLX
  (`in-process-backend.ts`, `mlx-ipc-fetch.ts`) is Tauri-only: under Electron
  the backend factory selects the sidecar, `ModelFactory` loads the IPC shim
  only via a lazy dynamic import in the in-process branch, and the pure AX
  Engine helpers (metadata extractor, `isDiffusionGemmaModelId`) live in
  `web-app/src/lib/ax-engine-metadata.ts`. The modules themselves are
  deleted in Phase 4 with the rest of the Tauri code.
- llamacpp/hardware deviations: CPU `core_count` is logical (Rust reports
  physical); `os_name` is `os.type() + os.release()` rather than the
  sysinfo long OS version; Vulkan GPUs report `total_memory: 0`
  (`vulkaninfo --summary` has no heap sizes) and llama-server float metadata
  values print with JS `Number` formatting; Windows AMD GPU usage (ADL) is
  not ported (zeroed usage).
- Downloads: commit on Windows uses rm+rename instead of the atomic
  `ReplaceFileW`; the request timeout covers connect + response headers only
  (body streaming is untimed, same as the Rust side); HTTPS proxy support is
  implemented but not exercised by the smoke suite.
- The Rust proxy's Anthropic `/messages` → OpenAI adapter is not ported (the
  web-app speaks OpenAI-compatible `/chat/completions` for every provider);
  `POST /messages` returns 404.
- `change_app_data_folder` does not move existing data or restart engines.
- Custom window chrome: windows use the native frame; `window-drag.ts` /
  `WindowControls.tsx` and the `IS_TAURI` define were removed in slice 2b.
- No deep links, global shortcuts, or multi-window polish
  (child windows are minimal `BrowserWindow`s sharing the same preload).
- Windows packaging is config-only: the NSIS config mirrors
  `tauri.windows.conf.json` but no Windows build has been produced or
  launched (mac-only dev machine). macOS signing/notarization are CI work
  (`notarize: false`; local builds run unsigned with
  `CSC_IDENTITY_AUTO_DISCOVERY=false`). electron-updater's end-to-end
  download/install path is untested until a release publishes
  `latest-mac.yml` / `latest.yml` artifacts — the current v2.2.2 GitHub
  release only ships the Tauri `latest.json`, so packaged builds log a
  harmless 404 on check.
