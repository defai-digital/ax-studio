# Ax-Fabric Gap Analysis Report

**Date:** 2026-03-06
**Scope:** Comprehensive audit of the entire Ax-Fabric codebase — frontend, Rust backend, core package, extensions, services layer, configuration, and tests.
**Objective:** Identify all placeholder functions, stubs, incomplete implementations, dead code, missing error handling, and feature gaps.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Summary by Area](#summary-by-area)
3. [Critical Findings](#critical----must-fix)
4. [High Severity Findings](#high----significant-functional-gaps)
5. [Medium Severity Findings](#medium----incomplete-features--misleading-ui)
6. [Low Severity Findings](#low----cleanup--tech-debt)
7. [Default Service Stubs — Full Inventory](#default-service-stubs----full-inventory)
8. [Platform Coverage Matrix](#platform-coverage-matrix)
9. [Backend Services Wiring Status](#backend-services-wiring-status)
10. [Key Takeaways & Recommendations](#key-takeaways--recommendations)

---

## Executive Summary

The desktop (Tauri) path of Ax-Fabric is substantially complete and functional. The major gaps fall into three categories:

1. **Web/mobile platform stubs** — ~35 service methods are no-ops outside Tauri, making the web build non-functional for most features.
2. **Backend services not wired** — Agents Service (:8002) and AkiDB (:8003) are configured but never called; OAuth has no token refresh.
3. **Removed feature scaffolding** — Llamacpp removal left dead UI (token counter, model support status, GPU selection) that renders but does nothing.

**Total findings: 47** — 5 Critical, 10 High, 16 Medium, 16 Low.

---

## Summary by Area

```
+----------------------------+----------+------+--------+-----+
| Area                       | Critical | High | Medium | Low |
+----------------------------+----------+------+--------+-----+
| Rust Backend (proxy/MCP)   |    3     |  3   |   6    |  5  |
| Frontend Services/Stubs    |    -     |  3   |   4    |  1  |
| Extensions/Core            |    -     |  3   |   1    |  2  |
| Build/Config               |    2     |  -   |   1    |  -  |
| Integrations/OAuth         |    -     |  1   |   1    |  1  |
| UI Components/Hooks        |    -     |  -   |   3    |  3  |
| Tests                      |    -     |  -   |   -    |  4  |
+----------------------------+----------+------+--------+-----+
| TOTAL                      |    5     |  10  |   16   | 16  |
+----------------------------+----------+------+--------+-----+
```

---

## CRITICAL — Must Fix

### 1. `abort_remote_stream` — Missing Tauri Command (Mobile Compile Error)

- **File:** `src-tauri/src/lib.rs:213`
- **Details:** The mobile invoke handler registers `core::server::remote_provider_commands::abort_remote_stream` as a Tauri command, but the function does not exist anywhere in `remote_provider_commands.rs`. This will cause a **compile error on any mobile build target** (Android/iOS). The desktop build omits this command entirely.
- **Impact:** Mobile builds will fail to compile.
- **Fix:** Either implement `abort_remote_stream` in `remote_provider_commands.rs` or remove it from the mobile command registration.

---

### 2. Hardcoded Fallback HMAC Signing Key in Production

- **Files:** `src-tauri/src/core/downloads/helpers.rs:47-49`, `src-tauri/src/core/updater/custom_updater.rs:21-23`
- **Code:**
  ```rust
  const SECRET_KEY: &str = match option_env!("AX_FABRIC_SIGNING_KEY") {
      Some(key) => key,
      None => "local-dev-test-key-not-for-production",
  };
  ```
- **Details:** If `AX_FABRIC_SIGNING_KEY` is not set at compile time (e.g., a developer build distributed without CI), the HMAC-signed download and update requests use the literal string `"local-dev-test-key-not-for-production"`. There is no runtime assertion or warning that fails loud when the key is missing in a release context.
- **Impact:** Builds distributed without the env var will use a publicly visible signing key, potentially allowing tampered downloads to pass HMAC verification.
- **Fix:** Add a compile-time `#[cfg]` assertion or a runtime startup warning when using the fallback key.

---

### 3. Updater Signing Public Key is a Placeholder

- **File:** `src-tauri/tauri.conf.json:47`
- **Code:**
  ```json
  "pubkey": "PLACEHOLDER_REPLACE_WITH_AX_FABRIC_SIGNING_KEY",
  ```
- **Details:** The auto-updater signature verification key has never been replaced. Additionally, `createUpdaterArtifacts` is set to `false` (line 60), meaning no delta/updater packages are produced by the build.
- **Impact:** Auto-update signature verification will always fail. OTA updates are effectively non-functional.
- **Fix:** Generate a real key pair and replace the placeholder. Set `createUpdaterArtifacts: true` when ready.

---

### 4. 60+ `.unwrap()` Calls in Production Proxy (`proxy.rs`)

- **File:** `src-tauri/src/core/server/proxy.rs` (throughout)
- **Details:** The proxy is on the critical path for **every LLM API call**. Multiple `.unwrap()` calls in non-test, non-const code can panic the entire Tauri process:
  ```rust
  // proxy.rs:1788 — fragile pattern
  let has_finish = finish_reason.is_some() && !finish_reason.unwrap().is_null();

  // proxy.rs:313 — building HTTP responses
  .unwrap()

  // proxy.rs:1372 — inside Anthropic->OpenAI fallback path
  .expect("Failed to create fallback client")
  ```
  Almost all 60+ `.unwrap()` calls are on `Response::Builder::body()` results, which can return `Err` on invalid header values.
- **Impact:** Any unexpected response shape, invalid header, or edge case will crash the entire app instead of returning an error to the user.
- **Fix:** Replace with `unwrap_or_else` or propagate errors via `?` operator.

---

### 5. `validate_postgres` Does Not Actually Connect

- **File:** `src-tauri/src/core/integrations/commands.rs:431-442`
- **Code:**
  ```rust
  async fn validate_postgres(credentials: &HashMap<String, String>) -> Result<String, String> {
      let conn_str = credentials
          .get("POSTGRES_CONNECTION_STRING")
          .ok_or("Missing POSTGRES_CONNECTION_STRING")?;
      // Basic format validation — actual connection test happens when MCP server starts
      if conn_str.starts_with("postgresql://") || conn_str.starts_with("postgres://") {
          Ok("Connection string format valid".to_string())
      } else {
          Err("Invalid connection string. Must start with postgresql:// or postgres://".to_string())
      }
  }
  ```
- **Details:** The comment acknowledges this is a stub. Users clicking "Test Connection" for PostgreSQL receive "Connection string format valid" for any syntactically-correct but completely wrong connection string (wrong password, non-existent host, etc.).
- **Impact:** Users get false positive validation results.
- **Fix:** Add an actual TCP connection attempt (could use `tokio-postgres` or a raw TCP connect with timeout).

---

## HIGH — Significant Functional Gaps

### 6. Agents Service (:8002) — Configured But Never Called

- **File:** `web-app/src/stores/useAxFabricConfig.ts`
- **Details:** The `agentsServiceUrl` is configured in the Zustand store, synced to Rust state via `update_ax_fabric_service_config`, but there are **zero** frontend HTTP calls or Rust proxy routes that ever contact port 8002. The entire external agents backend integration is a configuration placeholder with no functional wiring.
- **Impact:** Users can configure the Agents Service URL, but it has no effect on the application.
- **Fix:** Implement the agent service client or remove the configuration option to avoid user confusion.

---

### 7. No OAuth Token Refresh Logic

- **Files:** `src-tauri/src/core/integrations/oauth.rs`
- **Details:** The Google OAuth flow acquires `access_token`, `refresh_token`, and `expiry_timestamp`, but:
  - `expiry_timestamp` is stored in `OAuthTokens` struct but **never checked** for expiry
  - No code calls the Google token refresh endpoint
  - `validate_google_workspace_config()` (lines 361-388) only checks file existence and presence of `refresh_token` field — does not validate token freshness
- **Impact:** After ~1 hour, the Google Workspace MCP server starts receiving 401 errors. Users get opaque failures with no automatic re-auth prompt.
- **Fix:** Implement a token refresh check before MCP server operations, or add a periodic refresh task.

---

### 8. `IntegrationService` Bypasses ServiceHub — No Web/Mobile Fallback

- **File:** `web-app/src/hooks/useIntegrations.ts:9`
- **Code:**
  ```typescript
  const service = new TauriIntegrationService()  // hardcoded, not via ServiceHub
  ```
- **Details:** Unlike every other service, `IntegrationService` is not registered in the `ServiceHub`. No `default.ts` fallback exists. On Web/mobile, any integration call will throw at runtime because `TauriIntegrationService.invoke()` calls will fail.
- **Impact:** Integrations completely broken on non-Tauri platforms.
- **Fix:** Add `DefaultIntegrationService` with appropriate stubs and register via ServiceHub.

---

### 9. `ingestImage` Is a Fake Stub

- **File:** `web-app/src/services/uploads/default.ts:42-47`
- **Code:**
  ```typescript
  async ingestImage(_threadId: string, attachment: Attachment): Promise<UploadResult> {
      // Images are inlined directly by the chat transport; no upload needed yet.
      await new Promise((r) => setTimeout(r, 100))  // artificial 100ms delay
      return { id: ulid() }  // returns fake ID, no actual upload
  }
  ```
- **Impact:** Image attachment ingestion appears to succeed but no actual upload occurs. The returned ID is a locally-generated ULID, not a server-assigned one.
- **Fix:** Either implement real image upload to the retrieval service, or clearly mark this as an inline-only path in the UI.

---

### 10. `max_tokens` Commented Out of Anthropic-to-OpenAI Transform

- **File:** `src-tauri/src/core/server/proxy.rs:67-78`
- **Code:**
  ```rust
  for key in &[
      // "max_tokens",   // <-- deliberately commented out
      "temperature",
      "top_p",
      "top_k",
      "frequency_penalty",
      "presence_penalty",
  ] {
  ```
- **Impact:** Every Anthropic-to-OpenAI translation silently drops the context window limit. This can cause unbounded token usage or unexpected truncation at the upstream provider's default.
- **Fix:** Restore `max_tokens` to the passthrough list, or add explicit mapping logic if the field name differs between providers.

---

### 11. `RAGExtension` + `VectorDBExtension` — Abstract Only, No Implementation

- **Files:** `core/src/browser/extensions/rag.ts`, `core/src/browser/extensions/vector-db.ts`
- **Details:**
  - `RAGExtension` declares 6 abstract methods: `getTools()`, `getToolNames()`, `callTool()`, `ingestAttachments()`, `ingestAttachmentsForProject()`, `parseDocument()`
  - `VectorDBExtension` declares 14 abstract methods covering full CRUD operations for thread-scoped and project-scoped vector storage
  - **No concrete implementing class exists** anywhere in the repository
- **Impact:** The extension-based RAG and VectorDB architecture is entirely aspirational. Current RAG functionality is handled by direct HTTP calls to the retrieval service, bypassing the extension system.
- **Fix:** Either implement concrete extensions or remove the abstract classes to reduce confusion.

---

### 12. `OAIEngine.inference()` — Empty Method Body

- **File:** `core/src/browser/extensions/engines/OAIEngine.ts:47`
- **Code:**
  ```typescript
  inference(data: MessageRequest) {}
  ```
- **Details:** The base inference engine method subscribes to `MessageEvent.OnMessageSent` but its body is completely empty. Any subclass that does not override this will silently process no inferences.
- **Impact:** Silent inference failures if a subclass forgets to override.
- **Fix:** Mark as `abstract` or add a warning log.

---

### 13. `LocalOAIEngine.loadModel()` and `unloadModel()` — Empty Bodies

- **File:** `core/src/browser/extensions/engines/LocalOAIEngine.ts:31-40`
- **Code:**
  ```typescript
  async loadModel(model: Model & { file_path?: string }): Promise<void> {
      // Implementation of loading the model
  }
  async unloadModel(model?: Model) {
      // Implementation of unloading the model
  }
  ```
- **Details:** Both methods are event handlers for `ModelEvent.OnModelInit` and `ModelEvent.OnModelStop`. They contain only a comment saying "Implementation of..." with zero actual logic.
- **Impact:** Local model loading/unloading is a no-op.
- **Fix:** Implement or mark as abstract.

---

### 14. `open_app_directory` / `open_file_explorer` — Panic on Failure

- **File:** `src-tauri/src/core/system/commands.rs:112-151`
- **Code:**
  ```rust
  pub fn open_app_directory<R: Runtime>(app: AppHandle<R>) {  // returns ()
      std::process::Command::new("open")
          .arg(app_path)
          .status()
          .expect("Failed to open app directory");  // panics the process
  }
  ```
- **Details:** Both commands return `()` (not `Result`). If `explorer`, `open`, or `xdg-open` is not present (minimal Linux container, Windows Server Core, sandboxed env), the entire app crashes.
- **Impact:** App crash on platforms without standard file manager binaries.
- **Fix:** Return `Result<(), String>` and propagate the error.

---

### 15. `app.emit(...).unwrap()` in Download Progress Path

- **File:** `src-tauri/src/core/downloads/helpers.rs:543, 701, 720`
- **Code:**
  ```rust
  app.emit(&evt_name, final_evt).unwrap();
  ```
- **Details:** Emitting Tauri events can fail (e.g., if the webview window has closed mid-download). These panics would terminate the entire app.
- **Impact:** App crash if user closes the window while a download is in progress.
- **Fix:** Replace with `if let Err(e) = app.emit(...) { log::warn!(...) }`.

---

## MEDIUM — Incomplete Features & Misleading UI

### 16. Token Counting Always Returns 0

- **File:** `web-app/src/hooks/useTokensCount.ts`
- **Code:**
  ```typescript
  const runTokenCalculation = useCallback(async () => {
      setTokenData({ tokenCount: 0, loading: false, isNearLimit: false })
  }, [])
  ```
- **Details:** Llamacpp removal left the `TokenCounter` component rendering a permanent `0.0%` progress ring. The entire debounce mechanism (refs, timeouts, request IDs) is scaffolding for removed functionality.
- **Impact:** Misleading UI — appears to be a working feature but always shows zero.
- **Fix:** Either implement cloud-based token counting or remove the component entirely.

---

### 17. `ModelSupportStatus` Renders `null`

- **File:** `web-app/src/containers/ModelSupportStatus.tsx`
- **Code:**
  ```typescript
  // ModelSupportStatus previously showed GGUF/llamacpp memory-fit indicators.
  // llamacpp has been removed from the project, so this component is a no-op.
  export const ModelSupportStatus = ({ ... }) => {
      return null  // always renders nothing
  }
  ```
- **Impact:** Dead component. All four props are silenced with `_` prefix. Callers render nothing.
- **Fix:** Remove the component and all call sites.

---

### 18. `isRecommendedModel` Always Returns `false`

- **Files:** `web-app/src/containers/DownloadButton.tsx:99-101`, `web-app/src/routes/hub/index.tsx:287-289`
- **Code:**
  ```typescript
  const isRecommendedModel = useCallback((_modelId: string) => {
      return false  // Always returns false
  }, [])
  ```
- **Details:** The "recommended model" highlighting, onboarding CSS class `hub-download-button-step`, and the conditional branch at line 143 are all dead code paths.
- **Impact:** Onboarding model recommendation flow is non-functional.
- **Fix:** Implement recommendation logic or remove the dead code.

---

### 19. Download Resume Disabled

- **File:** `src-tauri/src/core/downloads/commands.rs:29`
- **Code:**
  ```rust
  // TODO: Support resuming downloads when FE is ready
  let result = _download_files_internal(..., false, ...);  // resume flag hardcoded to false
  ```
- **Details:** The backend has full resume logic already implemented (`_get_maybe_resume_with_fallback`, range-request support), but it is deliberately disabled.
- **Impact:** Large model downloads must restart from scratch if interrupted.
- **Fix:** Implement frontend resume UI and flip the flag to `true`.

---

### 20. CDN Mirror Infrastructure Is Dead Code

- **File:** `src-tauri/src/core/downloads/helpers.rs:22-27`
- **Code:**
  ```rust
  /// CDN mirrors are disabled until the domains are provisioned.
  const AX_FABRIC_MIRROR_PREFIX_STABLE: &str = "";
  const AX_FABRIC_MIRROR_PREFIX_NIGHTLY: &str = "";
  const MIRROR_DOMAINS: &[&str] = &[];
  ```
- **Details:** Full mirror download infrastructure (HMAC, URL conversion, fallback) exists but is entirely inert because `MIRROR_DOMAINS` is empty.
- **Impact:** Increased binary size from dead code. No CDN acceleration available.
- **Fix:** Either provision CDN domains or remove the dead code.

---

### 21. `setActiveGpus` Is a No-Op on ALL Platforms

- **Files:** `web-app/src/services/hardware/default.ts:22`, `web-app/src/services/hardware/tauri.ts:34-37`
- **Code (Tauri — the "real" implementation):**
  ```typescript
  async setActiveGpus(data: { gpus: number[] }): Promise<void> {
      // TODO: llama.cpp extension should handle this
      console.log(data)
  }
  ```
- **Impact:** GPU selection UI does nothing on any platform. Users can toggle GPUs but no effect occurs.
- **Fix:** Implement via the hardware plugin or remove the GPU selection UI.

---

### 22. Extensions Settings Menu Hidden

- **File:** `web-app/src/containers/SettingsMenu.tsx:148-154`
- **Code:**
  ```typescript
  // Hide Extension settings for now
  // {
  //   title: 'common:extensions',
  //   route: route.settings.extensions,
  //   hasSubMenu: false,
  //   isEnabled: true,
  // },
  ```
- **Details:** The route `settings/extensions.tsx` exists and has a working component, but the menu entry is commented out.
- **Impact:** Extensions management is inaccessible to users.
- **Fix:** Uncomment when ready, or remove the route if not planned.

---

### 23. MCP Placeholder API Keys Written to Config

- **Files:** `src-tauri/src/core/setup.rs:173`, `src-tauri/src/core/mcp/constants.rs:43`
- **Code:**
  ```rust
  "env": { "EXA_API_KEY": "YOUR_EXA_API_KEY_HERE" }
  // also:
  "SERPER_API_KEY": "YOUR_SERPER_API_KEY_HERE"
  "/path/to/other/allowed/dir"  // filesystem server path
  ```
- **Details:** These literal placeholder strings are written as actual config values. If a user activates the Exa/Serper/filesystem MCP server without editing, the MCP process receives these strings as real values, causing opaque failures.
- **Impact:** Confusing error messages when users activate MCP servers without customizing config.
- **Fix:** Add validation that detects placeholder values and prompts the user before activation.

---

### 24. `persistRunLog` Errors Silently Swallowed

- **File:** `web-app/src/lib/custom-chat-transport.ts:872, 886`
- **Code:**
  ```typescript
  persistRunLog(runLog).catch(() => {})
  ```
- **Details:** Two separate call sites swallow `persistRunLog` errors completely with an empty `.catch(() => {})`. Agent run log persistence failures are fully invisible.
- **Impact:** Debugging agent execution history becomes impossible when persistence silently fails.
- **Fix:** Add at minimum `console.error` or a toast notification.

---

### 25. Bridge Port `17389` Hardcoded in 3 Places

- **Files:** `src-tauri/src/core/mcp/constants.rs:14`, `src-tauri/src/core/setup.rs:191`, `src-tauri/src/core/mcp/commands.rs:401`
- **Details:** The MCP bridge port is triplicated as a raw string literal. If it needs changing, three files must be updated in sync.
- **Fix:** Extract to a single constant in `constants.rs` and reference it from `setup.rs` and `commands.rs`.

---

### 26. Sandbox URL `127.0.0.1:8080` Hardcoded in 3 Places

- **Files:** `src-tauri/src/lib.rs:287`, `src-tauri/src/core/code_execution/sandbox.rs:123, 134`
- **Code:**
  ```rust
  sandbox_url: Arc::new(Mutex::new("http://127.0.0.1:8080".to_string())),
  // sandbox.rs:
  .unwrap_or("127.0.0.1:8080")
  &addr.parse().unwrap_or_else(|_| "127.0.0.1:8080".parse().unwrap()),
  ```
- **Details:** Includes a nested `.unwrap()` inside `unwrap_or_else` — theoretically safe for this literal but fragile.
- **Fix:** Extract to a constant and use proper error handling.

---

### 27. `expect()` in User-Triggered `save_mcp_configs`

- **File:** `src-tauri/src/core/mcp/commands.rs:585`
- **Code:**
  ```rust
  serde_json::to_value(&settings).expect("Failed to serialize MCP settings"),
  ```
- **Details:** This is a user-triggered command path. If serialization fails for any reason, the Tauri process panics. The same operation in `get_mcp_configs` correctly uses `map_err`.
- **Fix:** Replace with `.map_err(|e| e.to_string())?`.

---

### 28. `println!` / `eprintln!` Bypass Log Pipeline

- **Files:** 9 locations across the Rust backend:
  - `mcp/commands.rs:264, 328`
  - `threads/commands.rs:51`
  - `lib.rs:24`
  - `setup.rs:342`
  - `research/commands.rs:121`
  - `threads/helpers.rs:57, 65, 69`
- **Details:** These bypass the structured logging pipeline (tauri-plugin-log), meaning they never appear in the app's log file and are invisible to users reporting issues.
- **Fix:** Replace with `log::info!`, `log::warn!`, or `log::error!`.

---

### 29. `DefaultPathService` Returns Empty Strings

- **File:** `web-app/src/services/path/default.ts:12-31`
- **Code:**
  ```typescript
  async join(...segments: string[]): Promise<string> { return '' }
  async dirname(path: string): Promise<string> { return '' }
  async basename(path: string): Promise<string> { return '' }
  async extname(path: string): Promise<string> { return '' }
  ```
- **Impact:** Any code using path operations on Web silently gets empty strings, leading to broken file references.
- **Fix:** Implement using JavaScript's `path` polyfill (e.g., `path-browserify`).

---

### 30. Mobile Never Upgrades `hardware` or `updater` Services

- **File:** `web-app/src/services/index.ts:164-201`
- **Details:** The mobile branch never upgrades `hardwareService` (stays `DefaultHardwareService` returning null/empty) or `updaterService` (stays `DefaultUpdaterService` returning null). No OTA updates or system monitoring on mobile.
- **Fix:** Implement mobile-specific service variants or gracefully hide the affected UI.

---

### 31. `callTool` Default Missing `serverName` Parameter — Interface Mismatch

- **Files:** `web-app/src/services/mcp/default.ts:31` vs `web-app/src/services/mcp/types.ts:25`
- **Details:** The interface declares `serverName?` in `callTool` args, but the default stub omits it. TypeScript won't catch this because the stub accepts a subset.
- **Fix:** Align the default stub signature with the interface.

---

### 32. MCP Restart Errors Silently Dropped

- **File:** `src-tauri/src/core/mcp/helpers.rs:668`
- **Code:**
  ```rust
  let _ = start_mcp_server(app_clone, servers_clone, name_clone, config_clone).await;
  ```
- **Details:** Inside the MCP auto-restart loop, restart errors are silently dropped. A server can thrash-restart indefinitely with no observable signal beyond log lines.
- **Fix:** Add a restart counter and escalate (disable server + notify user) after N consecutive failures.

---

## LOW — Cleanup / Tech Debt

### 33. `unregister_provider_config` Returns `Ok` When Provider Not Found

- **File:** `src-tauri/src/core/server/remote_provider_commands.rs:53-69`
- **Details:** The `else` branch logs a warning but returns `Ok(())`. Frontend cannot distinguish "successfully deleted" from "provider did not exist."
- **Fix:** Return `Err` for missing provider, or return a boolean indicating whether deletion occurred.

---

### 34. 4 Skipped Engine Migration Tests

- **File:** `core/src/browser/extensions/engines/EngineManager.test.ts:44-74`
- **Details:** `test.skip` on all four cortex engine migration tests (`nitro`, `cortex_llamacpp`, `cortex_onnx`, `cortex_tensorrtllm`).
- **Fix:** Either implement and enable the tests or remove them if the migration path is no longer relevant.

---

### 35. `testValidModelCreation` — Entire File Skipped

- **File:** `core/src/types/model/modelEntity.test.ts:5`
- **Details:** `test.skip('testValidModelCreation')` — the `Model` type entity has zero passing test coverage.
- **Fix:** Implement the test or remove the file.

---

### 36. Language Switcher Test Commented Out

- **File:** `web-app/src/routes/settings/__tests__/general.test.tsx:326-332`
- **Code:**
  ```typescript
  // TODO: This test is currently commented out due to missing implementation
  // it('should render language switcher', () => { ... })
  ```
- **Details:** The language switcher UI component lacks a `data-testid` attribute.
- **Fix:** Add the test ID to the component and enable the test.

---

### 37. Factory Reset Test Skipped

- **File:** `web-app/src/services/__tests__/app.test.ts:149`
- **Details:** `it.skip('should perform factory reset')`.
- **Fix:** Implement or remove.

---

### 38. Leftover `console.log` in Production UI

- **File:** `web-app/src/containers/DropdownToolsAvailable.tsx:233`
- **Code:**
  ```typescript
  console.log('checked', checked)
  ```
- **Details:** Debug logging left in an `onCheckedChange` handler.
- **Fix:** Remove.

---

### 39. `agent_ids: []` in All 6 Agent Team Configs

- **Files:** All files in `agent-teams/*.json`
- **Details:** Every agent team config has `"agent_ids": []`. The ID-based cross-reference system is unused — all teams use inline `agents` arrays.
- **Fix:** Either implement the cross-reference system or remove the `agent_ids` field from the schema.

---

### 40. 4 TODO Comments on Core Types

- **Files:**
  - `core/src/types/message/messageEntity.ts:76` — `// TODO: deprecate threadId field`
  - `core/src/types/file/index.ts:7` — `// TODO: change to download id`
  - `core/src/types/miscellaneous/systemResourceInfo.ts:9` — `// TODO: This needs to be set based on user toggle in settings`
  - `core/src/browser/fs.ts:92` — `// TODO: Export dummy fs functions automatically`
- **Fix:** Address or remove each TODO.

---

### 41. OAuth Port Range Hardcoded

- **File:** `src-tauri/src/core/integrations/oauth.rs:350-357`
- **Code:**
  ```rust
  for port in 12300..12400 {
      if let Ok(listener) = tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
  ```
- **Details:** The OAuth callback port range is not configurable. In restricted network environments with firewall rules on these ports, OAuth fails with a confusing error message.
- **Fix:** Make the range configurable or widen it.

---

### 42. `store.save().expect(...)` at Startup

- **Files:** `src-tauri/src/lib.rs:333`, `src-tauri/src/core/setup.rs:208`
- **Details:** If store save fails during migration, app crashes with no user dialog.
- **Fix:** Replace with `map_err` and surface to the user.

---

### 43. Commented-Out Buggy `content_length()` Call

- **File:** `src-tauri/src/core/downloads/helpers.rs:357-358`
- **Code:**
  ```rust
  // this is buggy, always return 0 for HEAD request
  // Ok(resp.content_length().unwrap_or(0))
  ```
- **Details:** Dead code left with explanation comment.
- **Fix:** Delete the commented line.

---

### 44. Empty `_ => {}` Match Arms Silently Swallow Unknown Types

- **Files:** `src-tauri/src/core/code_execution/sandbox.rs:310`, `src-tauri/src/core/mcp/lockfile.rs:167`
- **Details:** Unknown output types and lock file entries are silently ignored with no logging.
- **Fix:** Add `log::debug!` for unknown cases.

---

### 45. `chat_template` Tool-Call Detection TODO

- **File:** `web-app/src/services/providers/tauri.ts:33`
- **Code:**
  ```typescript
  // TODO: Check chat_template for tool call support
  return {
      capabilities: getModelCapabilities(provider.provider, model),
  } as Model
  ```
- **Details:** Uses heuristics instead of inspecting the actual model template.
- **Fix:** Implement chat template parsing for accurate capability detection.

---

### 46. `BaseExtension.onSettingUpdate()` and `install()` — Empty No-Ops

- **Files:** `core/src/browser/extension.ts:170-172, 179-181`
- **Details:** Base class hooks with no logic and no abstract enforcement. Subclasses may not realize they need to override.
- **Fix:** Document clearly or make abstract where overriding is required.

---

### 47. `OAIEngine.onUnload()` — Empty Lifecycle Stub

- **File:** `core/src/browser/extensions/engines/OAIEngine.ts:45`
- **Code:**
  ```typescript
  override onUnload(): void {}
  ```
- **Details:** The cleanup lifecycle hook is empty.
- **Fix:** Either implement resource cleanup or document that it's intentionally empty.

---

## Default Service Stubs — Full Inventory

The following services run as no-op stubs on non-Tauri (Web) platforms. Each method either returns an empty value, `null`, or throws.

### CoreService (`services/core/default.ts`)
| Method | Behavior |
|---|---|
| `invoke()` | **THROWS** `'Core invoke not implemented'` |
| `convertFileSrc()` | Returns input unchanged (no protocol conversion) |
| `getActiveExtensions()` | Returns `[]` |
| `installExtensions()` | No-op |
| `installExtension()` | Returns input unchanged |
| `uninstallExtension()` | Returns `false` |
| `getAppToken()` | Returns `null` |

### AppService (`services/app/default.ts`)
| Method | Behavior |
|---|---|
| `factoryReset()` | No-op |
| `readLogs()` | Returns `[]` |
| `getAppDataFolder()` | Returns `undefined` |
| `relocateAppDataFolder()` | No-op |
| `getServerStatus()` | Returns `false` |
| `readYaml()` | **THROWS** `'readYaml not implemented'` |

### MCPService (`services/mcp/default.ts`)
| Method | Behavior |
|---|---|
| `updateMCPConfig()` | No-op |
| `restartMCPServers()` | No-op |
| `getMCPConfig()` | Returns `{}` |
| `getTools()` | Returns `[]` |
| `getConnectedServers()` | Returns `[]` |
| `callTool()` | Returns `{ error: '', content: [] }` (fake success) |
| `callToolWithCancellation()` | Returns fake success + no-op cancel |
| `cancelToolCall()` | No-op |
| `activateMCPServer()` | No-op |
| `deactivateMCPServer()` | No-op |

### EventsService (`services/events/default.ts`)
| Method | Behavior |
|---|---|
| `emit()` | No-op (console.log only) |
| `listen()` | Returns no-op unlisten — listeners never fire |

### WindowService (`services/window/default.ts`)
| Method | Behavior |
|---|---|
| `close()` | No-op |
| `show()` | No-op |
| `hide()` | No-op |
| `focus()` | No-op |
| `setTitle()` | No-op |
| `openWindow()` | No-op |
| `openLogsWindow()` | No-op |
| `openSystemMonitorWindow()` | No-op |
| `openLocalApiServerLogsWindow()` | No-op |
| `getWebviewWindowByLabel()` | Returns `null` |

### PathService (`services/path/default.ts`)
| Method | Behavior |
|---|---|
| `join()` | Returns `''` |
| `dirname()` | Returns `''` |
| `basename()` | Returns `''` |
| `extname()` | Returns `''` |

### HardwareService (`services/hardware/default.ts`)
| Method | Behavior |
|---|---|
| `getHardwareInfo()` | Returns `null` |
| `getSystemUsage()` | Returns `null` |
| `getLlamacppDevices()` | Returns `[]` |
| `setActiveGpus()` | No-op (also no-op on Tauri!) |

### ProvidersService (`services/providers/default.ts`)
| Method | Behavior |
|---|---|
| `getProviders()` | Returns `[]` |
| `fetchModelsFromProvider()` | Returns `[]` |
| `updateSettings()` | No-op |

### UpdaterService (`services/updater/default.ts`)
| Method | Behavior |
|---|---|
| `check()` | Returns `null` |
| `installAndRestart()` | No-op |
| `downloadAndInstallWithProgress()` | No-op |

### DialogService (`services/dialog/default.ts`)
| Method | Behavior |
|---|---|
| `open()` | Returns `null` |
| `save()` | Returns `null` |

### OpenerService (`services/opener/default.ts`)
| Method | Behavior |
|---|---|
| `revealItemInDir()` | No-op |

### ThemeService (`services/theme/default.ts`)
| Method | Behavior |
|---|---|
| `setTheme()` | No-op |

### DeepLinkService (`services/deeplink/default.ts`)
| Method | Behavior |
|---|---|
| `onOpenUrl()` | Returns no-op unlisten |
| `getCurrent()` | Returns `[]` |

---

## Platform Coverage Matrix

| Service | Web (Default) | Tauri Desktop | iOS / Android |
|---|---|---|---|
| `theme` | Stub | Real | Real |
| `window` | Stub | Real | Real |
| `events` | Stub | Real | Real |
| `hardware` | Stub | Real (partial) | **Stub** |
| `app` | Stub | Real | Real |
| `mcp` | Stub | Real | Real |
| `providers` | Stub | Real | Real |
| `dialog` | Stub | Real | Real |
| `opener` | Stub | Real | Real |
| `updater` | Stub | Real | **Stub** |
| `path` | Stub | Real | Real |
| `core` | **Throws** | Real | Real |
| `deeplink` | Stub | Real | Real |
| `integrations` | **Not registered** | Hardcoded | **Not registered** |
| `models` | EngineManager | EngineManager | **Broken** (no engines) |
| `messages` | ExtensionMgr | ExtensionMgr | ExtensionMgr |
| `threads` | ExtensionMgr | ExtensionMgr | ExtensionMgr |
| `assistants` | ExtensionMgr | ExtensionMgr | ExtensionMgr |
| `projects` | localStorage | localStorage | localStorage |
| `rag` | HTTP :8001 | HTTP :8001 | HTTP :8001 |
| `uploads` | HTTP :8001 | HTTP :8001 | HTTP :8001 |

---

## Backend Services Wiring Status

| Service | Port | Config Stored | Rust Proxy Routes | Frontend HTTP Calls | Status |
|---|---|---|---|---|---|
| API Service | :8000 | Yes | Yes (inference) | Via proxy | **Functional** |
| Retrieval Service | :8001 | Yes | Yes (`/retrieval/`) | Yes (RAG, uploads) | **Functional** |
| Agents Service | :8002 | Yes | Yes (`/agents/`) | **None** | **Not wired** |
| AkiDB | :8003 | Yes | Yes (`/vectors/`) | **None** (indirect via :8001) | **Partially wired** |

---

## Key Takeaways & Recommendations

### Immediate Priority (Critical)
1. Fix the `abort_remote_stream` compile error for mobile builds
2. Replace the placeholder updater signing key
3. Audit and fix `.unwrap()` calls in `proxy.rs` — this is the hot path for every AI request
4. Address the HMAC fallback key to prevent insecure builds from being distributed

### Short-Term Priority (High)
5. Implement OAuth token refresh for Google Workspace integration
6. Wire the Agents Service (:8002) or remove its configuration to avoid user confusion
7. Add `IntegrationService` to the ServiceHub with a proper default fallback
8. Restore `max_tokens` in the Anthropic-to-OpenAI translation
9. Fix panic-on-failure in `open_app_directory` and download event emission

### Medium-Term Priority (Medium)
10. Clean up dead UI from llamacpp removal (token counter, model support status, GPU selection)
11. Implement real `ingestImage` or clearly mark it as inline-only
12. Enable download resume (backend is ready, frontend needs UI)
13. Add MCP placeholder key validation before server activation
14. Replace `println!` with structured logging

### Ongoing (Low)
15. Enable or remove skipped tests
16. Clean up dead code (commented blocks, empty match arms)
17. Extract hardcoded constants (ports, URLs) to configuration
18. Implement web platform service stubs using browser APIs where possible

---

*Report generated by comprehensive codebase audit on 2026-03-06.*
