# Contributing to Tauri Backend

The Rust backend handles native system integration, high-performance file operations, and low-level process management for Ax-Fabric. It leverages [Tauri 2](https://v2.tauri.app/) for the IPC bridge between the frontend and the OS.

## Core Modules

- **`/src/core/app`**: Application configuration and state management.
- **`/src/core/downloads`**: Multi-threaded model downloader with progress reporting.
- **`/src/core/filesystem`**: Secure file I/O commands with scoped access.
- **`/src/core/mcp`**: Integration with the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).
- **`/src/core/server`**: Local API proxy for exposing AI models to other apps.
- **`/src/core/threads`**: Persistent conversation storage using local databases.
- **`/utils`**: Shared utility crate for cryptography, HTTP clients, and path manipulation.

## Security & Capabilities

Tauri 2 uses a capability-based security model. Permissions for frontend commands are defined in JSON files within the `capabilities/` directory.

- **`default.json`**: Basic permissions granted to all windows.
- **`desktop.json`**: Permissions specific to the desktop version.
- **Scoping**: File system access is strictly scoped to the application data directory. Avoid using absolute paths unless explicitly permitted.

## Development

### Adding a New Tauri Command

1.  **Define the Command** in a module (e.g., `src/core/my_mod.rs`):
    ```rust
    #[tauri::command]
    pub async fn my_command(data: String) -> Result<String, String> {
        Ok(format!("Received: {}", data))
    }
    ```
2.  **Register the Command** in `src/lib.rs`:
    ```rust
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![my_command])
    ```
3.  **Grant Permissions** in `capabilities/default.json`:
    ```json
    {
      "permissions": ["my-command:allow-my_command"]
    }
    ```

## Building & Testing

```bash
# Development (with hot reload)
yarn dev:tauri

# Run Rust tests
cargo test --all-features

# Run Clippy (linter)
cargo clippy -- -D warnings
```

## Best Practices

- **Async Everywhere**: Use `async` for all I/O or long-running commands to avoid blocking the main thread.
- **Error Handling**: Use `thiserror` for defining clear, structured error types. Always return `Result<T, E>` to the frontend.
- **State Access**: Use `tauri::State` to access global application state securely across commands.
- **Validation**: Never trust data coming from the frontend; validate all inputs.

## Common Issues

- **Serialization Failures**: Ensure all structs returned to the frontend implement `serde::Serialize`.
- **Target Mismatch**: If you encounter issues with native dependencies (like `ring`), try `cargo clean` and rebuild.
- **Permission Denied**: Check the `capabilities/` directory if a frontend command fails with a 403-like error.
