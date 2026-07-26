# Phase 0 — Tauri → Electron 遷移：保留 / 刪除 / 移植對照表

> 狀態:全部完成(Phase 0–5)。Phase 0–3 完成;Phase 4 slice 1 完成(electron-builder DMG + electron-updater 接上);Phase 4 slice 2a 完成(2026-07-26,repo 層級 Tauri 除役:`src-tauri/`、Tauri CI workflows、release/packaging scripts、root `package.json` Tauri scripts 與 `@tauri-apps/cli`、Makefile Tauri targets、dependabot cargo、guardrail tests 全數移除;guest-js 移至 `extensions/llamacpp-api/`;`pre-install/` 流程廢除,擴充改由 vite alias 從原始碼打包);Phase 4 slice 2b 完成(2026-07-26,web-app 死碼清除:15 個死路由檔 + electron-route-guard、`services/{mcp,voice,projects,rag,assistants,deeplink,global-shortcut,chat-organization,updater}` 與 ServiceHub 接線、`mlx-ipc-fetch.ts`、`in-process-backend.ts`、`AxBiWorkspace`/`AkidbConfigPanel`/`ProjectFiles`/MCP dialogs/voice 元件/window-drag/`WindowControls`/Tauri updater UI(`AppUpdater`、`hooks/updater`)、`@tauri-apps/*` npm deps 全數移除,vite alias → shim 改為永久 + tsconfig paths,`@tauri-apps/*` import specifier 全改寫為 `@/lib/tauri-shim/*`,chat-organization persistence 併入 `lib/chat-organization.ts`,附件改為純 inline 文字萃取,i18n 刪除 6 個 namespace file,release docs 改寫為 electron-builder 流程)。**Phase 5 完成**(2026-07-26,可嵌入整合包:`electron/src/embed.ts` 提供 `registerAxStudioBridge()` 程式化 API(host main 註冊完整 command registry、`ax-file://` protocol,回傳 `{ dispose, getPreloadPath, getRendererPath, events }`;standalone `main.ts` 改為內部消費同一 API,行為不變、smoke 維持 137/137);renderer bundle 採方案 (a) — build 時 `web-app/dist` → `electron/dist-renderer/`,electron-builder 改由該目錄 stage 為 asar `web-dist/`,`npm pack` 一併出貨;整合指南 `docs/architecture/electron-embedding.md`;最小範例 host `examples/electron-host/`(加入 root workspaces,`yarn smoke:embed` 無頭驗證雙視窗 IPC round-trip + main→renderer broadcast))。
> 歷史狀態:草案 v1(2026-07-26);Phase 3 slice 4 更新:開機探針已全數 gate(Electron 開機零 `unimplemented_command`),全域快捷鍵/assistant 擴充/MCP tools 在 Electron 下停用,內建單一預設 assistant;HF cache `mlx_*` helper 已移植 Electron main。Phase 4 slice 1 更新:electron-builder 打包管線(`yarn dist:electron:mac|win`,產出 `electron/dist-installer/`)+ electron-updater 已接上(`electron/src/updater.ts`,IPC `updater_check`/`updater_download`/`updater_install` + 渲染層更新橫幅;僅 packaged prod 初始化,smoke 斷言零網路呼叫);Windows NSIS 配置僅 correct-by-construction,尚未實機驗證。
> 目標:Ollama 式精簡 UX;macOS 使用 ax-engine(sidecar HTTP)+ llama.cpp;PC 僅 llama.cpp;
> 停用 ax-serving;AX BI 保留並簡化為對話式入口。

## 1. 路由對照(web-app/src/constants/routes.ts)

| 路由 | 決定 | 備註 |
|---|---|---|
| `/`(新對話首頁) | 保留(簡化) | 開啟即對話框 + 模型選擇器 |
| `/threads/$threadId` | 保留 | |
| `/hub/`、`/hub/$modelId` | 保留 | 模型搜尋/下載/刪除,核心功能 |
| `/ax-bi` | 保留(簡化) | 對話為主入口;工作區降為歷史/進階頁或整併 |
| `/settings/general` | 保留(瘦身) | 主題/語言/資料夾 |
| `/settings/providers/`、`/settings/providers/$providerName` | 保留 | API key 管理 |
| `/settings/interface` | 整併 | 併入 general |
| `/settings/privacy` | 整併 | 併入 general |
| `/project/$projectId` | **刪除** | Projects/RAG 移除 |
| `/settings/attachments` | **刪除** | |
| `/settings/shortcuts` | **刪除** | |
| `/settings/voice` | **刪除** | |
| `/settings/extensions` | **刪除** | 擴充系統移除 |
| `/settings/local-api-server` | **刪除** | 對外 API server 功能移除(內部 proxy 保留) |
| `/settings/knowledge-base` | **刪除** | RAG 移除 |
| `/settings/mcp-servers` | **刪除** | 泛用 MCP 移除;AX BI 改用 sdk.ts 直連 |
| `/settings/https-proxy` | **刪除** | 改為設定檔/env 層級 |
| `/settings/hardware` | **刪除** | 引擎參數給預設值 |
| `/settings/assistant` | **刪除** | 內建單一預設 assistant |
| `/settings/engine-settings` | **刪除** | |
| `/settings/llm-router` | **刪除** | |
| `/settings/guardrails` | **刪除** | |
| `/logs`、`/local-api-server/logs`、`/system-monitor` | **刪除** | 三個輔助視窗,開發者改用 devtools |

設定頁收斂結果:**General / Providers / About** 三頁。

## 2. Tauri commands 對照(src-tauri/src/commands/mod.rs + plugins)

### 2.1 移植到 Electron main(Node 重實作)

| 類別 | commands | 移植說明 |
|---|---|---|
| FS 基本 | `join_path`, `mkdir`, `exists_sync`, `readdir_sync`, `read_file_sync`, `read_file_base64`, `rm`, `mv`, `copy_file`, `file_stat`, `write_file_sync`, `write_blob`, `unlink_sync`, `append_file_sync`, `write_binary_file`, `write_text_file`, `validate_sha256` | Node fs/promises 直翻;`read_file_base64` AX BI 上傳需要 |
| FS 模型相關 | `get_gguf_files`, `write_yaml`, `read_yaml`, `decompress` | 模型註冊(model.yml)與 llama.cpp 二進位解壓需要 |
| 對話框 | `open_dialog`, `save_dialog` | Electron `dialog` 模組 |
| App 設定 | `get_app_configurations`, `get_app_data_folder_path`, `default_data_folder_path`, `change_app_data_folder`, `get_user_home_path`, `get_configuration_file_path` | 資料夾管理保留 |
| 系統 | `relaunch`, `open_file_explorer`, `factory_reset`, `canonicalize_path`, `dir_name`, `base_name`, `is_subdirectory`, `log` | Electron `app.relaunch` / `shell` |
| Secrets | `get_secret`, `set_secret`, `delete_secret` | Electron `safeStorage`(AX BI token 需要) |
| 內部 proxy | `start_server`, `stop_server`, `get_server_status`, `register_provider_config`, `register_provider_configs_batch`, `unregister_provider_config`, `list_provider_configs`, `abort_remote_stream` | Express/Fastify 重實作;僅 loopback、注入雲端金鑰;**不對外開放** |
| Threads | `list_threads`, `create_thread`, `modify_thread`, `delete_thread`, `list_messages`, `create_message`, `modify_message`, `modify_messages`, `delete_message`, `get_thread_assistant`, `create_thread_assistant`, `modify_thread_assistant` | JSON 檔邏輯簡單,直接 Node port;assistant 欄位可簡化 |
| 下載 | `download_files`, `cancel_download_task` | HF 模型下載 + 斷點續傳 + 進度事件 |
| 檔案開啟 | `take_pending_open_files` | Electron `open-file` / 第二實例 argv(低優先) |
| llamacpp plugin(27) | `load_llama_model`, `unload_llama_model`, sessions, `read_gguf_metadata`, `get_devices`, backend 管理, `get_random_port`, cleanup 等 | **最大移植項**:spawn `llama-server`、port 分配、readiness、process group 回收;**排除 `start_ax_serving`** |
| hardware plugin(2) | `get_system_info`, `get_system_usage` | `systeminformation` + `nvidia-smi` |

### 2.2 刪除(不移植)

| 類別 | commands | 理由 |
|---|---|---|
| akidb(5) | `read_akidb_config` 等 | RAG 移除 |
| 擴充系統(5) | `install_extension(s)`, `get_active_extensions`, `uninstall_extension`, `get_app_extensions_path` | llamacpp/download 邏輯內建進 main |
| MCP(9) | `get_tools`, `call_tool`, `activate_mcp_server` 等 | AX BI 改用 `web-app/src/lib/ax-bi/sdk.ts` 純 fetch 直連 |
| Voice(6) | `voice_*` | whisper 移除 |
| Research(1) | `scrape_url` | |
| 自研 updater(2) | `check_for_app_updates`, `get_install_channel` | 換 electron-updater |
| 程序內 MLX(14) | `mlx_load_model` / `mlx_chat_stream` 等推論命令 | 改 ax-engine sidecar;`mlx-ipc-fetch.ts` 同步刪除。但 HF cache 匯入用的 6 個 fs/path helper(**不刪,已移植 Electron main**,Phase 3 slice 4):`mlx_hf_snapshot_dir`、`mlx_resolve_model_dir`、`mlx_list_hf_cache_models`、`mlx_has_model_manifest`、`mlx_cleanup_import_artifacts`、`mlx_generate_model_manifest`(後者 shell out 到 `ax-engine-bench generate-manifest`,見 `electron/src/commands/mlx.ts`) |
| ax-serving | `start_ax_serving` 及 JS 側 ax-serving 模式 | 停用;`model-manifest.json` 模型改路由到 ax-engine serve |
| 文件解析 | `extract_document_text` | RAG 移除;PDF 純文字若保留改用 JS 庫 |

### 2.3 新增(Electron 原生)

| 功能 | 說明 |
|---|---|
| ax-engine sidecar 管理(macOS) | spawn `ax-engine serve <model> --port <p>`,port 由 31418 起探測空閒;`AX_ENGINE_API_KEY` 走 env;FileLock + `server.json`;健康檢查 `GET /v1/models`(冷啟動可達 240s);換模型用 `POST /v1/model/load`(不必重啟),launch posture 不符才 respawn;SIGTERM→5s→SIGKILL 且殺前驗證 pid cmdline;直接參考 AX Code `packages/ax-code/src/provider/ax-engine/`(server.ts / dependency.ts / lifecycle.ts / paths.ts) |
| electron-updater | 取代 tauri-plugin-updater + 自研 HMAC updater |
| 視窗控制 | 原生 frame 或 preload bridge 取代 `window-drag.ts` / `WindowControls.tsx` |
| `shell.openExternal` | 取代 tauri-plugin-opener(AX BI 結果連結需要) |

## 3. ServiceHub 服務對照(web-app/src/services/)

| 服務 | 決定 |
|---|---|
| theme, window, events, dialog, opener, path, app | 保留,新增 `electron.ts` 實作 |
| hardware, models, providers, threads, messages, core, uploads | 保留,底層換 Electron IPC |
| updater | 保留,改接 electron-updater |
| mcp | **刪除**(AX BI 走 sdk.ts) |
| assistants, projects, rag, voice, deeplink, globalShortcut | **刪除** |
| chatOrganization | 檢討後刪除(threads 整理功能簡化) |

## 4. AX BI 簡化規格

- 連線零設定:MCP URL 預設 `http://127.0.0.1:31421/mcp` 隱藏;首次僅要求 API key,存 `safeStorage`。
- 主對話為唯一主要入口:沿用 `authoring-workflow.ts` delegation 攔截,結果卡片化 + `shell.openExternal` 開啟 dashboard。
- `sdk.ts` 的 `MCPClient` 從「僅型別引用」改為正式 runtime 路徑(取代 `createServiceHubAxBiAuthoringClient` 的 Rust MCP 依賴)。
- `/ax-bi` 工作區頁:降級為 run 歷史檢視,或整併入對話;三窗格表單移除。

## 5. 模型路由(macOS 雙引擎)

| 模型類型 | 引擎 | 路徑 |
|---|---|---|
| GGUF | llama.cpp | Electron main spawn `llama-server`(隨機 port)→ 內部 proxy |
| 含 `model-manifest.json`(AX native / MLX) | ax-engine | sidecar `ax-engine serve`(127.0.0.1:31418 起)→ OpenAI 相容 HTTP `/v1/*` |
| Windows / Linux | llama.cpp only | 同 GGUF 路徑 |

判斷邏輯沿用 llamacpp-extension 現有 `model-manifest.json` 偵測,目標由 ax-serving 改為 ax-engine。

### ax-engine sidecar 已確認事實(2026-07-26 調查 ax-engine / ax-code 公開 repo)

- **跨產品合約已存在**:ax-engine `docs/LOCAL-ENGINE-CLIENTS.md` 明定 `sidecar_http` 為 AX Studio 的未來路徑,lifecycle phases 字面值需與 AX Code 一致(`unavailable → missing_dependency → missing_model → starting → ready / degraded / error`)。
- **執行期模型管理存在**:`POST /v1/model/load`(`model_id`, `model_path`, `load_mode:"add"`, `make_default`)/ `POST /v1/model/unload`,**換模型不必重啟**;注意是單數 `/v1/model/`,沒有 `DELETE /v1/models/{id}`。
- **context 設定沒有 `--context-length`**:視窗 = `--total-blocks × --block-size-tokens`,預設 1024×16 = 16k,不給參數會把每個模型靜默鎖在 16k。
- **效能指標**:chat SSE 裡**沒有** `ax_engine_metrics` 欄位;非串流 `usage.prompt_tokens_details.cached_tokens` 有 prefix-cache 資訊;詳細 timing 在 `/metrics`(Prometheus)與 stepwise endpoints。tok/s 需 client 端估算。`web-app` 的 `createAxEngineMetadataExtractor` 預期需調整。
- **平台門檻**(AX Code platform.ts):macOS ≥ 26、Apple Silicon、記憶體建議 64GB+;binary 解析順序:config `binaryPath` → `AX_ENGINE_BIN` → PATH → 管理安裝目錄;版本下限 6.9.0。
- **sidecar-backend.ts 的 port 要改**:檔案內預設 `18181` 與實際 `31418` 不符,啟用時需修正。

### ax-engine 二進位分發(已確認方向)

GitHub Release 的 raw tarball 目前**不含 MLX dylibs/metallib,無法獨立運作**(AX Code 因此在 constants.ts 停用了 managed download,改以 Homebrew 為唯一支援路徑)。

**已確認:下一版 ax-engine 的 release artifact 將自含 MLX 產物**(`libmlx.dylib`、`libjaccl.dylib`、`mlx.metallib`,規格等同 `scripts/prepare-mlx-runtime.mjs` 的打包清單)。屆時 Electron main 可比照 llama.cpp 模式:執行期下載、解壓、spawn,使用者無感。

Fallback(若自含 artifact 延期):Electron main 執行期自行組裝——下載 tarball + 拉 MLX wheel 抽出三個產物,spawn 時設 `DYLD_LIBRARY_PATH`。需自行維護 ax-engine ↔ mlx 版本對應。

## 6. 開放問題

1. ~~`ax-engine serve` 是否支援執行期 load/unload~~ → **已確認支援**(`POST /v1/model/load|unload`)。
2. ~~SSE 效能欄位~~ → **已確認無 `ax_engine_metrics`**;指標 UI 改用 `/metrics` 或 client 端估算。
3. ~~ax-engine 自含二進位分發~~ → **已確認:下一版 ax-engine release 將自含 MLX dylibs/metallib**;fallback 為執行期自行組裝(見第 5 節)。待新版本發布後驗證 rpath 與乾淨機首次 load。
4. PDF 純文字附檔是否保留(若留,用 JS 庫取代 `extract_document_text`)。
5. ax-studio 的 platform 門檻是否沿用 AX Code 標準(macOS ≥ 26、Apple Silicon、64GB+),或放寬。
