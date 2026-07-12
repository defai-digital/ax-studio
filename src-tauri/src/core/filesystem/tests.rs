use super::akidb::{akidb_sync_now, cancel_akidb_sync};
use super::commands::*;
use super::helpers::resolve_path;
use crate::core::app::commands::get_app_data_folder_path;
use crate::core::state::{AppState, ProviderState, SharedMcpServers};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::test::mock_app;
use tauri::Manager;
use tokio::sync::{oneshot, Mutex};

fn test_app_state() -> AppState {
    let mcp_servers: SharedMcpServers = Arc::new(Mutex::new(std::collections::HashMap::new()));
    AppState {
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
        approved_read_files: Arc::new(Mutex::new(HashSet::new())),
        approved_read_directories: Arc::new(Mutex::new(HashSet::new())),
        factory_reset_lock: Arc::new(Mutex::new(())),
        active_streams: Arc::new(Mutex::new(std::collections::HashMap::new())),
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
    let app_data = get_app_data_folder_path(app.handle().clone());
    fs::create_dir_all(&app_data).unwrap();
    let canonical_app_data =
        ax_studio_utils::normalize_path(&app_data.canonicalize().unwrap_or(app_data));
    let expected = canonical_app_data
        .join(format!("test_dir{}test_file", std::path::MAIN_SEPARATOR))
        .to_string_lossy()
        .to_string();
    assert_eq!(result, expected);
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

#[tokio::test]
async fn test_read_file_base64_requires_app_data_or_picker_approval() {
    use base64::Engine;

    let app = mock_app();
    app.manage(test_app_state());
    let state = app.state::<AppState>();

    let app_data_file = get_app_data_folder_path(app.handle().clone()).join("approved-read.txt");
    fs::write(&app_data_file, b"app data").unwrap();
    let encoded = read_file_base64(
        app.handle().clone(),
        state.clone(),
        SinglePathRequest::Typed {
            path: app_data_file.to_string_lossy().into_owned(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap(),
        b"app data"
    );

    let outside = tempfile::tempdir().unwrap();
    let outside_file = outside.path().join("private.txt");
    fs::write(&outside_file, b"selected").unwrap();
    let denied = read_file_base64(
        app.handle().clone(),
        state.clone(),
        SinglePathRequest::Typed {
            path: outside_file.to_string_lossy().into_owned(),
        },
    )
    .await
    .unwrap_err();
    assert!(denied.contains("not approved"));

    state
        .approved_read_files
        .lock()
        .await
        .insert(outside_file.canonicalize().unwrap());
    let encoded = read_file_base64(
        app.handle().clone(),
        state,
        SinglePathRequest::Typed {
            path: outside_file.to_string_lossy().into_owned(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap(),
        b"selected"
    );
}

#[test]
fn test_write_file_sync_writes_typed_request_atomically() {
    let app = mock_app();
    let path = "file://test_write_file_sync.txt";

    write_file_sync(
        app.handle().clone(),
        PathPairRequest::Typed {
            source: path.to_string(),
            destination: "hello world".to_string(),
        },
    )
    .unwrap();

    let written = fs::read_to_string(
        get_app_data_folder_path(app.handle().clone()).join("test_write_file_sync.txt"),
    )
    .unwrap();
    assert_eq!(written, "hello world");
}

#[test]
fn test_write_blob_writes_typed_data_inside_app_data() {
    let app = mock_app();

    write_blob(
        app.handle().clone(),
        FileContentRequest::TypedData {
            path: "file://blob/data.bin".to_string(),
            data: "blob bytes".to_string(),
        },
    )
    .unwrap();

    let written = fs::read(
        get_app_data_folder_path(app.handle().clone())
            .join("blob")
            .join("data.bin"),
    )
    .unwrap();
    assert_eq!(written, b"blob bytes");
}

#[test]
fn test_unlink_sync_removes_file_inside_app_data() {
    let app = mock_app();
    let app_data = get_app_data_folder_path(app.handle().clone());
    fs::create_dir_all(&app_data).unwrap();
    let file_path = app_data.join("delete-me.txt");
    fs::write(&file_path, "remove me").unwrap();

    unlink_sync(
        app.handle().clone(),
        SinglePathRequest::Typed {
            path: "file://delete-me.txt".to_string(),
        },
    )
    .unwrap();

    assert!(!file_path.exists());
}

#[test]
fn test_append_file_sync_appends_text_inside_app_data() {
    let app = mock_app();

    append_file_sync(
        app.handle().clone(),
        FileContentRequest::TypedContent {
            path: "file://append/log.txt".to_string(),
            content: "first".to_string(),
        },
    )
    .unwrap();
    append_file_sync(
        app.handle().clone(),
        FileContentRequest::Legacy {
            args: vec!["file://append/log.txt".to_string(), "-second".to_string()],
        },
    )
    .unwrap();

    let written = fs::read_to_string(
        get_app_data_folder_path(app.handle().clone())
            .join("append")
            .join("log.txt"),
    )
    .unwrap();
    assert_eq!(written, "first-second");
}

#[test]
fn test_get_gguf_files_classifies_app_data_files() {
    let app = mock_app();
    let app_data = get_app_data_folder_path(app.handle().clone());
    fs::create_dir_all(app_data.join("models")).unwrap();
    fs::write(app_data.join("models").join("model.gguf"), "model").unwrap();
    fs::write(app_data.join("models").join("notes.txt"), "notes").unwrap();

    let result = get_gguf_files(
        app.handle().clone(),
        GgufFilesRequest::Typed {
            paths: vec![
                "file://models/model.gguf".to_string(),
                "file://models/notes.txt".to_string(),
            ],
        },
    )
    .unwrap();

    assert_eq!(result.gguf.len(), 1);
    let expected_model_path = Path::new("models").join("model.gguf");
    assert!(
        PathBuf::from(&result.gguf[0]).ends_with(&expected_model_path),
        "expected model path to end with {:?}, got {}",
        expected_model_path,
        result.gguf[0]
    );
    assert_eq!(result.non_gguf.len(), 1);
    let expected_notes_path = Path::new("models").join("notes.txt");
    assert!(
        PathBuf::from(&result.non_gguf[0]).ends_with(&expected_notes_path),
        "expected notes path to end with {:?}, got {}",
        expected_notes_path,
        result.non_gguf[0]
    );
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
    let result_file_names: HashSet<_> = result
        .into_iter()
        .filter_map(|path| {
            PathBuf::from(path)
                .file_name()
                .map(|file_name| file_name.to_string_lossy().to_string())
        })
        .collect();
    assert!(result_file_names.contains("file1.txt"));
    assert!(result_file_names.contains("file2.txt"));

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
            source: "file://source.txt".to_string(),
            destination: "file://nested/destination.txt".to_string(),
        },
    )
    .unwrap();

    assert!(!app_data.join("source.txt").exists());
    assert_eq!(
        fs::read_to_string(app_data.join("nested").join("destination.txt")).unwrap(),
        "payload"
    );
}

#[tokio::test]
async fn test_copy_file_copies_picker_approved_source_into_app_data() {
    let app = mock_app();
    app.manage(test_app_state());
    let app_data = get_app_data_folder_path(app.handle().clone());
    fs::create_dir_all(&app_data).unwrap();
    fs::create_dir_all(app_data.join("copied")).unwrap();

    let source_dir =
        std::env::temp_dir().join(format!("ax-studio-copy-source-{}", std::process::id()));
    fs::create_dir_all(&source_dir).unwrap();
    let source_path = source_dir.join("source.gguf");
    fs::write(&source_path, "model bytes").unwrap();
    let denied = copy_file(
        app.handle().clone(),
        app.state(),
        PathPairRequest::Typed {
            source: source_path.to_string_lossy().into_owned(),
            destination: app_data
                .join("copied")
                .join("denied.gguf")
                .to_string_lossy()
                .into_owned(),
        },
    )
    .await
    .unwrap_err();
    assert!(denied.contains("not approved"));
    app.state::<AppState>()
        .approved_read_files
        .lock()
        .await
        .insert(source_path.canonicalize().unwrap());

    copy_file(
        app.handle().clone(),
        app.state(),
        PathPairRequest::Typed {
            source: source_path.to_string_lossy().to_string(),
            destination: app_data
                .join("copied")
                .join("model.gguf")
                .to_string_lossy()
                .to_string(),
        },
    )
    .await
    .unwrap();

    assert_eq!(
        fs::read_to_string(app_data.join("copied").join("model.gguf")).unwrap(),
        "model bytes"
    );

    let _ = fs::remove_dir_all(source_dir);
    let _ = fs::remove_dir_all(app_data.join("copied"));
}

#[tokio::test]
async fn test_copy_file_accepts_file_url_destination_in_app_data() {
    let app = mock_app();
    app.manage(test_app_state());
    let app_data = get_app_data_folder_path(app.handle().clone());

    let source_dir =
        std::env::temp_dir().join(format!("ax-studio-copy-url-source-{}", std::process::id()));
    fs::create_dir_all(&source_dir).unwrap();
    let source_path = source_dir.join("source.gguf");
    fs::write(&source_path, "model bytes").unwrap();
    app.state::<AppState>()
        .approved_read_files
        .lock()
        .await
        .insert(source_path.canonicalize().unwrap());

    copy_file(
        app.handle().clone(),
        app.state(),
        PathPairRequest::Typed {
            source: source_path.to_string_lossy().to_string(),
            destination: "file://copied-url/model.gguf".to_string(),
        },
    )
    .await
    .unwrap();

    assert_eq!(
        fs::read_to_string(app_data.join("copied-url").join("model.gguf")).unwrap(),
        "model bytes"
    );

    let _ = fs::remove_dir_all(source_dir);
    let _ = fs::remove_dir_all(app_data.join("copied-url"));
}

#[tokio::test]
async fn test_copy_file_rejects_destination_outside_app_data() {
    let app = mock_app();
    app.manage(test_app_state());
    let source_dir = std::env::temp_dir().join(format!(
        "ax-studio-copy-source-outside-{}",
        std::process::id()
    ));
    fs::create_dir_all(&source_dir).unwrap();
    let source_path = source_dir.join("source.gguf");
    fs::write(&source_path, "model bytes").unwrap();

    let error = copy_file(
        app.handle().clone(),
        app.state(),
        PathPairRequest::Typed {
            source: source_path.to_string_lossy().to_string(),
            destination: source_dir
                .join("outside.gguf")
                .to_string_lossy()
                .to_string(),
        },
    )
    .await
    .unwrap_err();

    assert!(error.contains("outside app data folder"));
    assert!(!source_dir.join("outside.gguf").exists());

    let _ = fs::remove_dir_all(source_dir);
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

    let legacy_args = file_stat(
        app.handle().clone(),
        FileStatRequest::LegacyArgs {
            args: vec!["file://test_file_stat.txt".to_string()],
        },
    )
    .unwrap();
    assert_eq!(legacy_args.size, 5);

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

#[tokio::test]
async fn test_decompress_extracts_zip_archive_within_app_data_folder() {
    let app = mock_app();
    let app_data = get_app_data_folder_path(app.handle().clone());
    fs::create_dir_all(&app_data).unwrap();
    let archive_path = app_data.join("archive.zip");

    {
        let file = File::create(&archive_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("nested/example.txt", options).unwrap();
        zip.write_all(b"hello from zip").unwrap();
        zip.finish().unwrap();
    }

    decompress(
        app.handle().clone(),
        None,
        None,
        None,
        Some(DecompressRequest::Typed {
            path: "archive.zip".to_string(),
            output_dir: "unzipped".to_string(),
        }),
    )
    .await
    .unwrap();

    let extracted = app_data.join("unzipped").join("nested").join("example.txt");
    assert_eq!(fs::read_to_string(extracted).unwrap(), "hello from zip");
}

#[tokio::test]
async fn test_decompress_rejects_zip_path_traversal_entries() {
    let app = mock_app();
    let app_data = get_app_data_folder_path(app.handle().clone());
    fs::create_dir_all(&app_data).unwrap();
    let archive_path = app_data.join("traversal.zip");

    {
        let file = File::create(&archive_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("../escape.txt", options).unwrap();
        zip.write_all(b"escape").unwrap();
        zip.finish().unwrap();
    }

    let error = decompress(
        app.handle().clone(),
        None,
        None,
        None,
        Some(DecompressRequest::Typed {
            path: "traversal.zip".to_string(),
            output_dir: "unzipped".to_string(),
        }),
    )
    .await
    .unwrap_err();

    assert!(error.contains("Invalid zip entry path"));
}

#[cfg(unix)]
#[tokio::test]
async fn test_decompress_rejects_existing_symlink_directory_escape() {
    use std::os::unix::fs::symlink;

    let app = mock_app();
    let app_data = get_app_data_folder_path(app.handle().clone());
    let output = app_data.join("symlink-output");
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir_all(&output).unwrap();
    symlink(outside.path(), output.join("nested")).unwrap();

    let archive_path = app_data.join("symlink-escape.zip");
    {
        let file = File::create(&archive_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file(
            "nested/escaped.txt",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(b"must stay contained").unwrap();
        zip.finish().unwrap();
    }

    let error = decompress(
        app.handle().clone(),
        None,
        None,
        None,
        Some(DecompressRequest::Typed {
            path: "symlink-escape.zip".to_string(),
            output_dir: "symlink-output".to_string(),
        }),
    )
    .await
    .unwrap_err();
    assert!(error.contains("symlink directory"));
    assert!(!outside.path().join("escaped.txt").exists());

    let _ = fs::remove_file(output.join("nested"));
    let _ = fs::remove_dir_all(output);
    let _ = fs::remove_file(archive_path);
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
        "aGVsbG8=".to_string(),
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

// Network URLs must never pass through the local-filesystem resolver. Treating
// them as PathBuf values lets mutating commands create `https:` directories in
// the process working directory, outside app data.
#[test]
fn test_resolve_path_rejects_all_network_urls() {
    let app = mock_app();
    for url in [
        "https://huggingface.co/some/model.gguf",
        "http://example.com/file.bin",
        "http://localhost/foo",
        "http://127.0.0.1:9999/foo",
        "http://",
    ] {
        assert!(resolve_path(app.handle().clone(), url).is_err(), "{url}");
    }
}

#[cfg(unix)]
#[test]
fn test_resolve_path_rejects_escape_through_deep_symlink_ancestor() {
    use std::os::unix::fs::symlink;

    let app = mock_app();
    let app_data = get_app_data_folder_path(app.handle().clone());
    let outside = tempfile::tempdir().unwrap();
    let link = app_data.join("escape-link");
    let _ = fs::remove_file(&link);
    symlink(outside.path(), &link).unwrap();

    let escaped = link.join("missing").join("file.txt");
    assert!(resolve_path(app.handle().clone(), &escaped.to_string_lossy()).is_err());

    let _ = fs::remove_file(link);
}

// ─── decompress: tar.gz extraction safety ───────────────────────────────────
//
// The zip extraction path already has coverage in test_decompress_extracts_*
// above. These tests fill the tar.gz gap: happy-path extraction and
// path-traversal rejection. Symlink + hardlink handling are also part of
// the tar code path but require more involved archive construction; not
// covered here (flagged as a follow-up).

/// Build an in-memory tar.gz archive with a single regular file entry.
/// Used by the tar.gz happy-path test.
fn make_tar_gz_with_file(entry_path: &str, contents: &[u8]) -> Vec<u8> {
    let buffer: Vec<u8> = Vec::new();
    let encoder = flate2::write::GzEncoder::new(buffer, flate2::Compression::default());
    let mut builder = tar::Builder::new(encoder);

    let mut header = tar::Header::new_gnu();
    header.set_path(entry_path).unwrap();
    header.set_size(contents.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder.append(&header, contents).unwrap();

    let encoder = builder.into_inner().unwrap();
    encoder.finish().unwrap()
}

#[tokio::test]
async fn test_decompress_extracts_targz_within_app_data_folder() {
    let app = mock_app();
    let app_data = get_app_data_folder_path(app.handle().clone());

    // Place the archive inside the app data folder (decompress requires this).
    let archive_rel = "test_targz_happy/archive.tar.gz";
    let archive_abs = app_data.join(archive_rel);
    fs::create_dir_all(archive_abs.parent().unwrap()).unwrap();

    let archive_bytes = make_tar_gz_with_file("payload.txt", b"hello tar");
    File::create(&archive_abs)
        .unwrap()
        .write_all(&archive_bytes)
        .unwrap();

    let output_rel = "test_targz_happy/out";
    let request = DecompressRequest::Typed {
        path: archive_rel.to_string(),
        output_dir: output_rel.to_string(),
    };
    decompress(app.handle().clone(), None, None, None, Some(request))
        .await
        .unwrap();

    let extracted = app_data.join(output_rel).join("payload.txt");
    assert!(
        extracted.exists(),
        "tar.gz payload must be extracted to output dir"
    );
    let got = fs::read_to_string(&extracted).unwrap();
    assert_eq!(got, "hello tar");

    let _ = fs::remove_dir_all(app_data.join("test_targz_happy"));
}

// Note on tar.gz path-traversal coverage:
//
// The production code's tar extraction has a `path traversal blocked`
// check at the entry level (commands.rs, decompress()), symmetric with
// the zip check that's already covered by
// `test_decompress_rejects_zip_path_traversal_entries`. We don't add an
// equivalent tar-side test because constructing a malicious tar archive
// in Rust requires bypassing the `tar` crate's own write-side safety
// (it rejects entry paths containing `..` at archive-creation time).
// Doing that cleanly needs raw byte manipulation of tar headers, which
// is outside the scope of a unit test. The path-traversal LOGIC is
// shared with the zip path and covered there.

#[tokio::test]
async fn test_decompress_rejects_unsupported_format() {
    let app = mock_app();
    let app_data = get_app_data_folder_path(app.handle().clone());

    let archive_rel = "test_bad_format/archive.7z";
    let archive_abs = app_data.join(archive_rel);
    fs::create_dir_all(archive_abs.parent().unwrap()).unwrap();
    File::create(&archive_abs)
        .unwrap()
        .write_all(b"not a real 7z")
        .unwrap();

    let output_rel = "test_bad_format/out";
    let request = DecompressRequest::Typed {
        path: archive_rel.to_string(),
        output_dir: output_rel.to_string(),
    };
    let result = decompress(app.handle().clone(), None, None, None, Some(request)).await;

    assert!(result.is_err(), ".7z must be rejected as unsupported");
    assert!(result.unwrap_err().contains("Unsupported file format"));

    let _ = fs::remove_dir_all(app_data.join("test_bad_format"));
}

#[tokio::test]
async fn test_decompress_rejects_archive_path_outside_app_data() {
    let app = mock_app();

    // Archive path resolves outside the app data folder via .. — must be blocked
    // BEFORE the archive is even opened.
    let request = DecompressRequest::Typed {
        path: "../../etc/passwd.tar.gz".to_string(),
        output_dir: "outdir".to_string(),
    };
    let result = decompress(app.handle().clone(), None, None, None, Some(request)).await;
    assert!(
        result.is_err(),
        "archive path outside app_data must be rejected"
    );
    assert!(
        result.unwrap_err().contains("not under app_data_folder"),
        "error must mention app_data containment"
    );
}
