use tauri::{App, Emitter, Manager, RunEvent, Runtime, WindowEvent};

pub fn setup_theme_listener<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    // Setup theme listener for main window
    if let Some(window) = app.get_webview_window("main") {
        setup_window_theme_listener(app.handle().clone(), window);
    }

    Ok(())
}

fn setup_window_theme_listener<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) {
    let window_label = window.label().to_string();
    let app_handle_clone = app_handle.clone();

    window.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(theme) = event {
            let theme_str = match theme {
                tauri::Theme::Light => "light",
                tauri::Theme::Dark => "dark",
                _ => "auto",
            };
            log::info!("System theme changed to: {theme_str} for window: {window_label}");
            let _ = app_handle_clone.emit("theme-changed", theme_str);
        }
    });
}

/// Tauri `.run()` event handler — handles app lifecycle events.
pub fn app_run_handler(app: &tauri::AppHandle, event: RunEvent) {
    if let RunEvent::Exit = event {
        let app_handle = app.clone();
        #[cfg(not(any(target_os = "ios", target_os = "android")))]
        {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.emit("app-shutting-down", ());
                let _ = window.hide();
            }
        }
        let app_state = app_handle.state::<crate::core::state::AppState>();
        let cleanup_already_running = tokio::task::block_in_place(|| {
            tauri::async_runtime::block_on(async {
                let handle = app_state.background_cleanup_handle.lock().await;
                handle.is_some()
            })
        });
        if cleanup_already_running {
            return;
        }
        tokio::task::block_in_place(|| {
            tauri::async_runtime::block_on(async {
                use crate::core::mcp::helpers::background_cleanup_mcp_servers;
                let mcp_state = app_handle.state::<crate::core::state::McpState>();
                let cleanup_future = background_cleanup_mcp_servers(&app_handle, &mcp_state);
                match tokio::time::timeout(tokio::time::Duration::from_secs(10), cleanup_future)
                    .await
                {
                    Ok(_) => log::info!("MCP cleanup completed successfully"),
                    Err(_) => log::warn!("MCP cleanup timed out after 10 seconds"),
                }
                #[cfg(not(any(target_os = "ios", target_os = "android")))]
                {
                    let _ =
                        tauri_plugin_llamacpp::cleanup_llama_processes(app_handle.clone()).await;
                    log::info!("llama.cpp process cleanup completed");
                }
                log::info!("App cleanup completed");
            });
        });
    }
}
