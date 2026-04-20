use super::akidb::{akidb_sync_now, cancel_akidb_sync};
use super::commands::*;
use super::helpers::resolve_path;
use crate::core::app::commands::get_app_data_folder_path;
use crate::core::state::{AppState, ProviderState, SharedMcpServers};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::test::mock_app;
use tauri::Manager;
use tokio::sync::{oneshot, Mutex};

fn test_app_state() -> AppState {
    let mcp_servers: SharedMcpServers = Arc::new(Mutex::new(std::collections::HashMap::new()));
    AppState {
        app_token: None,
        mcp_servers,
        download_manager: Arc::new(Mutex::new(
            crate::core::downloads::models::DownloadManagerState::default(),
        )),
        mcp_active_servers: Arc::new(Mutex::new(std::collections::HashMap::new())),
        server_handle: Arc::new(Mutex::new(None)),
        tool_call_cancellations: Arc::new(Mutex::new(std::collections::HashMap::new())),
        akidb_sync_cancellation: Arc::new(Mutex::new(None)),
        mcp_settings: Arc::new(Mutex::new(crate::core::mcp::models::McpSettings::default())),
        mcp_shutdown_in_progress: Arc::new(Mutex::new(false)),
        mcp_monitoring_tasks: Arc::new(Mutex::new(std::collections::HashMap::new())),
        background_cleanup_handle: Arc::new(Mutex::new(None)),
        mcp_server_pids: Arc::new(Mutex::new(std::collections::HashMap::new())),
        provider_state: Arc::new(Mutex::new(ProviderState::default())),
        approved_save_paths: Arc::new(Mutex::new(HashSet::new())),
        factory_reset_lock: Arc::new(Mutex::new(())),
    }
}

#[test]
fn test_rm() {
    let app = mock_app();
    let path = "test_rm_dir";
    fs::create_dir_all(get_app_data_folder_path(app.handle().clone()).join(path)).unwrap();
    let request = SinglePathRequest::Legacy {
        args: vec![format!("file://{path}")],
    };
    let result = rm(app.handle().clone(), request);
    assert!(result.is_ok());
    assert!(!get_app_data_folder_path(app.handle().clone())
        .join(path)
        .exists());
}

#[test]
fn test_resolve_path_rejects_traversal_outside_app_data() {
    let app = mock_app();
    let result = resolve_path(app.handle().clone(), "../outside.txt");
    assert!(result.is_err());
}

#[test]
fn test_mkdir() {
    let app = mock_app();
    let path = "test_mkdir_dir";
    let request = SinglePathRequest::Legacy {
        args: vec![format!("file://{path}")],
    };
    let result = mkdir(app.handle().clone(), request);
    assert!(result.is_ok());
    assert!(get_app_data_folder_path(app.handle().clone())
        .join(path)
        .exists());
    let _ = fs::remove_dir_all(get_app_data_folder_path(app.handle().clone()).join(path));
}

#[test]
fn test_join_path() {
    let app = mock_app();
    let path = "file://test_dir";
    let request = JoinPathRequest::Legacy {
        args: vec![path.to_string(), "test_file".to_string()],
    };
    let result = join_path(app.handle().clone(), request).unwrap();
    assert_eq!(
        result,
        get_app_data_folder_path(app.handle().clone())
            .join(format!("test_dir{}test_file", std::path::MAIN_SEPARATOR))
            .to_string_lossy()
            .to_string()
    );
}

#[test]
fn test_exists_sync() {
    let app = mock_app();
    let path = "file://test_exists_sync_file";
    let dir_path = get_app_data_folder_path(app.handle().clone());
    fs::create_dir_all(&dir_path).unwrap();
    let file_path = dir_path.join("test_exists_sync_file");
    File::create(&file_path).unwrap();
    let request = SinglePathRequest::Legacy {
        args: vec![path.to_string()],
    };
    let result = exists_sync(app.handle().clone(), request).unwrap();
    assert!(result);
    fs::remove_file(file_path).unwrap();
}

#[test]
fn test_read_file_sync() {
    let app = mock_app();
    let path = "file://test_read_file_sync_file";
    let dir_path = get_app_data_folder_path(app.handle().clone());
    fs::create_dir_all(&dir_path).unwrap();
    let file_path = dir_path.join("test_read_file_sync_file");
    fs::write(&file_path, "test content").unwrap();
    let request = SinglePathRequest::Legacy {
        args: vec![path.to_string()],
    };
    let result = read_file_sync(app.handle().clone(), request).unwrap();
    assert_eq!(result, "test content".to_string());
    fs::remove_file(file_path).unwrap();
}

#[test]
fn test_write_file_sync_writes_typed_request_atomically() {
    let app = mock_app();
    let path = "test_write_file_sync.txt";

    write_file_sync(
        app.handle().clone(),
        PathPairRequest::Typed {
            source: path.to_string(),
            destination: "hello world".to_string(),
        },
    )
    .unwrap();

    let written =
        fs::read_to_string(get_app_data_folder_path(app.handle().clone()).join(path)).unwrap();
    assert_eq!(written, "hello world");
}

#[test]
fn test_readdir_sync() {
    let app = mock_app();
    let dir_path = get_app_data_folder_path(app.handle().clone()).join("test_readdir_sync_dir");
    fs::create_dir_all(&dir_path).unwrap();
    let file1 = dir_path.join("file1.txt");
    let file2 = dir_path.join("file2.txt");
    File::create(&file1).unwrap();
    File::create(&file2).unwrap();

    let request = SinglePathRequest::Typed {
        path: dir_path.to_string_lossy().to_string(),
    };
    let result = readdir_sync(app.handle().clone(), request).unwrap();
    let result_paths: HashSet<_> = result.into_iter().collect();
    let expected_file1 = file1
        .canonicalize()
        .unwrap_or(file1.clone())
        .to_string_lossy()
        .to_string();
    let expected_file2 = file2
        .canonicalize()
        .unwrap_or(file2.clone())
        .to_string_lossy()
        .to_string();
    assert!(result_paths.contains(&expected_file1));
    assert!(result_paths.contains(&expected_file2));

    let _ = fs::remove_dir_all(dir_path);
}

#[test]
fn test_mv_moves_file_within_app_data_folder() {
    let app = mock_app();
    let app_data = get_app_data_folder_path(app.handle().clone());
    fs::create_dir_all(&app_data).unwrap();
    fs::create_dir_all(app_data.join("nested")).unwrap();
    fs::write(app_data.join("source.txt"), "payload").unwrap();

    mv(
        app.handle().clone(),
        PathPairRequest::Typed {
            source: "source.txt".to_string(),
            destination: "nested/destination.txt".to_string(),
        },
    )
    .unwrap();

    assert!(!app_data.join("source.txt").exists());
    assert_eq!(
        fs::read_to_string(app_data.join("nested").join("destination.txt")).unwrap(),
        "payload"
    );
}

#[test]
fn test_consume_approved_save_target_allows_once() {
    let temp_dir = std::env::temp_dir().join("ax-studio-filesystem-tests");
    fs::create_dir_all(&temp_dir).unwrap();
    let save_path = temp_dir.join("figure.png");

    let mut approved = HashSet::<PathBuf>::new();
    approve_save_target(&mut approved, save_path.to_str().unwrap()).unwrap();

    let resolved =
        consume_approved_save_target(&mut approved, save_path.to_str().unwrap()).unwrap();
    // On macOS /var → /private/var after canonicalize, so compare canonical forms
    let expected = temp_dir
        .canonicalize()
        .unwrap_or(temp_dir.clone())
        .join("figure.png");
    assert_eq!(resolved, expected);
    assert!(consume_approved_save_target(&mut approved, save_path.to_str().unwrap()).is_err());
}

#[test]
fn test_normalize_save_target_path_rejects_relative_paths() {
    assert!(normalize_save_target_path("relative/file.txt").is_err());
}

#[test]
fn test_file_stat_accepts_legacy_and_typed_requests() {
    let app = mock_app();
    let dir_path = get_app_data_folder_path(app.handle().clone());
    fs::create_dir_all(&dir_path).unwrap();
    let file_path = dir_path.join("test_file_stat.txt");
    fs::write(&file_path, "hello").unwrap();

    let legacy = file_stat(
        app.handle().clone(),
        FileStatRequest::Legacy {
            args: "file://test_file_stat.txt".to_string(),
        },
    )
    .unwrap();
    assert_eq!(legacy.size, 5);

    let typed = file_stat(
        app.handle().clone(),
        FileStatRequest::Typed {
            path: "file://test_file_stat.txt".to_string(),
        },
    )
    .unwrap();
    assert_eq!(typed.size, 5);

    fs::remove_file(file_path).unwrap();
}

#[test]
fn test_decompress_extracts_zip_archive_within_app_data_folder() {
    let app = mock_app();
    let app_data = get_app_data_folder_path(app.handle().clone());
    fs::create_dir_all(&app_data).unwrap();
    let archive_path = app_data.join("archive.zip");

    {
        let file = File::create(&archive_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::FileOptions::default();
        zip.start_file("nested/example.txt", options).unwrap();
        zip.write_all(b"hello from zip").unwrap();
        zip.finish().unwrap();
    }

    decompress(
        app.handle().clone(),
        DecompressRequest::Typed {
            path: "archive.zip".to_string(),
            output_dir: "unzipped".to_string(),
        },
    )
    .unwrap();

    let extracted = app_data.join("unzipped").join("nested").join("example.txt");
    assert_eq!(fs::read_to_string(extracted).unwrap(), "hello from zip");
}

#[test]
fn test_decompress_rejects_zip_path_traversal_entries() {
    let app = mock_app();
    let app_data = get_app_data_folder_path(app.handle().clone());
    fs::create_dir_all(&app_data).unwrap();
    let archive_path = app_data.join("traversal.zip");

    {
        let file = File::create(&archive_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::FileOptions::default();
        zip.start_file("../escape.txt", options).unwrap();
        zip.write_all(b"escape").unwrap();
        zip.finish().unwrap();
    }

    let error = decompress(
        app.handle().clone(),
        DecompressRequest::Typed {
            path: "traversal.zip".to_string(),
            output_dir: "unzipped".to_string(),
        },
    )
    .unwrap_err();

    assert!(error.contains("Invalid zip entry path"));
}

#[tokio::test]
async fn test_write_binary_and_text_file_require_one_time_save_approval() {
    let app = mock_app();
    app.manage(test_app_state());
    let state = app.state::<AppState>();

    let save_path = std::env::temp_dir().join("ax-studio-export.bin");
    {
        let mut approved = state.approved_save_paths.lock().await;
        approve_save_target(&mut approved, save_path.to_str().unwrap()).unwrap();
    }

    write_binary_file(
        state.clone(),
        save_path.to_string_lossy().to_string(),
        "68656c6c6f".to_string(),
    )
    .await
    .unwrap();

    assert_eq!(fs::read(&save_path).unwrap(), b"hello");

    let denied = write_text_file(
        state.clone(),
        save_path.to_string_lossy().to_string(),
        "should fail".to_string(),
    )
    .await
    .unwrap_err();
    assert!(denied.contains("path was not approved"));

    {
        let mut approved = state.approved_save_paths.lock().await;
        approve_save_target(&mut approved, save_path.to_str().unwrap()).unwrap();
    }

    write_text_file(
        state,
        save_path.to_string_lossy().to_string(),
        "plain text".to_string(),
    )
    .await
    .unwrap();
    assert_eq!(fs::read_to_string(&save_path).unwrap(), "plain text");
    let _ = fs::remove_file(save_path);
}

#[tokio::test]
async fn test_cancel_akidb_sync_and_duplicate_guard() {
    let app = mock_app();
    app.manage(test_app_state());
    let state = app.state::<AppState>();

    let (cancel_tx, _cancel_rx) = oneshot::channel();
    {
        let mut cancellation = state.akidb_sync_cancellation.lock().await;
        *cancellation = Some(cancel_tx);
    }

    let cancelled = cancel_akidb_sync(state.clone()).await.unwrap();
    assert!(cancelled);
    assert!(!cancel_akidb_sync(state.clone()).await.unwrap());

    let (running_tx, _running_rx) = oneshot::channel();
    {
        let mut cancellation = state.akidb_sync_cancellation.lock().await;
        *cancellation = Some(running_tx);
    }

    let error = akidb_sync_now(app.handle().clone(), state)
        .await
        .unwrap_err();
    assert_eq!(error, "A knowledge-base sync is already running");
}

#[test]
fn test_write_yaml_accepts_typed_request() {
    let app = mock_app();
    let path = "typed-config.yaml";

    write_yaml(
        app.handle().clone(),
        WriteYamlRequest::Typed {
            data: "name: ax-studio\n".to_string(),
            path: path.to_string(),
        },
    )
    .unwrap();

    let result = read_yaml(
        app.handle().clone(),
        SinglePathRequest::Typed {
            path: path.to_string(),
        },
    )
    .unwrap();
    assert_eq!(result["name"], "ax-studio");

    let _ = fs::remove_file(get_app_data_folder_path(app.handle().clone()).join(path));
}
