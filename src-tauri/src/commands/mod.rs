/// Expands to `tauri::generate_handler![all desktop handlers]`.
/// Usage: `commands::desktop_handlers!()`
macro_rules! desktop_handlers {
    () => {
        tauri::generate_handler![
            // FS commands - Deprecate soon
            crate::core::filesystem::commands::join_path,
            crate::core::filesystem::commands::mkdir,
            crate::core::filesystem::commands::exists_sync,
            crate::core::filesystem::commands::readdir_sync,
            crate::core::filesystem::commands::read_file_sync,
            crate::core::filesystem::commands::rm,
            crate::core::filesystem::commands::mv,
            crate::core::filesystem::commands::file_stat,
            crate::core::filesystem::commands::write_file_sync,
            crate::core::filesystem::commands::write_yaml,
            crate::core::filesystem::commands::read_yaml,
            crate::core::filesystem::commands::decompress,
            crate::core::filesystem::commands::open_dialog,
            crate::core::filesystem::commands::save_dialog,
            crate::core::filesystem::commands::write_binary_file,
            crate::core::filesystem::commands::write_text_file,
            crate::core::filesystem::commands::read_akidb_config,
            crate::core::filesystem::commands::write_akidb_config,
            crate::core::filesystem::commands::read_akidb_status,
            crate::core::filesystem::commands::akidb_sync_now,
            // App configuration commands
            crate::core::app::commands::get_app_configurations,
            crate::core::app::commands::get_user_home_path,
            crate::core::app::commands::update_app_configuration,
            crate::core::app::commands::get_app_data_folder_path,
            crate::core::app::commands::get_configuration_file_path,
            crate::core::app::commands::default_data_folder_path,
            crate::core::app::commands::change_app_data_folder,
            crate::core::app::commands::app_token,
            // Extension commands
            crate::core::extensions::commands::get_app_extensions_path,
            crate::core::extensions::commands::install_extensions,
            crate::core::extensions::commands::get_active_extensions,
            // System commands
            crate::core::system::commands::relaunch,
            crate::core::system::commands::open_app_directory,
            crate::core::system::commands::open_file_explorer,
            crate::core::system::commands::factory_reset,
            crate::core::system::commands::read_logs,
            crate::core::system::commands::is_library_available,
            crate::core::system::commands::launch_claude_code_with_config,
            // Server commands
            crate::core::server::commands::start_server,
            crate::core::server::commands::stop_server,
            crate::core::server::commands::get_server_status,
            // Remote provider commands
            crate::core::server::remote_provider_commands::register_provider_config,
            crate::core::server::remote_provider_commands::register_provider_configs_batch,
            crate::core::server::remote_provider_commands::unregister_provider_config,
            crate::core::server::remote_provider_commands::get_provider_config,
            crate::core::server::remote_provider_commands::list_provider_configs,
            // MCP commands
            crate::core::mcp::commands::get_tools,
            crate::core::mcp::commands::call_tool,
            crate::core::mcp::commands::cancel_tool_call,
            crate::core::mcp::commands::restart_mcp_servers,
            crate::core::mcp::commands::get_connected_servers,
            crate::core::mcp::commands::save_mcp_configs,
            crate::core::mcp::commands::get_mcp_configs,
            crate::core::mcp::commands::activate_mcp_server,
            crate::core::mcp::commands::deactivate_mcp_server,
            crate::core::mcp::commands::check_ax_studio_browser_extension_connected,
            // Threads
            crate::core::threads::commands::list_threads,
            crate::core::threads::commands::create_thread,
            crate::core::threads::commands::modify_thread,
            crate::core::threads::commands::delete_thread,
            crate::core::threads::commands::list_messages,
            crate::core::threads::commands::create_message,
            crate::core::threads::commands::modify_message,
            crate::core::threads::commands::delete_message,
            crate::core::threads::commands::get_thread_assistant,
            crate::core::threads::commands::create_thread_assistant,
            crate::core::threads::commands::modify_thread_assistant,
            // Download
            crate::core::downloads::commands::download_files,
            crate::core::downloads::commands::cancel_download_task,
            // Code execution
            crate::core::code_execution::commands::execute_python_code,
            crate::core::code_execution::commands::check_sandbox_status,
            crate::core::code_execution::commands::start_sandbox,
            crate::core::code_execution::commands::stop_sandbox,
            crate::core::code_execution::commands::reset_sandbox_session,
            crate::core::code_execution::commands::update_sandbox_url,
            // Research commands
            crate::core::research::commands::scrape_url,
            crate::core::research::commands::web_search,
            // Custom updater commands (desktop only)
            crate::core::updater::commands::check_for_app_updates,
            crate::core::updater::commands::is_update_available,
            // Agent teams
            crate::core::agent_teams::list_agent_teams,
            crate::core::agent_teams::get_agent_team,
            crate::core::agent_teams::save_agent_team,
            crate::core::agent_teams::delete_agent_team,
            // Agent run logs
            crate::core::agent_run_logs::save_agent_run_log,
            crate::core::agent_run_logs::list_agent_run_logs,
            crate::core::agent_run_logs::get_agent_run_log,
            // Integration commands
            crate::core::integrations::commands::save_integration_token,
            crate::core::integrations::commands::delete_integration_token,
            crate::core::integrations::commands::get_integration_status,
            crate::core::integrations::commands::get_all_integration_statuses,
            crate::core::integrations::commands::validate_integration_token,
            crate::core::integrations::commands::start_oauth_flow,
        ]
    };
}
pub(crate) use desktop_handlers;

/// Expands to `tauri::generate_handler![all mobile handlers]` (identical to desktop, minus updater commands).
/// Usage: `commands::mobile_handlers!()`
macro_rules! mobile_handlers {
    () => {
        tauri::generate_handler![
            // FS commands - Deprecate soon
            crate::core::filesystem::commands::join_path,
            crate::core::filesystem::commands::mkdir,
            crate::core::filesystem::commands::exists_sync,
            crate::core::filesystem::commands::readdir_sync,
            crate::core::filesystem::commands::read_file_sync,
            crate::core::filesystem::commands::rm,
            crate::core::filesystem::commands::mv,
            crate::core::filesystem::commands::file_stat,
            crate::core::filesystem::commands::write_file_sync,
            crate::core::filesystem::commands::write_yaml,
            crate::core::filesystem::commands::read_yaml,
            crate::core::filesystem::commands::decompress,
            crate::core::filesystem::commands::open_dialog,
            crate::core::filesystem::commands::save_dialog,
            crate::core::filesystem::commands::write_binary_file,
            crate::core::filesystem::commands::write_text_file,
            crate::core::filesystem::commands::read_akidb_config,
            crate::core::filesystem::commands::write_akidb_config,
            crate::core::filesystem::commands::read_akidb_status,
            crate::core::filesystem::commands::akidb_sync_now,
            // App configuration commands
            crate::core::app::commands::get_app_configurations,
            crate::core::app::commands::get_user_home_path,
            crate::core::app::commands::update_app_configuration,
            crate::core::app::commands::get_app_data_folder_path,
            crate::core::app::commands::get_configuration_file_path,
            crate::core::app::commands::default_data_folder_path,
            crate::core::app::commands::change_app_data_folder,
            crate::core::app::commands::app_token,
            // Extension commands
            crate::core::extensions::commands::get_app_extensions_path,
            crate::core::extensions::commands::install_extensions,
            crate::core::extensions::commands::get_active_extensions,
            // System commands
            crate::core::system::commands::relaunch,
            crate::core::system::commands::open_app_directory,
            crate::core::system::commands::open_file_explorer,
            crate::core::system::commands::factory_reset,
            crate::core::system::commands::read_logs,
            crate::core::system::commands::is_library_available,
            crate::core::system::commands::launch_claude_code_with_config,
            // Server commands
            crate::core::server::commands::start_server,
            crate::core::server::commands::stop_server,
            crate::core::server::commands::get_server_status,
            // Remote provider commands
            crate::core::server::remote_provider_commands::register_provider_config,
            crate::core::server::remote_provider_commands::register_provider_configs_batch,
            crate::core::server::remote_provider_commands::unregister_provider_config,
            crate::core::server::remote_provider_commands::get_provider_config,
            crate::core::server::remote_provider_commands::list_provider_configs,
            // MCP commands
            crate::core::mcp::commands::get_tools,
            crate::core::mcp::commands::call_tool,
            crate::core::mcp::commands::cancel_tool_call,
            crate::core::mcp::commands::restart_mcp_servers,
            crate::core::mcp::commands::get_connected_servers,
            crate::core::mcp::commands::save_mcp_configs,
            crate::core::mcp::commands::get_mcp_configs,
            crate::core::mcp::commands::activate_mcp_server,
            crate::core::mcp::commands::deactivate_mcp_server,
            crate::core::mcp::commands::check_ax_studio_browser_extension_connected,
            // Threads
            crate::core::threads::commands::list_threads,
            crate::core::threads::commands::create_thread,
            crate::core::threads::commands::modify_thread,
            crate::core::threads::commands::delete_thread,
            crate::core::threads::commands::list_messages,
            crate::core::threads::commands::create_message,
            crate::core::threads::commands::modify_message,
            crate::core::threads::commands::delete_message,
            crate::core::threads::commands::get_thread_assistant,
            crate::core::threads::commands::create_thread_assistant,
            crate::core::threads::commands::modify_thread_assistant,
            // Download
            crate::core::downloads::commands::download_files,
            crate::core::downloads::commands::cancel_download_task,
            // Code execution
            crate::core::code_execution::commands::execute_python_code,
            crate::core::code_execution::commands::check_sandbox_status,
            crate::core::code_execution::commands::start_sandbox,
            crate::core::code_execution::commands::stop_sandbox,
            crate::core::code_execution::commands::reset_sandbox_session,
            crate::core::code_execution::commands::update_sandbox_url,
            // Research commands
            crate::core::research::commands::scrape_url,
            crate::core::research::commands::web_search,
            // Agent teams
            crate::core::agent_teams::list_agent_teams,
            crate::core::agent_teams::get_agent_team,
            crate::core::agent_teams::save_agent_team,
            crate::core::agent_teams::delete_agent_team,
            // Agent run logs
            crate::core::agent_run_logs::save_agent_run_log,
            crate::core::agent_run_logs::list_agent_run_logs,
            crate::core::agent_run_logs::get_agent_run_log,
            // Integration commands
            crate::core::integrations::commands::save_integration_token,
            crate::core::integrations::commands::delete_integration_token,
            crate::core::integrations::commands::get_integration_status,
            crate::core::integrations::commands::get_all_integration_statuses,
            crate::core::integrations::commands::validate_integration_token,
            crate::core::integrations::commands::start_oauth_flow,
        ]
    };
}
pub(crate) use mobile_handlers;
