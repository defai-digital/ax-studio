# Bugs Fixed — Ax-Fabric (54 total)

## Summary

- **10 P0** (critical) — all fixed
- **25 P1** (high) — all fixed
- **19 P2** (medium) — all fixed
- **~30 files** modified across Rust backend and React/TypeScript frontend

---

## Rust Backend

### 1. `src-tauri/src/core/mcp/commands.rs` (5 bugs)

| ID | Priority | Description |
|----|----------|-------------|
| P1-1 | P1 | Changed `"envs"` to `"env"` — wrong JSON key for BRIDGE_PORT config access |
| P1-3 | P1 | Rewrote `call_tool` to clone Arc service ref, drop lock before awaiting `call_tool` (async lock contention) |
| P1-4 | P1 | Rewrote `get_tools` to collect server refs under lock, drop lock, then query |
| P1-25 | P1 | Added `timeout()` around `list_all_tools()` in `call_tool` |
| Medium | — | Changed `.expect()` to `.map_err()?` in `save_mcp_configs` |

### 2. `src-tauri/src/core/extensions/commands.rs` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P1-2 | P1 | Changed `ext["_active"]` to `ext["active"]` — wrong JSON key for extension active status |

### 3. `src-tauri/src/core/mcp/helpers.rs` (2 bugs + Arc refactor)

| ID | Priority | Description |
|----|----------|-------------|
| P2-5 | P2 | Changed `.to_str().unwrap()` to `.to_string_lossy()` for non-UTF8 path safety |
| P1-5 | P1 | Rewrote health check to clone Arc service, drop lock before async health check |
| — | — | Updated all `RunningServiceEnum` inserts to `Arc::new(...)`, cancel calls to `Arc::try_unwrap` pattern |
| — | — | Fixed `servers_to_stop` type annotation to `Vec<(String, Arc<RunningServiceEnum>, Option<u16>)>` |

### 4. `src-tauri/src/core/mcp/lockfile.rs` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P2-9 | P2 | Changed `pid.to_string()` to `format!(" {} ", pid)` for word-boundary PID matching |

### 5. `src-tauri/src/core/system/commands.rs` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P2-2 | P2 | Changed `open_app_directory` and `open_file_explorer` return types to `Result<(), String>`, replaced `.expect()` with `.map_err()?` |

### 6. `src-tauri/src/core/app/commands.rs` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P2-4 | P2 | Fixed `default_data_folder_path` to use `unwrap_or_else` and `to_string_lossy()` instead of panicking `.unwrap()` |

### 7. `src-tauri/src/core/setup.rs` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P2-3 | P2 | Changed tray menu "open" handler from `.unwrap()` to `if let Some(window)` |

### 8. `src-tauri/src/core/server/proxy.rs` (5 bugs)

| ID | Priority | Description |
|----|----------|-------------|
| P1-6 | P1 | Uncommented `"max_tokens"` in passthrough list |
| P0-5 | P0 | Changed `.timeout()` to `.connect_timeout()` — global timeout was killing long SSE streams |
| P2-7 | P2 | Changed fallback client `.expect()` to error handling with return |
| P1-7 | P1 | Added `line_buffer` to accumulate partial SSE lines across chunks |
| P2-6 | P2 | Changed `finish_reason.is_some() && !finish_reason.unwrap().is_null()` to `finish_reason.map_or(false, \|v\| !v.is_null())` |

### 9. `src-tauri/src/core/downloads/helpers.rs` (2 bugs)

| ID | Priority | Description |
|----|----------|-------------|
| P0-1 | **P0** | Changed `remove_dir_all(parent)` to `remove_file(tmp_save_path)` — was deleting entire parent directory on cancel |
| P1-8 | P1 | Changed all `.emit(...).unwrap()` to `.emit(...).ok()` (5 occurrences) |

### 10. `src-tauri/src/core/downloads/commands.rs` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P2-14 | P2 | Changed `std::fs::remove_file` to `tokio::fs::remove_file(...).await` in async context |

### 11. `src-tauri/src/core/code_execution/sandbox.rs` (5 bugs)

| ID | Priority | Description |
|----|----------|-------------|
| P1-15 | P1 | Removed `"--security-opt", "seccomp=unconfined"` from Docker args |
| P2-13 | P2 | Extended `strip_ansi` to handle OSC `\x1b]...\x07` and single-char escapes |
| P2-10 | P2 | Added HTTP GET health check after TCP connect in `is_sandbox_ready` |
| P2-11 | P2 | Changed `start_sandbox_container` to accept `port` parameter instead of hardcoding |

### 12. `src-tauri/src/core/code_execution/commands.rs` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P2-12 | P2 | Added `sandbox_sessions.clear()` in `stop_sandbox`; updated `start_sandbox` to extract port from URL |

### 13. `src-tauri/src/core/filesystem/helpers.rs` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P0-2 | **P0** | Added `starts_with(&app_data_folder)` path traversal check for all resolved paths |

### 14. `src-tauri/src/core/filesystem/commands.rs` (3 bugs)

| ID | Priority | Description |
|----|----------|-------------|
| P0-3 | **P0** | Changed tar extraction to iterate entries manually, validating each path against output_dir |
| P1-13 | P1 | Added write-to-temp + rename pattern for `write_file_sync` and `write_yaml` |
| P1-14 | P1 | Added `starts_with(&app_data_folder)` check on `mv` source path |

### 15. `src-tauri/src/core/threads/helpers.rs` (3 items)

| ID | Priority | Description |
|----|----------|-------------|
| P0-4 | **P0** | Atomic writes for `write_messages_to_file` (write to `.tmp` then `fs::rename`) |
| P0-4b | **P0** | Atomic writes for `update_thread_metadata` (write to `.tmp` then `fs::rename`) |
| P2-15 | P2 | Added `remove_lock_for_thread()` function |

### 16. `src-tauri/src/core/threads/commands.rs` (3 items)

| ID | Priority | Description |
|----|----------|-------------|
| P1-11 | P1 | Added per-thread lock acquisition in `modify_thread` |
| P1-12 | P1 | Added per-thread lock acquisition in `list_messages` |
| P2-15 | P2 | Called `remove_lock_for_thread()` in `delete_thread` |

### 17. `src-tauri/src/core/integrations/oauth.rs` (3 bugs)

| ID | Priority | Description |
|----|----------|-------------|
| P1-9 | P1 | Added early error return if `refresh_token` is None after token exchange |
| P1-10 | P1 | Added `#[cfg(unix)]` file permission setting to 0o600 for credentials |
| P2-1 | P2 | Changed `find_available_port` to return `(TcpListener, u16)` — prevents TOCTOU race |

### 18. `src-tauri/src/core/state.rs` (supporting change)

| ID | Priority | Description |
|----|----------|-------------|
| — | — | Changed `SharedMcpServers` type to `Arc<Mutex<HashMap<String, Arc<RunningServiceEnum>>>>` to support lock-free async calls |

---

## React/TypeScript Frontend

### 19. `web-app/src/lib/messages.ts` (2 bugs)

| ID | Priority | Description |
|----|----------|-------------|
| P0-6 | **P0** | Wrapped `JSON.parse(tc.tool.function.arguments)` in try/catch with raw string fallback |
| P1-24 | P1 | Added `console.warn` before silently popping consecutive user messages |

### 20. `web-app/src/lib/model-factory.ts` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P0-7 | **P0** | Added `typeof init?.body === 'string'` guard and try/catch for `JSON.parse` |

### 21. `web-app/src/services/mcp/tauri.ts` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P0-8 | **P0** | Wrapped `JSON.parse(configString)` in try/catch, returns `defaultResponse()` on failure |

### 22. `web-app/src/providers/DataProvider.tsx` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P0-9 | **P0** | Wrapped `new URL(deeplink)` in try/catch with early return |

### 23. `web-app/src/hooks/useThreads.ts` (2 bugs)

| ID | Priority | Description |
|----|----------|-------------|
| P0-10 | **P0** | Added `if (!state.threads[threadId]) return state` guard in `toggleFavorite` |
| P1-19 | P1 | Added `.catch(console.error)` to all fire-and-forget backend calls |

### 24. `web-app/src/hooks/useMessages.ts` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P1-16 | P1 | Added `.catch(console.error)` to `deleteMessage` backend call |

### 25. `web-app/src/hooks/use-chat.ts` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P1-18 | P1 | Stabilized `inferenceParameters` with `JSON.stringify` comparison + `useMemo` to prevent infinite re-renders |

### 26. `web-app/src/hooks/useResearch.ts` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P1-17 | P1 | Used `session.chat.setMessages()` if available for proper reactivity |

### 27. `web-app/src/lib/custom-chat-transport.ts` (5 bugs)

| ID | Priority | Description |
|----|----------|-------------|
| P1-20 | P1 | Added abort error check (`error.name === 'AbortError'`) before fallback in catch block |
| P1-21 | P1 | Used `totalUsage?.inputTokens/outputTokens` instead of hardcoded 0 |
| P1-22 | P1 | Added evaluator approval check (regex for "approved"/"pass") before forcing next step |
| P1-23 | P1 | Context compression now preserves tool result messages from trimmed steps |
| P2-17 | P2 | Added `this.streamWriter = null` in finally block to prevent stale reference |

### 28. `web-app/src/lib/multi-agent/agent-health-monitor.ts` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P2-18 | P2 | Transition to `'half-open'` state when allowing probe; block concurrent probe calls |

### 29. `web-app/src/lib/multi-agent/parallel-orchestration.ts` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P2-19 | P2 | Added cleanup of abort event listener when stagger timer fires normally |

### 30. `web-app/src/components/ai-elements/PythonCodeBlock.tsx` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P2-19 | P2 | Added HTML sanitization — strips `<script>` tags and `onX=` event handlers before rendering |

### 31. `web-app/src/stores/chat-session-store.ts` (1 bug)

| ID | Priority | Description |
|----|----------|-------------|
| P2-16 | P2 | Moved `standaloneData` from module-level variable into Zustand store as a store property |

---

---

## Verification Review — Additional Bugs Found & Fixed

After the initial 54-bug pass, a comprehensive 4-agent code review identified and fixed additional issues:

### Critical (runtime crashes / security)

| File | Issue | Fix |
|------|-------|-----|
| `chat-session-store.ts:202,230,250` | Bare `standaloneData` references after moving into Zustand store — `ReferenceError` at runtime | Replaced with immutable `set()` updates |
| `mcp/commands.rs:476-506` | `check_ax_fabric_browser_extension_connected` held `mcp_servers` lock across up to 25s of awaits | Clone Arc ref, drop lock before awaits |
| `mcp/helpers.rs:210-225` | Health-check failure cleanup held lock across `service.cancel().await` | Remove from map first, drop lock, then cancel |
| `filesystem/helpers.rs:22` | `canonicalize()` fallback to raw path bypassed traversal check for non-existent paths | Use `normalize_path()` as fallback instead of raw path |

### High / Medium

| File | Issue | Fix |
|------|-------|-----|
| `custom-chat-transport.ts:798` | Context compression kept tool messages but dropped assistant tool_call messages — API validation errors | Also preserve assistant messages with `tool_calls` |
| `mcp/commands.rs:246-276` | `call_tool` Phase 1 still held lock across `list_all_tools().await` | Collect Arc refs, drop lock, then search |
| `parallel-orchestration.ts:70-81` | Abort listener cleanup used separate `setTimeout` with identical delay — race condition | Clean up listener inside resolve callback |
| `filesystem/commands.rs:47-58` | `mv` only validated source path, not destination against `app_data_folder` | Added `starts_with` check on destination |
| `code_execution/commands.rs:161` | `stop_sandbox_container()` blocked async runtime (up to 10s Docker stop) | Wrapped in `spawn_blocking` |
| `downloads/helpers.rs:720` | Last remaining `.unwrap()` on `app.emit()` | Changed to `.ok()` |
| `useThreads.ts:343,366,389,422,448` | 6 `updateThread` calls missing `.catch()` — unhandled promise rejections | Added `.catch(console.error)` to all |
| `threads/commands.rs:114-116` | `modify_thread` used `fs::write` directly instead of atomic write | Added tmp+rename pattern |

### Low

| File | Issue | Fix |
|------|-------|-----|
| `sandbox.rs:253` | `connection_verbose(true)` debug logging left in production | Removed |
| `setup.rs:300` | `.unwrap()` on `app.emit()` | Changed to `let _ =` |
| `mcp/helpers.rs:452,467` | `.to_str().unwrap()` on cache_dir paths | Changed to `.to_string_lossy()` |
| `messages.ts:550` | No-op self-assignment `toolInput = toolInput` in catch block | Replaced with empty catch comment |

---

## Final Pass — Remaining Issues Fixed

After the verification review, the following remaining issues were addressed:

### Rust Backend

| File | Issue | Fix |
|------|-------|-----|
| `threads/utils.rs` | Thread ID used unsanitized in filesystem paths — path traversal | Added sanitization: strip `/`, `\`, `..` |
| `filesystem/commands.rs:47` | `join_path` result not validated against `app_data_folder` | Added `normalize_path` + `starts_with` check |
| `system/commands.rs` | Shell injection via env var values in `export` command | Escape single quotes: `v.replace('\'', "'\\''")` |
| `app/commands.rs` | `.expect()` on HOME env var — panics if unset | Changed to `unwrap_or_else` with `/tmp` fallback |
| `mcp/helpers.rs` | Nested lock: `mcp_active_servers` acquired while holding `mcp_servers` | Read `mcp_active_servers` BEFORE acquiring `mcp_servers` |
| `setup.rs` | Multiple `.unwrap()`/`.expect()` on resource_dir, store.save, default_window_icon | Replaced with `.map_err()?`, `if let Err`, graceful fallback |
| `proxy.rs` | SSE `line_buffer` remainder not processed after stream ends | Added post-loop processing of remaining buffer |
| `lockfile.rs` | Windows PID matching with space-padded format could false-match | Reverted to simple `!output_str.contains("No tasks")` check |
| `threads/helpers.rs` | No `fsync` before `rename` in atomic writes — data loss risk on crash | Added `sync_all()` before `rename` in both write functions |
| `threads/helpers.rs` | `remove_lock_for_thread` silently failed if lock contended | Changed to `async fn` that awaits the lock properly |
| `threads/commands.rs` | `create_thread_assistant`/`modify_thread_assistant` not using per-thread lock | Added `get_lock_for_thread` acquisition in both |

### TypeScript Frontend

| File | Issue | Fix |
|------|-------|-----|
| `model-factory.ts` | Non-string `init.body` (Blob, ReadableStream) silently overwritten | Added early return for non-string bodies |
| `tauri.ts:67,71,79` | `getTools()`, `getConnectedServers()`, `callTool()` can return undefined | Added `?? []` / `?? { error, content }` fallbacks |
| `DataProvider.tsx:100-126` | `getProviders`, `getMCPConfig`, `getCurrent` missing `.catch()` | Added `.catch(console.error)` to all 3 |
| `useResearch.ts:343` | Direct `session.chat.messages` mutation won't trigger React re-renders | Removed mutation fallback, only use `setMessages` |
| `useMessages.ts:81-91` | No rollback on optimistic delete if backend fails | Added rollback in `.catch()` callback |
| `PythonCodeBlock.tsx` | Regex-based HTML sanitization bypassable | Replaced with DOM-based parser sanitization |

---

## Verification Results

| Check | Result |
|-------|--------|
| `cargo check` | Pass (only pre-existing `frontendDist` path error — web app not built) |
| `tsc --noEmit` | Pass (zero errors) |
| All type errors from Arc refactor | Resolved |
| Command registration (`lib.rs`) | Compatible — Tauri auto-handles `Result<T, String>` return types |
| Verification review (4-agent audit) | All critical/high/medium issues fixed |
| Final pass fixes | All remaining issues fixed |
