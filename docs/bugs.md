# Ax-Fabric Bug Report

**Date:** 2026-03-06
**Scope:** Comprehensive bug hunt across the entire Ax-Fabric codebase — Rust backend, React frontend, core package, extensions, services, multi-agent framework.
**Criteria:** Only actual bugs — code that will crash, produce wrong results, lose data, or behave incorrectly at runtime. Stubs, missing features, and tech debt are excluded (see `gap-analysis-report.md`).

---

## Table of Contents

1. [Summary](#summary)
2. [P0 — Crashes & Data Loss](#p0--crashes--data-loss)
3. [P1 — Wrong Behavior Visible to Users](#p1--wrong-behavior-visible-to-users)
4. [P2 — Edge Cases & Minor Issues](#p2--edge-cases--minor-issues)

---

## Summary

**Total bugs found: 54**

| Severity | Count | Description |
|----------|-------|-------------|
| **P0** | 10 | App crashes, data loss, security vulnerabilities |
| **P1** | 25 | Wrong behavior visible to users under normal usage |
| **P2** | 19 | Edge cases, cosmetic issues, minor resource leaks |

```
+----------------------------+------+------+------+-------+
| Area                       |  P0  |  P1  |  P2  | Total |
+----------------------------+------+------+------+-------+
| Rust Proxy (proxy.rs)      |  1   |  3   |  3   |   7   |
| Rust MCP                   |  -   |  5   |  2   |   7   |
| Rust Downloads             |  1   |  1   |  1   |   3   |
| Rust Sandbox               |  -   |  1   |  4   |   5   |
| Rust Threads/Persistence   |  1   |  3   |  1   |   5   |
| Rust Filesystem            |  2   |  2   |  -   |   4   |
| Rust OAuth/Integrations    |  -   |  2   |  1   |   3   |
| Rust System/Setup          |  -   |  -   |  3   |   3   |
| Rust App Commands          |  -   |  -   |  1   |   1   |
| Frontend: JSON.parse       |  3   |  -   |  -   |   3   |
| Frontend: State Management |  1   |  3   |  3   |   7   |
| Frontend: Chat Transport   |  -   |  3   |  1   |   4   |
| Frontend: Multi-Agent      |  -   |  2   |  3   |   5   |
| Frontend: Security (XSS)   |  -   |  -   |  2   |   2   |
+----------------------------+------+------+------+-------+
| TOTAL                      | 10   | 25   | 19   |  54   |
+----------------------------+------+------+------+-------+
```

---

## P0 — Crashes & Data Loss

These bugs will crash the application, destroy user data, or allow security exploitation.

---

### P0-1: Download Cancellation Deletes Entire Parent Directory (Data Loss)

**File:** `src-tauri/src/core/downloads/helpers.rs:672-676`

**Bug:** When a non-resumable download is cancelled, the code calls `remove_dir_all` on the **parent directory** of the save path. In a parallel multi-file download (e.g., a model with multiple shard files), cancelling one file deletes the entire parent directory — including sibling files that were already downloaded or are still being downloaded by other tasks.

```rust
if cancel_token.is_cancelled() {
    if !should_resume {
        tokio::fs::remove_dir_all(&save_path.parent().unwrap())  // deletes ENTIRE parent dir
            .await
            .ok();
    }
}
```

**Impact:** Cancelling one download in a multi-file set destroys all completed downloads in the same directory.

**Fix:** Only remove the specific `.tmp` file being downloaded:
```rust
tokio::fs::remove_file(&tmp_save_path).await.ok();
```

---

### P0-2: Path Traversal — `resolve_path` Accepts Arbitrary Absolute Paths

**File:** `src-tauri/src/core/filesystem/helpers.rs:6-23`

**Bug:** If the frontend passes an absolute path (e.g., `/etc/passwd`), it bypasses the `file:/` prefix sandboxing check and is used as-is. The commands `rm`, `read_file_sync`, `write_file_sync`, `mv`, `mkdir`, `readdir_sync`, and `exists_sync` all use `resolve_path`, meaning the frontend (or an XSS in the webview) can read, write, or delete ANY file on the system.

```rust
pub fn resolve_path<R: Runtime>(app_handle: tauri::AppHandle<R>, path: &str) -> PathBuf {
    let path = if path.starts_with("file:/") || path.starts_with("file:\\") {
        // ... sandboxed to app data folder ...
    } else {
        PathBuf::from(path)  // ANY absolute path passes through unsandboxed!
    };
    path.canonicalize().unwrap_or(path)
}
```

**Impact:** Full filesystem read/write/delete from the frontend. An XSS or malicious MCP tool could exploit this.

**Fix:** Add `starts_with(&app_data_folder)` check for all paths, or reject absolute paths that bypass the `file:/` prefix.

---

### P0-3: Zip-Slip Vulnerability in `.tar.gz` Decompression

**File:** `src-tauri/src/core/filesystem/commands.rs:223-226`

**Bug:** The `tar` crate's `unpack()` method does NOT sanitize entry paths by default. A malicious `.tar.gz` archive containing entries like `../../etc/cron.d/backdoor` can write files outside the output directory. The `.zip` path correctly uses `enclosed_name()` (line 233), but the `.tar.gz` path has no equivalent protection.

```rust
if path.ends_with(".tar.gz") {
    let tar = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(tar);
    archive.unpack(&output_dir_buf).map_err(|e| e.to_string())?;  // no path validation!
}
```

**Impact:** A malicious tar.gz archive (e.g., from a compromised model download) can write arbitrary files anywhere on the filesystem.

**Fix:** Iterate tar entries manually and validate each resolved path starts with `output_dir_buf`, similar to the `.zip` handler.

---

### P0-4: Non-Atomic File Writes — Crash Causes Data Loss

**File:** `src-tauri/src/core/threads/helpers.rs:34-44, 90`

**Bug:** `File::create` truncates the file to zero bytes *before* writing new content. If the process crashes between truncation and the final write, the file is left empty or partially written. On next launch, all messages for that thread are permanently lost.

```rust
pub fn write_messages_to_file(messages: &[serde_json::Value], path: &Path) -> Result<(), String> {
    let mut file = File::create(path).map_err(|e| e.to_string())?;  // truncates immediately!
    for msg in messages {
        let data = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        writeln!(file, "{data}").map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

Same pattern in `update_thread_metadata` (line 90) and `write_file_sync` / `write_yaml` in `filesystem/commands.rs:110-162`.

**Impact:** A crash, OOM kill, or power loss during any message save or thread update permanently destroys data.

**Fix:** Write to a temporary file (e.g., `messages.jsonl.tmp`), then `rename()` atomically. `rename()` is atomic on all major filesystems.

---

### P0-5: Global Proxy Timeout Kills Long-Running Streams

**File:** `src-tauri/src/core/server/proxy.rs:1630`

**Bug:** The `reqwest::Client` is built with a global `timeout()` that applies to the entire request lifetime, including streaming. For long AI responses that stream over many seconds/minutes, the timeout will fire and abort the connection mid-stream.

**Impact:** Long AI responses (e.g., multi-agent runs, detailed code generation) are silently truncated when the client timeout fires.

**Fix:** Remove the global timeout on the client (or set it very high), and use per-phase timeouts instead (connect timeout + idle timeout, not total timeout).

---

### P0-6: Unguarded `JSON.parse` in `messages.ts` — Thread Becomes Unloadable

**File:** `web-app/src/lib/messages.ts:546`

**Bug:** When converting stored tool calls back to UI messages, `JSON.parse(tc.tool.function.arguments)` has no try/catch. If any stored tool call has malformed or truncated JSON (from a save during mid-stream, or invalid API response), this throws an uncaught `SyntaxError`. Since this runs for every message when loading a thread, a single corrupted tool call prevents the entire thread from rendering.

```typescript
const toolInput =
  typeof tc.tool?.function?.arguments === 'string'
    ? JSON.parse(tc.tool.function.arguments)  // No try/catch — crashes on malformed JSON
    : tc.tool?.function?.arguments || tc.args
```

**Impact:** One corrupted message makes the entire conversation thread permanently unloadable in the UI.

**Fix:** Wrap in try/catch; fall back to the raw string or an empty object.

---

### P0-7: Unguarded `JSON.parse` in `model-factory.ts` — Inference Crashes

**File:** `web-app/src/lib/model-factory.ts:154`

**Bug:** `createCustomFetch` unconditionally calls `JSON.parse(init.body as string)` on POST requests. The `body` can be a `ReadableStream`, `Blob`, `ArrayBuffer`, or `FormData` — not just a string. If the AI SDK passes a streaming request body, this throws `SyntaxError`.

```typescript
if ((init?.method === 'POST' || !init?.method) && Object.keys(parameters).length > 0) {
  const body = init?.body ? JSON.parse(init.body as string) : {}  // Crashes if body is not JSON string
  init = { ...init, body: JSON.stringify({ ...body, ...parameters }) }
}
```

**Impact:** Crashes the inference request when inference parameters are set and the body is not a JSON string.

**Fix:** Guard with `typeof init?.body === 'string'` and wrap in try/catch.

---

### P0-8: Unguarded `JSON.parse` in MCP Config Parsing

**File:** `web-app/src/services/mcp/tauri.ts:34`

**Bug:** `getMCPConfig()` calls `JSON.parse(configString)` without a try/catch. If `mcp_config.json` is corrupted (partial write during crash, manual edit error), this throws an uncaught `SyntaxError`, breaking all MCP-related operations.

```typescript
const parsed = JSON.parse(configString) as MCPConfig & Record<string, unknown>  // No try/catch
```

**Impact:** A corrupted config file cascades into failures across all MCP and integration features.

**Fix:** Wrap in try/catch; return default config on parse failure.

---

### P0-9: `new URL(deeplink)` Crashes on Malformed Deep Links

**File:** `web-app/src/providers/DataProvider.tsx:247`

**Bug:** The deep link handler calls `new URL(deeplink)` without try/catch. Deep links come from the OS and can be arbitrary strings. A malformed URL throws `TypeError`.

```typescript
const handleDeepLink = (urls: string[] | null) => {
  if (!urls) return
  const deeplink = urls[0]
  if (deeplink) {
    const url = new URL(deeplink)  // Crashes on invalid URL string
  }
}
```

**Impact:** External input (OS deep links) can crash the application.

**Fix:** Wrap in try/catch; log and ignore malformed URLs.

---

### P0-10: Null-Unsafe `toggleFavorite` Crashes on Deleted Thread

**File:** `web-app/src/hooks/useThreads.ts:114-115`

**Bug:** `toggleFavorite` accesses `state.threads[threadId]` without checking if the thread exists. If the thread was concurrently deleted, `state.threads[threadId].isFavorite` throws `TypeError: Cannot read properties of undefined`.

```typescript
toggleFavorite: (threadId) => {
  set((state) => {
    getServiceHub().threads().updateThread({
      ...state.threads[threadId],                      // undefined if deleted
      isFavorite: !state.threads[threadId].isFavorite,  // TypeError!
    })
    // ...
  })
},
```

**Impact:** Race between delete and favorite toggle crashes the app.

**Fix:** Guard with `if (!state.threads[threadId]) return state`.

---

## P1 — Wrong Behavior Visible to Users

These bugs produce incorrect results, silent data inconsistency, or misleading behavior under normal usage.

---

### P1-1: Wrong JSON Key `"envs"` Instead of `"env"` in MCP Deactivation

**File:** `src-tauri/src/core/mcp/commands.rs:50`

**Bug:** When deactivating the Browser MCP server, the code looks up `"envs"` to find the BRIDGE_PORT for lock file cleanup. The actual config key is `"env"` (used everywhere else). Because `"envs"` never exists, `bridge_port` is always `None`, so the lock file is never cleaned up.

```rust
config.get("envs")   // BUG: should be "env"
    .and_then(|envs| envs.get("BRIDGE_PORT"))
```

**Impact:** Stale lock files accumulate on every Browser MCP deactivation.

**Fix:** Change `"envs"` to `"env"`.

---

### P1-2: Extension `"_active"` vs `"active"` Key Mismatch

**File:** `src-tauri/src/core/extensions/commands.rs:45`

**Bug:** `get_active_extensions` reads `ext["_active"]`, but `setup.rs:127` writes extensions with the key `"active"` (no underscore). Since `"_active"` never exists, every extension reports `active: null` to the frontend.

```rust
"active": ext["_active"],    // BUG: should be ext["active"]
```

**Impact:** All extensions always appear as inactive status to the frontend regardless of their actual state.

**Fix:** Change `ext["_active"]` to `ext["active"]`.

---

### P1-3: `call_tool` Holds Mutex Across Await — Blocks All MCP Operations

**File:** `src-tauri/src/core/mcp/commands.rs:237-305`

**Bug:** The `mcp_servers` mutex is locked on line 237 and held while awaiting `service.list_all_tools()` and `service.call_tool()`, which can take up to the full timeout duration. During this period, ALL other MCP operations (other tool calls, health checks, `get_tools`, `deactivate_mcp_server`) are blocked.

```rust
let servers = state.mcp_servers.lock().await;  // locked
// ... awaits tool listing and execution while locked ...
return result;  // lock released here
```

**Impact:** A 30-second tool call freezes the entire MCP subsystem for 30 seconds. Users cannot use other tools, and health monitoring stalls.

**Fix:** Clone/Arc the service reference, drop the lock, then await the tool call outside the lock.

---

### P1-4: `get_tools` Holds Mutex Across Multiple Awaits

**File:** `src-tauri/src/core/mcp/commands.rs:167-198`

**Bug:** Same issue as P1-3 — the lock is held while iterating through all servers and calling `service.list_all_tools().await` for each one. Total lock time = sum of all server query times.

**Impact:** During tool listing (called on every chat init), all other MCP operations are blocked.

**Fix:** Snapshot server handles into a local collection under the lock, release the lock, then query each server.

---

### P1-5: Health Monitor Holds Mutex During Network Health Check

**File:** `src-tauri/src/core/mcp/helpers.rs:182-205`

**Bug:** The health monitoring loop runs every 5 seconds and holds the global MCP servers lock during each health check (with a 2-second timeout). This creates a periodic blocking window for all MCP operations.

**Impact:** Periodic 2-second MCP subsystem freezes every 5 seconds during health monitoring.

**Fix:** Get the service reference under the lock, drop the lock, then perform the health check.

---

### P1-6: `max_tokens` Not Forwarded in Anthropic-to-OpenAI Transform

**File:** `src-tauri/src/core/server/proxy.rs:67-78`

**Bug:** The `max_tokens` field is deliberately commented out of the parameter passthrough list. This means every Anthropic-to-OpenAI translation silently drops the context window limit.

```rust
for key in &[
    // "max_tokens",   // <-- deliberately commented out
    "temperature",
    "top_p",
    // ...
```

**Impact:** Unbounded token usage or unexpected truncation at the upstream provider's default.

**Fix:** Restore `max_tokens` to the passthrough list.

---

### P1-7: SSE Chunks Split Across TCP Boundaries Drop Data

**File:** `src-tauri/src/core/server/proxy.rs:1720-1726`

**Bug:** The SSE parser splits on `\n\n` to find event boundaries, but TCP chunks can split an SSE event across two `Bytes` frames. If `data: {"content":"hello` arrives in one chunk and `"}` in the next, the parser fails to reconstruct the complete event and the partial data is silently dropped or produces a parse error.

**Impact:** Under network conditions that fragment TCP packets (common with proxies and VPNs), streaming responses lose tokens silently.

**Fix:** Buffer incoming data and only parse complete events (accumulate until `\n\n` boundary is found in the buffer).

---

### P1-8: `.unwrap()` on `app.emit()` Panics During Shutdown

**File:** `src-tauri/src/core/downloads/helpers.rs:130, 517, 543, 701, 720`

**Bug:** If the Tauri event system fails to emit (webview closed, app shutting down), `.unwrap()` panics and crashes the download task. This can leave partial `.tmp` files and an inconsistent download state.

```rust
app.emit(&evt_name, evt).unwrap();  // panics if webview is closed
```

**Impact:** App crash during shutdown while downloads are in progress.

**Fix:** Replace `.unwrap()` with `.ok()` or log the error.

---

### P1-9: OAuth Refresh Token Can Be `None` — MCP Fails After 1 Hour

**File:** `src-tauri/src/core/integrations/oauth.rs:258-279`

**Bug:** Google only returns a `refresh_token` on the first authorization. If the response omits it, the config file gets `"refresh_token": null`. The MCP server silently fails on all API calls after the access token expires (~1 hour).

**Impact:** Google Workspace integration silently breaks after 1 hour with no user-visible error or re-auth prompt.

**Fix:** Check that `refresh_token` is `Some` before writing config. If `None`, return an error prompting re-authorization.

---

### P1-10: Google Workspace Config Files World-Readable

**File:** `src-tauri/src/core/integrations/oauth.rs:283-346`

**Bug:** `std::fs::write` uses default permissions (0644 on Unix). `~/.google-mcp/credentials.json` and `tokens/default.json` containing `client_secret` and `refresh_token` are readable by any local user.

**Impact:** Any local user on a shared machine can steal OAuth credentials.

**Fix:** Set file permissions to 0600 using `std::os::unix::fs::PermissionsExt`.

---

### P1-11: Thread Metadata Operations Not Protected by Lock

**File:** `src-tauri/src/core/threads/commands.rs:91-113, 308-375`

**Bug:** While message operations use `get_lock_for_thread`, thread metadata operations (`modify_thread`, `create_thread_assistant`, `modify_thread_assistant`) have no locking. Two concurrent modifications to the same thread silently lose one change (last-writer-wins).

**Impact:** Concurrent thread updates (e.g., renaming while adding an assistant) silently drop one change.

**Fix:** Use the same per-thread lock for metadata operations.

---

### P1-12: `list_messages` Reads Without Lock — Torn Reads

**File:** `src-tauri/src/core/threads/commands.rs:137-148`

**Bug:** `list_messages` reads the messages file without acquiring the per-thread lock. If a concurrent write is rewriting the file, `list_messages` can read a partially written file, producing a JSON parse error or returning truncated data.

**Impact:** Under concurrent access, message listing can fail or return incomplete data.

**Fix:** Acquire the per-thread lock before reading, or use atomic writes (P0-4 fix) which makes reads consistent.

---

### P1-13: Non-Atomic Writes in `write_file_sync` and `write_yaml`

**File:** `src-tauri/src/core/filesystem/commands.rs:110-162`

**Bug:** Same non-atomic pattern as P0-4 — `fs::write` and `File::create` truncate before writing. A crash during write corrupts configuration/data YAML files.

**Impact:** Configuration file corruption on crash.

**Fix:** Write to temporary file, then `rename()` atomically.

---

### P1-14: Source Archive Path Not Validated in `decompress`

**File:** `src-tauri/src/core/filesystem/commands.rs:190-191`

**Bug:** The `output_dir` is validated to be under `app_data_folder`, but the source `path` is not. A `path` value of `../../etc/shadow` would be opened for reading, allowing information disclosure.

**Impact:** Frontend can probe for file existence outside the sandbox via error message differences.

**Fix:** Add `starts_with(&app_data_folder)` check for the source path.

---

### P1-15: Sandbox Container Runs with `seccomp=unconfined`

**File:** `src-tauri/src/core/code_execution/sandbox.rs:164-172`

**Bug:** The Docker container is started with `--security-opt seccomp=unconfined`, disabling syscall filtering. Combined with no `--cap-drop ALL`, `--network` restriction, or `--read-only`, the sandbox has broader privileges than necessary.

```rust
"--security-opt", "seccomp=unconfined",
```

**Impact:** Weakened sandbox isolation. Malicious Python code could potentially exploit syscall-based container escapes.

**Fix:** Remove `seccomp=unconfined`. Add `--cap-drop ALL` and consider `--network=none`.

---

### P1-16: `deleteMessage` Fire-and-Forget — Silent Data Divergence

**File:** `web-app/src/hooks/useMessages.ts:81-92`

**Bug:** `deleteMessage` calls the backend delete as fire-and-forget (no `await`, no `.catch()`). The UI immediately removes the message, but if the backend fails, the message reappears on next app restart.

```typescript
deleteMessage: (threadId, messageId) => {
  getServiceHub().messages().deleteMessage(threadId, messageId)  // No await, no .catch()
  set((state) => ({ /* removes from UI */ }))
},
```

**Impact:** Deleted messages silently reappear after app restart if the backend delete failed.

**Fix:** Add `.catch()` with rollback logic, consistent with `addMessage` and `updateMessage`.

---

### P1-17: Direct Mutation of AI SDK Chat Messages in Research

**File:** `web-app/src/hooks/useResearch.ts:335-341`

**Bug:** `saveMessageToChat` directly assigns to `session.chat.messages`, bypassing the AI SDK's internal state management. This doesn't trigger React re-renders, and desynchronizes the SDK's internal state.

```typescript
session.chat.messages = [...session.chat.messages, uiMsg]  // Direct mutation of SDK state
```

**Impact:** Research messages may not appear in the live chat; subsequent AI responses may not include research context.

**Fix:** Use the AI SDK's `chat.setMessages()` or `chat.append()` methods.

---

### P1-18: `inferenceParameters` useEffect Fires on Every Render

**File:** `web-app/src/hooks/use-chat.ts:84-88`

**Bug:** `inferenceParameters` defaults to `{}` (new object reference each render). The useEffect dependency `[inferenceParameters]` triggers on every render, calling `updateInferenceParameters` unnecessarily.

```typescript
const { inferenceParameters = {} } = options ?? {}  // New reference every render
useEffect(() => {
  transportRef.current.updateInferenceParameters(inferenceParameters)
}, [inferenceParameters])  // Always triggers
```

**Impact:** Unnecessary re-execution every render cycle. If `updateInferenceParameters` has side effects, this causes visible disruption.

**Fix:** Memoize the default: `useMemo(() => inferenceParameters ?? {}, [JSON.stringify(inferenceParameters)])`.

---

### P1-19: Systematic Fire-and-Forget Backend Calls Without Error Handling

**Files:** `web-app/src/hooks/useThreads.ts:111-116, 134, 169, 199, 258-261, 387, 420, 446`, `web-app/src/hooks/useAssistant.ts:84-89, 104-109`

**Bug:** Throughout thread and assistant stores, backend persistence calls (`updateThread`, `deleteThread`, `createAssistant`) are made inside Zustand's synchronous `set()` callbacks without `await` or `.catch()`. Any backend failure causes silent divergence between UI state and persistent storage.

**Impact:** Favorites, deletes, un-stars, assistant creates/updates all silently lose data if the backend call fails. Changes revert on app restart.

**Fix:** Move async calls outside `set()`, or add `.catch()` with rollback.

---

### P1-20: Multi-Agent Fallback Catches Abort Errors

**File:** `web-app/src/lib/custom-chat-transport.ts:877-906`

**Bug:** Any error during multi-agent setup (including user-initiated abort via `AbortSignal`) triggers a silent fallback to single-agent mode. If the user cancels a multi-agent run, the message still gets sent as a single-agent request.

```typescript
} catch (error) {
    // Falls back to single-agent for ALL errors, including AbortError
    this.activeTeamId = undefined
    return await this.sendMessages(options)  // sends message anyway
}
```

**Impact:** User cancels multi-agent run but the message is sent as single-agent. Transient errors bypass the team entirely.

**Fix:** Check for `isAbortError(error)` and re-throw instead of falling back.

---

### P1-21: Zero Input/Output Tokens Reported for Multi-Agent Runs

**File:** `web-app/src/lib/custom-chat-transport.ts:843-853`

**Bug:** The `onTokenUsage` callback always reports `inputTokens: 0` and `outputTokens: 0` for multi-agent runs, with only `totalTokens` populated.

```typescript
this.onTokenUsage({
    inputTokens: 0,         // Always 0
    outputTokens: 0,        // Always 0
    totalTokens: usage.consumed,
}, options.messageId ?? '')
```

**Impact:** Cost tracking and token usage analytics are incorrect for multi-agent runs (input tokens are cheaper than output).

**Fix:** Track input and output tokens separately in `MultiAgentRunLog`.

---

### P1-22: Evaluator-Optimizer Cannot Break Early After Approval

**File:** `web-app/src/lib/custom-chat-transport.ts:746-759`

**Bug:** In evaluator-optimizer mode, `stepToolChoice` forces the next delegation regardless of the evaluator's response. Even if the evaluator says "APPROVED", the orchestrator is forced to keep calling agents until `maxIterations * 2` delegations are made.

**Impact:** Evaluator-optimizer mode wastes tokens by continuing iterations after the evaluator approves. Can double the token cost.

**Fix:** After the evaluator returns, check if its output signals approval and stop forcing `stepToolChoice`.

---

### P1-23: Context Compression Drops Early Agent Results

**File:** `web-app/src/lib/custom-chat-transport.ts:785-790`

**Bug:** In multi-agent runs with more than 12 steps, context compression keeps only the first step and the last 8, dropping intermediate agent delegation outputs.

```typescript
if (steps && steps.length > 12) {
    result.messages = [
        ...steps[0].messages,
        ...steps.slice(-8).flatMap((s) => s.messages),  // steps 1 to length-9 are dropped
    ]
}
```

**Impact:** In long multi-agent runs, early agent results are silently dropped from context, leading to incoherent final output or repeated work.

**Fix:** Keep tool results from all delegation steps (they contain agent outputs) while trimming verbose intermediate reasoning.

---

### P1-24: `CompletionMessagesBuilder.addUserMessage` Silently Drops Previous User Message

**File:** `web-app/src/lib/messages.ts:275-279`

**Bug:** When consecutive user messages are detected, the previous one is silently popped and discarded.

```typescript
if (this.messages[this.messages.length - 1]?.role === 'user') {
    this.messages.pop()  // Silently drops the previous user message
}
```

**Impact:** User context silently lost when messages are edited or assistant responses are deleted, potentially causing incoherent AI responses.

**Fix:** Merge consecutive user messages or insert a placeholder assistant message between them.

---

### P1-25: `list_all_tools()` Called Without Timeout Inside `call_tool`

**File:** `src-tauri/src/core/mcp/commands.rs:255`

**Bug:** Inside `call_tool`, the code iterates through servers and calls `service.list_all_tools().await` to find which server has the requested tool. This call has no timeout. If an MCP server hangs during tool listing, the entire `call_tool` operation hangs indefinitely (the timeout only applies to the actual tool call, not the discovery phase).

**Impact:** A hung MCP server blocks all tool calls indefinitely, not just calls to that specific server.

**Fix:** Apply a timeout to `list_all_tools()` calls during tool discovery, or cache tool-to-server mappings.

---

## P2 — Edge Cases & Minor Issues

These bugs occur under specific conditions and have limited impact.

---

### P2-1: TOCTOU Race Condition in OAuth Port Binding

**File:** `src-tauri/src/core/integrations/oauth.rs:350-358`

**Bug:** `find_available_port()` binds a TCP listener, drops it, then returns the port for later use. Between the drop and the re-bind, another process can claim the port.

**Impact:** Intermittent OAuth flow failure on busy systems.

**Fix:** Keep the listener alive and convert to the hyper server directly, or use port 0.

---

### P2-2: `open_app_directory` / `open_file_explorer` Panic on Failure

**File:** `src-tauri/src/core/system/commands.rs:112-152`

**Bug:** Both Tauri commands use `.expect()` and `.unwrap()` on fallible operations. If the system binary (`open`/`explorer`/`xdg-open`) is missing, the app crashes.

**Impact:** App crash on minimal Linux environments or sandboxed systems.

**Fix:** Return `Result<(), String>` and propagate errors.

---

### P2-3: Tray Menu "Open" Handler Panics if Window Doesn't Exist

**File:** `src-tauri/src/core/setup.rs:334-336`

**Bug:** `app.get_webview_window("main").unwrap()` panics if the main window was destroyed but the app is still running in the tray.

```rust
"open" => {
    let window = app.get_webview_window("main").unwrap();  // panic!
    window.show().unwrap();
    window.set_focus().unwrap();
}
```

**Impact:** App crash when clicking "Open" in tray after window destruction.

**Fix:** Use `if let Some(window) = ...` pattern.

---

### P2-4: `default_data_folder_path` Panics When `product_name` Is `None`

**File:** `src-tauri/src/core/app/commands.rs:143-147`

**Bug:** `app_handle.config().product_name.clone().unwrap()` panics if `product_name` is not in `tauri.conf.json` and `APP_NAME` env var is unset.

**Impact:** App crash if configuration is incomplete.

**Fix:** Return `Result<String, String>` and use `.ok_or()`.

---

### P2-5: Non-UTF-8 App Data Path Causes Panic

**File:** `src-tauri/src/core/mcp/helpers.rs:66`

**Bug:** `app_path.to_str().unwrap()` panics if the path contains non-UTF-8 characters (possible on Windows with certain locale-specific usernames).

**Impact:** App crash for users with non-ASCII usernames on Windows.

**Fix:** Use `app_path.to_string_lossy()`.

---

### P2-6: Token Count Estimated by Word Count — Inaccurate

**File:** `src-tauri/src/core/server/proxy.rs:1752, 1960`

**Bug:** Token counts are estimated by splitting on whitespace and counting words, which is wildly inaccurate for non-English text, code, and tokenizer-specific behavior (typically off by 2-4x).

**Impact:** Misleading token usage and cost estimates in the UI.

**Fix:** Use a proper tokenizer (e.g., tiktoken) or forward token counts from the API response.

---

### P2-7: Fallback Client Built with No Settings — Uses `.expect()`

**File:** `src-tauri/src/core/server/proxy.rs:1370-1372`

**Bug:** When building a fallback reqwest client, `.expect("Failed to create fallback client")` panics if client construction fails (e.g., TLS initialization failure).

**Impact:** App crash if TLS cannot initialize in the fallback path.

**Fix:** Replace with `map_err` and return an error response.

---

### P2-8: API Key Sent as `x-api-key` to All Providers

**File:** `src-tauri/src/core/server/proxy.rs:1300`

**Bug:** The proxy sends the API key as `x-api-key` header to all providers. Some providers expect `Authorization: Bearer <key>` instead. While major providers accept both, custom OpenAI-compatible endpoints may reject `x-api-key`.

**Impact:** Authentication failures with some custom OpenAI-compatible endpoints.

**Fix:** Use provider-specific header names based on the registered provider configuration.

---

### P2-9: Windows PID Check Uses Substring Matching

**File:** `src-tauri/src/core/mcp/lockfile.rs:100-107`

**Bug:** The Windows `is_process_alive` implementation checks if the PID string appears anywhere in `tasklist` output. PID `123` can false-positive match a line about PID `12345`.

```rust
output_str.contains(&pid.to_string())  // substring match!
```

**Impact:** Stale MCP lock files may not be cleaned up on Windows due to false-positive PID matches.

**Fix:** Parse `tasklist` output by fields, matching PID as a whole number.

---

### P2-10: `is_sandbox_ready` Only Checks TCP Port, Not API Readiness

**File:** `src-tauri/src/core/code_execution/sandbox.rs:114-141`

**Bug:** Readiness check only verifies TCP connection succeeds. Docker port forwarding can be active before the Jupyter API inside the container is ready, causing premature `Ok(())` return and subsequent API failures.

**Impact:** Race condition on container startup; first code execution after start may fail.

**Fix:** Make an HTTP request to the health endpoint instead of just TCP connect.

---

### P2-11: Sandbox Port 8080 Hardcoded — No Collision Detection

**File:** `src-tauri/src/core/code_execution/sandbox.rs:170`

**Bug:** The sandbox always maps to host port 8080. If another service is using port 8080, `docker run` fails. The `update_sandbox_url` command exists but `start_sandbox_container` ignores it.

**Impact:** Sandbox cannot start if port 8080 is occupied.

**Fix:** Read the port from `sandbox_url` state or detect port conflicts.

---

### P2-12: `stop_sandbox_container` Doesn't Clear Session Map

**File:** `src-tauri/src/core/code_execution/sandbox.rs:193-202`

**Bug:** `stop_sandbox` removes the Docker container but doesn't clear `sandbox_sessions`. On restart, stale session IDs are sent to the new container.

**Impact:** First code execution after sandbox restart may fail due to stale session ID.

**Fix:** Clear `sandbox_sessions` in the stop command.

---

### P2-13: `strip_ansi` Misses OSC and Single-Character Escape Sequences

**File:** `src-tauri/src/core/code_execution/sandbox.rs:338-355`

**Bug:** The ANSI stripper only handles CSI sequences (`\x1b[...`). OSC sequences, character set selections, and other escape types leave garbled characters in Python error tracebacks.

**Impact:** Garbled characters in code execution error output.

**Fix:** Use the `strip-ansi-escapes` crate or a comprehensive regex.

---

### P2-14: Sync `fs::remove_file` in Async Context — Leftover Temp Files

**File:** `src-tauri/src/core/downloads/commands.rs:51`

**Bug:** Uses synchronous `std::fs::remove_file` in an async context (blocks Tokio runtime). Also only deletes the final path, not `.tmp` and `.url` auxiliary files.

**Impact:** Minor Tokio blocking; leftover temp files accumulate.

**Fix:** Use `tokio::fs::remove_file`; also clean up `.tmp` and `.url` files.

---

### P2-15: Memory Leak in Per-Thread Lock Map

**File:** `src-tauri/src/core/threads/helpers.rs:14-31`

**Bug:** Locks are inserted into the global `MESSAGE_LOCKS` map but never removed, even after `delete_thread`. Over many thread create/delete cycles, this grows unboundedly.

**Impact:** Slow memory leak proportional to total threads created during a session.

**Fix:** Remove entries from `MESSAGE_LOCKS` in `delete_thread`.

---

### P2-16: `standaloneData` Outside Zustand Reactivity

**File:** `web-app/src/stores/chat-session-store.ts:58, 99-100, 127-130`

**Bug:** `standaloneData` is a plain object outside the Zustand store. Mutations to it don't trigger React re-renders. Components calling `getSessionData()` before a Chat is created see stale UI until `ensureSession` is called.

**Impact:** Stale UI during the window between `getSessionData()` and `ensureSession()`.

**Fix:** Store standalone data inside the Zustand store itself.

---

### P2-17: `streamWriter` Not Cleared After Multi-Agent Stream

**File:** `web-app/src/lib/custom-chat-transport.ts:808-809`

**Bug:** `this.streamWriter` remains set after the stream completes. Late-firing callbacks may write to a closed stream.

**Impact:** Potential errors from writing to a closed stream writer.

**Fix:** Set `this.streamWriter = null` in a `finally` block.

---

### P2-18: Circuit Breaker Allows All Probes in Parallel

**File:** `web-app/src/lib/multi-agent/agent-health-monitor.ts:17-24`

**Bug:** When the reset timeout expires, all parallel agents simultaneously see `Date.now() - lastFailure > RESET_TIMEOUT_MS` as true and all pass through. The circuit breaker should only allow one probe.

**Impact:** Circuit breaker provides no protection during parallel execution.

**Fix:** Transition to `'half-open'` state when allowing the probe.

---

### P2-19: `dangerouslySetInnerHTML` with Python Execution Output

**File:** `web-app/src/components/ai-elements/PythonCodeBlock.tsx:82`

**Bug:** Python code execution output is rendered directly as HTML. The AI model could generate Python that outputs HTML with `<script>` tags. In a Tauri desktop app, injected scripts run with webview privileges.

```typescript
dangerouslySetInnerHTML={{ __html: o.data }}
```

**Impact:** XSS via AI-generated Python code output (requires specific attack chain).

**Fix:** Sanitize HTML output with DOMPurify before rendering.

---

## Appendix: Files With Most Bugs

| File | Bug Count | Severities |
|------|-----------|------------|
| `src-tauri/src/core/server/proxy.rs` | 7 | 1 P0, 3 P1, 3 P2 |
| `src-tauri/src/core/mcp/commands.rs` | 5 | 3 P1, 1 P1, 1 P2 |
| `web-app/src/lib/custom-chat-transport.ts` | 5 | 2 P1, 1 P1, 1 P1, 1 P2 |
| `src-tauri/src/core/threads/` | 5 | 1 P0, 3 P1, 1 P2 |
| `src-tauri/src/core/code_execution/sandbox.rs` | 5 | 1 P1, 4 P2 |
| `src-tauri/src/core/filesystem/` | 4 | 2 P0, 2 P1 |
| `web-app/src/hooks/useThreads.ts` | 3 | 1 P0, 2 P1 |
| `src-tauri/src/core/integrations/oauth.rs` | 3 | 2 P1, 1 P2 |

---

## Recommended Fix Order

### Immediate (P0 — before any release)
1. **P0-2, P0-3:** Fix path traversal and zip-slip security vulnerabilities
2. **P0-1:** Fix download cancellation directory deletion
3. **P0-4:** Implement atomic file writes for thread persistence
4. **P0-5:** Fix global proxy timeout killing streams
5. **P0-6, P0-7, P0-8:** Add try/catch around all `JSON.parse` calls
6. **P0-9, P0-10:** Guard against null/malformed external input

### Next Sprint (P1 — user-facing issues)
7. **P1-1, P1-2:** Fix typo-level key mismatches (`"envs"` → `"env"`, `"_active"` → `"active"`)
8. **P1-3, P1-4, P1-5:** Fix mutex-held-across-await in MCP operations
9. **P1-6:** Restore `max_tokens` passthrough
10. **P1-9, P1-10:** Fix OAuth token handling and file permissions
11. **P1-16 through P1-19:** Fix fire-and-forget backend calls in stores
12. **P1-20 through P1-23:** Fix multi-agent orchestration bugs

### Backlog (P2 — edge cases)
13. All P2 items, prioritized by area of most user traffic

---

*Report generated by comprehensive codebase bug hunt on 2026-03-06.*
