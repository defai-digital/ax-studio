//! In-process AX Engine MLX integration.
//!
//! Layout:
//!   * `worker`  — dedicated OS thread that owns all `EngineSession`s
//!                 (MLX/Metal handles aren't `Send`, so they can't live on
//!                 arbitrary tokio tasks)
//!   * `state`   — `MlxState` Tauri-managed handle to the worker
//!   * `commands`— Tauri IPC commands that dispatch to the worker:
//!                 `mlx_runtime_probe`, `mlx_load_model`, `mlx_unload_model`,
//!                 `mlx_list_loaded`
//!
//! macOS-only — `ax-engine-mlx` and `mlx-sys` only build on Apple platforms.

#[cfg(target_os = "macos")]
pub mod commands;

#[cfg(target_os = "macos")]
pub mod state;

#[cfg(target_os = "macos")]
pub mod worker;
