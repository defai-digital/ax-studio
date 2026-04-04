# PRD: Rust Tauri Backend Refactor for Testability and Reliability

**Version**: 1.0
**Date**: 2026-04-04
**Status**: Draft
**Author**: Engineering

---

## 1. Overview

### 1.1 Problem Statement

The Rust Tauri backend (`src-tauri/`) is the primary source of production bugs in AX Studio. A deep code review reveals systemic issues that make the backend fragile, hard to test, and difficult to debug:

- **282 `.unwrap()` calls** in core source code — each is a potential app crash
- **117 `.unwrap()` calls** in plugins — separate crash vectors
- **Zero custom error types** across 85 Tauri commands (all return `Result<T, String>`)
- **6 of 12 modules have no tests at all** (app, code_execution, extensions, integrations, research, updater)
- **No service layer** — business logic is embedded directly in command handlers, making it untestable without a running Tauri app
- **God-object AppState** with 13 `Arc<Mutex<>>` fields passed to every command
- **684-line setup.rs** monolith handling extension installation, store migration, tray icons, MCP bootstrap, and window lifecycle

### 1.2 Objective

Refactor the Rust backend to:
1. Eliminate crash-prone `.unwrap()` calls in production code
2. Introduce a proper error type hierarchy that propagates context to the frontend
3. Separate business logic from Tauri command handlers to enable unit testing
4. Decompose the monolithic `AppState` into focused service structs
5. Achieve meaningful test coverage for all modules

### 1.3 Design Philosophy

- **No runtime behavior changes** — this is a structural refactor, not a feature change
- **Incremental migration** — one module at a time, each PR is self-contained
- **Service layer pattern** — command handlers become thin wrappers that delegate to testable service functions
- **Error types replace strings** — structured errors that carry context through the stack
- **Test what matters** — prioritize business logic and error paths over trivial accessors

### 1.4 Success Criteria

- Zero `.unwrap()` calls in production code paths (test code is acceptable)
- All Tauri commands return `Result<T, AppError>` instead of `Result<T, String>`
- Every module has unit tests for its service layer
- `AppState` is decomposed into ≤5 focused state structs
- `setup.rs` is broken into discrete initialization functions under 100 lines each
- All tests pass with `cargo test --features test-tauri`

---

## 2. Current State Analysis

### 2.1 Module Inventory

| Module | Lines | Has Tests | Severity |
|--------|-------|-----------|----------|
| `server/` | 3,715 | Yes (298 lines) | HIGH — proxy.rs has 30+ unwraps in security-critical code |
| `mcp/` | 2,516 | Yes (368 lines) | HIGH — lockfile.rs has 5 expects, helpers.rs is 1,248 lines |
| `downloads/` | 1,808 | Yes (375 lines) | MEDIUM — helpers.rs is 1,139 lines |
| `threads/` | 1,589 | Yes (506 lines) | MEDIUM — two persistence backends (JSONL + SQLite) |
| `filesystem/` | 1,275 | Yes (partial) | HIGH — 1,009 lines in commands.rs, business logic in handlers |
| `integrations/` | 1,000 | **No** | HIGH — OAuth flows untested, 541-line oauth.rs |
| `setup.rs` | 684 | **No** | HIGH — monolithic, extension install + store migration + MCP bootstrap |
| `updater/` | 590 | **No** | MEDIUM — only module with proper `thiserror` error type |
| `app/` | 451 | **No** | LOW — mostly config reads |
| `code_execution/` | 394 | **No** | HIGH — sandbox security untested, has `panic!` macro |
| `system/` | 373 | **No** | LOW — thin OS wrappers |
| `research/` | 296 | **No** | LOW — single scraper function |
| `agent_teams.rs` | 179 | Inline | LOW — CRUD with inline tests |
| `agent_run_logs.rs` | 215 | Inline | LOW — CRUD with inline tests |
| `extensions/` | 64 | **No** | LOW — very small |

**Plugins:**

| Plugin | Lines | Severity |
|--------|-------|----------|
| `tauri-plugin-llamacpp` | 4,124 | CRITICAL — 100+ unwraps, 1,323-line backend.rs |
| `tauri-plugin-hardware` | 1,917 | MEDIUM — vendor detection, has tests |

### 2.2 Error Handling Debt

| Category | Count | Impact |
|----------|-------|--------|
| `.unwrap()` in core src | 282 | App crash on any unexpected state |
| `.unwrap()` in plugins | 117 | Plugin crash cascades to app |
| `.expect()` calls | 35 | Documented crash points |
| `panic!` macros | 1 | Guaranteed crash in code_execution |
| `.map_err(\|e\| e.to_string())` | 273 | All error context lost |
| `Result<T, String>` commands | 85/85 | Frontend cannot distinguish error types |

### 2.3 Architectural Issues

**2.3.1 God-Object AppState**

`AppState` is a single struct with 13 `Arc<Mutex<>>` fields passed to every command via `State<'_, AppState>`. This means:
- Every command has access to every piece of state (no encapsulation)
- State fields for unrelated features are coupled (MCP servers, downloads, provider configs all in one struct)
- Testing any command requires constructing the entire AppState
- Deadlock risk increases with more shared mutexes

```rust
// Current: 13 fields, all Arc<Mutex<>>
pub struct AppState {
    pub app_token: Option<String>,
    pub mcp_servers: SharedMcpServers,
    pub download_manager: Arc<Mutex<DownloadManagerState>>,
    pub mcp_active_servers: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    pub server_handle: Arc<Mutex<Option<ServerHandle>>>,
    pub tool_call_cancellations: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
    pub mcp_settings: Arc<Mutex<McpSettings>>,
    pub mcp_shutdown_in_progress: Arc<Mutex<bool>>,
    pub mcp_monitoring_tasks: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    pub background_cleanup_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub mcp_server_pids: Arc<Mutex<HashMap<String, u32>>>,
    pub provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    pub approved_save_paths: Arc<Mutex<HashSet<PathBuf>>>,
}
```

**2.3.2 No Service Layer**

Command handlers contain business logic directly. Example from `mcp/commands.rs`:
```rust
#[tauri::command]
pub async fn deactivate_mcp_server(...) -> Result<(), String> {
    // 40 lines of business logic: lock acquisition, server lookup,
    // Arc unwrapping, cancellation, cleanup, lockfile update
}
```

This means business logic cannot be tested without a running Tauri app, `State<'_>` injection, and `AppHandle<R>`.

**2.3.3 Duplicated Command Handler Macros**

`commands/mod.rs` has two nearly identical macros — `desktop_handlers!` and `mobile_handlers!` — each listing all ~85 commands. Only the updater commands differ. Any new command must be added to both macros.

**2.3.4 Monolithic setup.rs (684 lines)**

A single file handling:
- Extension installation and extraction (lines 26-150)
- Store migration across versions (lines 151-350)
- MCP server bootstrap (lines 350-450)
- System tray setup (lines 450-550)
- Window lifecycle management (lines 550-684)

None of this is tested.

**2.3.5 Inconsistent Module Structure**

- `agent_teams.rs` and `agent_run_logs.rs` are standalone files instead of module directories
- Some modules have `helpers.rs` (mcp, downloads, threads, filesystem), others put everything in `commands.rs`
- No standard service/repository pattern

**2.3.6 Large Files Without Decomposition**

| File | Lines | Issue |
|------|-------|-------|
| `mcp/helpers.rs` | 1,248 | MCP server lifecycle, health monitoring, config management all in one file |
| `downloads/helpers.rs` | 1,139 | Download orchestration, progress tracking, file extraction combined |
| `server/provider_adapter.rs` | 1,105 | Provider routing for every AI provider in one file |
| `filesystem/commands.rs` | 1,009 | 20 command handlers with inline business logic |
| `server/model_routes.rs` | 798 | Model endpoint routing and request transformation |
| `setup.rs` | 684 | App initialization monolith |
| `server/proxy.rs` | 662 | HTTP proxy with 30+ unwraps in security-critical paths |

---

## 3. Proposed Changes

### 3.1 Phase 1: Introduce AppError Type (Foundation)

Create a unified error type hierarchy using `thiserror`:

```rust
// src-tauri/src/core/error.rs

use thiserror::Error;

#[derive(Debug, Error, serde::Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("File system error: {0}")]
    FileSystem(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("MCP error: {0}")]
    Mcp(String),

    #[error("Server error: {0}")]
    Server(String),

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

// Enable automatic conversion from common error types
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::FileSystem(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Serialization(e.to_string())
    }
}

// Tauri requires IntoResponse for command errors
impl serde::Serialize for AppError { ... }
```

**Migration strategy**: Add `AppError` alongside existing `String` errors. Migrate one module at a time. Both patterns coexist during transition.

### 3.2 Phase 2: Eliminate unwrap() in Critical Paths

Prioritized by crash risk:

| Priority | File | unwrap count | Fix |
|----------|------|-------------|-----|
| P0 | `server/proxy.rs` | 30+ | Replace with `?` operator + `AppError` |
| P0 | `setup.rs` | 4 + 2 expect | Replace with `?` + proper error propagation |
| P0 | `code_execution/commands.rs` | 1 panic! | Replace with `Err(AppError::Internal(...))` |
| P1 | `filesystem/models.rs` | 7 | Replace JSON unwraps with `?` |
| P1 | `mcp/lockfile.rs` | 3 + 5 expect | Replace with `?` + `AppError::Configuration` |
| P1 | `integrations/oauth.rs` | 4 | Replace with `?` + `AppError::Network` |
| P2 | Remaining core files | ~230 | Systematic sweep |
| P3 | Plugin code | 117 | Separate effort per plugin |

### 3.3 Phase 3: Decompose AppState

Split the monolithic `AppState` into focused state structs, each managed separately by Tauri:

```rust
// MCP-specific state
pub struct McpState {
    pub servers: SharedMcpServers,
    pub active_servers: Arc<Mutex<HashMap<String, Value>>>,
    pub settings: Arc<Mutex<McpSettings>>,
    pub shutdown_in_progress: Arc<Mutex<bool>>,
    pub monitoring_tasks: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    pub server_pids: Arc<Mutex<HashMap<String, u32>>>,
}

// Download-specific state
pub struct DownloadState {
    pub manager: Arc<Mutex<DownloadManagerState>>,
}

// Server-specific state
pub struct ServerState {
    pub handle: Arc<Mutex<Option<ServerHandle>>>,
    pub provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
}

// Shared app state (minimal)
pub struct AppState {
    pub app_token: Option<String>,
    pub tool_call_cancellations: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
    pub background_cleanup_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub approved_save_paths: Arc<Mutex<HashSet<PathBuf>>>,
}
```

Commands then request only the state they need:
```rust
#[tauri::command]
pub async fn activate_mcp_server(
    state: State<'_, McpState>,  // Only MCP state, not everything
    name: String,
    config: Value,
) -> Result<(), AppError> { ... }
```

### 3.4 Phase 4: Extract Service Layer

For each module, separate the command handler (thin Tauri wrapper) from testable business logic:

**Before** (current pattern):
```rust
// mcp/commands.rs — business logic embedded in command handler
#[tauri::command]
pub async fn deactivate_mcp_server<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    name: String,
) -> Result<(), String> {
    // 40 lines of lock management, server lookup, cancellation, cleanup...
}
```

**After** (service layer pattern):
```rust
// mcp/service.rs — testable business logic, no Tauri dependency
pub async fn deactivate_server(
    state: &McpState,
    name: &str,
) -> Result<(), AppError> {
    // Business logic here — testable with plain Rust
}

// mcp/commands.rs — thin wrapper
#[tauri::command]
pub async fn deactivate_mcp_server(
    state: State<'_, McpState>,
    name: String,
) -> Result<(), AppError> {
    service::deactivate_server(&state, &name).await
}
```

**Module migration order** (by risk and complexity):

| Order | Module | Rationale |
|-------|--------|-----------|
| 1 | `filesystem/` | Most commands, clearest service boundary |
| 2 | `mcp/` | Largest module, highest bug count |
| 3 | `threads/` | Two persistence backends need abstraction |
| 4 | `server/` | Most complex, decompose proxy + provider adapter |
| 5 | `downloads/` | Large helpers need splitting |
| 6 | `integrations/` | OAuth flows need isolation for testing |
| 7 | `code_execution/` | Sandbox logic needs safety review |
| 8 | `app/`, `system/`, `research/`, `extensions/` | Smaller modules, batch together |

### 3.5 Phase 5: Break Up setup.rs

Decompose the 684-line monolith into focused initialization modules:

```
core/
├── setup/
│   ├── mod.rs              # pub fn app_setup() orchestrator (<50 lines)
│   ├── extensions.rs       # install_extensions(), extract_extension_manifest()
│   ├── store_migration.rs  # migrate_store(), version-specific migrations
│   ├── mcp_bootstrap.rs    # initialize_mcp_servers()
│   ├── tray.rs             # setup_system_tray() (desktop only)
│   └── lifecycle.rs        # app_run_handler(), window event handlers
```

### 3.6 Phase 6: Decompose Large Files

| File | Lines | Split into |
|------|-------|-----------|
| `mcp/helpers.rs` | 1,248 | `mcp/lifecycle.rs` (start/stop/restart), `mcp/health.rs` (monitoring), `mcp/config.rs` (config management) |
| `downloads/helpers.rs` | 1,139 | `downloads/orchestrator.rs` (download flow), `downloads/progress.rs` (tracking), `downloads/extraction.rs` (file extraction) |
| `server/provider_adapter.rs` | 1,105 | `server/adapters/openai.rs`, `server/adapters/anthropic.rs`, etc. |
| `filesystem/commands.rs` | 1,009 | `filesystem/service.rs` (logic), `filesystem/commands.rs` (thin handlers) |

### 3.7 Phase 7: Standardize Module Structure

Every module should follow:
```
core/<module>/
├── mod.rs          # Module declarations
├── commands.rs     # Thin #[tauri::command] wrappers
├── service.rs      # Business logic (testable, no Tauri dependency)
├── models.rs       # Data structures
├── error.rs        # Module-specific error variants (optional)
├── tests.rs        # Unit tests for service.rs
└── helpers.rs      # Internal utilities (if needed)
```

Promote standalone files to module directories:
- `agent_teams.rs` → `agent_teams/mod.rs` + `agent_teams/service.rs` + `agent_teams/commands.rs`
- `agent_run_logs.rs` → `agent_run_logs/mod.rs` + `agent_run_logs/service.rs` + `agent_run_logs/commands.rs`

### 3.8 Phase 8: Unify Command Handler Registration

Replace the duplicated `desktop_handlers!` / `mobile_handlers!` macros with a single macro that conditionally includes platform-specific commands:

```rust
macro_rules! common_handlers {
    () => {
        tauri::generate_handler![
            // All shared commands...
        ]
    };
}

// In lib.rs:
#[cfg(desktop)]
let handlers = tauri::generate_handler![
    /* common commands + updater commands */
];

#[cfg(mobile)]
let handlers = tauri::generate_handler![
    /* common commands only */
];
```

### 3.9 Phase 9: Add Test Infrastructure

**Unit test helpers:**
```rust
// core/test_utils.rs
pub fn mock_mcp_state() -> McpState { ... }
pub fn mock_download_state() -> DownloadState { ... }
pub fn temp_data_dir() -> tempfile::TempDir { ... }
```

**Test coverage targets by module:**

| Module | Current | Target | Focus |
|--------|---------|--------|-------|
| `filesystem/` | Partial | 80% | Path validation, error handling |
| `mcp/` | Partial | 70% | Server lifecycle, config management |
| `threads/` | Partial | 70% | CRUD operations, message persistence |
| `server/` | Partial | 60% | Proxy routing, auth, CORS |
| `downloads/` | Partial | 60% | Progress tracking, cancellation |
| `integrations/` | **0%** | 50% | OAuth flow, token management |
| `code_execution/` | **0%** | 70% | Sandbox security, input validation |
| `setup/` | **0%** | 50% | Extension install, store migration |
| `updater/` | **0%** | 50% | Update check, HMAC validation |
| `app/` | **0%** | 40% | Config read/write |

---

## 4. Migration Plan

### 4.1 Ordering & Dependencies

```
Phase 1: AppError type          ─── Foundation, no breaking changes
    │
Phase 2: Eliminate unwrap()     ─── Uses AppError, reduces crashes immediately
    │
Phase 3: Decompose AppState    ─── Enables isolated testing
    │
Phase 4: Extract service layer ─── Core testability improvement
    │
Phase 5: Break up setup.rs     ─── Independent, can parallel with Phase 4
    │
Phase 6: Decompose large files ─── Independent, can parallel with Phase 4-5
    │
Phase 7: Standardize structure ─── After service extraction is complete
    │
Phase 8: Unify command macros   ─── Small, independent
    │
Phase 9: Add test coverage      ─── Ongoing throughout all phases
```

Phases 1-2 are **highest priority** — they directly reduce crash rates. Phases 5-6-7-8 can be parallelized.

### 4.2 Per-PR Validation

- [ ] `cargo build --no-default-features --features test-tauri` succeeds
- [ ] `cargo test --features test-tauri -- --test-threads=1` passes
- [ ] `cargo clippy -- -D warnings` passes
- [ ] `cargo fmt --check` passes
- [ ] No new `.unwrap()` in production code
- [ ] Frontend TypeScript types updated if command signatures changed

---

## 5. Plugin Refactoring (Separate Track)

The `tauri-plugin-llamacpp` plugin has 117+ `.unwrap()` calls and a 1,323-line `backend.rs`. This is a separate refactoring effort but should follow the same principles:

1. Add plugin-specific error type in `error.rs`
2. Replace `.unwrap()` with `?` and proper error propagation
3. Split `backend.rs` into `installation.rs`, `lifecycle.rs`, `inference.rs`
4. Split `args.rs` into focused argument builders
5. Add service layer tests for device detection, model loading, inference

The `tauri-plugin-hardware` plugin is in better shape (has vendor tests) but should also adopt the error type pattern.

---

## 6. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Changing command return types breaks frontend | HIGH | Migrate one command at a time. Frontend `invoke()` calls handle both String and structured errors. Add TypeScript error type. |
| AppState decomposition is large diff | HIGH | One state struct per PR. Old AppState fields can temporarily re-export from new structs. |
| Service extraction changes behavior | MEDIUM | Extract logic verbatim first (copy-paste), then refactor. Tests validate equivalence. |
| Plugin changes break native functionality | HIGH | Separate plugin PRs. Test on all platforms before merge. |

---

## 7. Out of Scope

- **New features** — this is purely structural improvement
- **Frontend changes** — except updating error handling to use structured `AppError` responses
- **Performance optimization** — focus is on correctness and testability
- **Database migration** — the threads JSONL/SQLite dual backend is a separate design decision
- **API design changes** — command signatures stay the same (except return type `String` → `AppError`)
