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

#[test]
fn test_decompress_extracts_zip_archive_within_app_data_folder() {
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

// ─── resolve_path URL branch (SSRF protection) ─────────────────────────────
//
// resolve_path accepts http/https URLs as a special case (used for model
// download URLs that don't live in app_data). The implementation MUST reject
// any URL pointing at the host's internal networks so a malicious config
// can't trick the app into fetching from localhost / private LAN.

#[test]
fn test_resolve_path_accepts_clean_external_https_url() {
    let app = mock_app();
    let url = "https://huggingface.co/some/model.gguf";
    let result = resolve_path(app.handle().clone(), url).unwrap();
    // External URLs pass through unchanged (no canonicalize, no
    // app_data prefix).
    assert_eq!(result, PathBuf::from(url));
}

#[test]
fn test_resolve_path_accepts_clean_external_http_url() {
    let app = mock_app();
    let url = "http://example.com/file.bin";
    let result = resolve_path(app.handle().clone(), url).unwrap();
    assert_eq!(result, PathBuf::from(url));
}

#[test]
fn test_resolve_path_rejects_localhost_domain() {
    let app = mock_app();
    let result = resolve_path(app.handle().clone(), "http://localhost/foo");
    assert!(result.is_err(), "localhost domain must be rejected");
    let err = result.unwrap_err();
    assert!(
        err.contains("localhost"),
        "error should mention localhost, got: {err}"
    );
}

#[test]
fn test_resolve_path_rejects_ipv4_loopback() {
    let app = mock_app();
    let result = resolve_path(app.handle().clone(), "http://127.0.0.1:9999/foo");
    assert!(result.is_err(), "127.0.0.1 must be rejected");
    assert!(result.unwrap_err().contains("internal networks"));
}

#[test]
fn test_resolve_path_rejects_ipv4_private_10_dot() {
    let app = mock_app();
    let result = resolve_path(app.handle().clone(), "http://10.0.0.1/foo");
    assert!(result.is_err(), "10.x private range must be rejected");
}

#[test]
fn test_resolve_path_rejects_ipv4_private_192_168() {
    let app = mock_app();
    let result = resolve_path(app.handle().clone(), "http://192.168.1.1/foo");
    assert!(result.is_err(), "192.168.x private range must be rejected");
}

#[test]
fn test_resolve_path_rejects_ipv4_private_172_16() {
    let app = mock_app();
    let result = resolve_path(app.handle().clone(), "http://172.16.0.1/foo");
    assert!(result.is_err(), "172.16/12 private range must be rejected");
}

#[test]
fn test_resolve_path_rejects_unspecified_address() {
    let app = mock_app();
    let result = resolve_path(app.handle().clone(), "http://0.0.0.0/foo");
    assert!(result.is_err(), "0.0.0.0 unspecified must be rejected");
}

#[test]
fn test_resolve_path_rejects_invalid_url() {
    let app = mock_app();
    // Starts with "http://" so it takes the URL branch, but isn't a valid URL.
    let result = resolve_path(app.handle().clone(), "http://");
    assert!(result.is_err(), "malformed URL must be rejected");
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

#[test]
fn test_decompress_extracts_targz_within_app_data_folder() {
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
    decompress(app.handle().clone(), None, None, None, Some(request)).unwrap();

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

#[test]
fn test_decompress_rejects_unsupported_format() {
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
    let result = decompress(app.handle().clone(), None, None, None, Some(request));

    assert!(result.is_err(), ".7z must be rejected as unsupported");
    assert!(result.unwrap_err().contains("Unsupported file format"));

    let _ = fs::remove_dir_all(app_data.join("test_bad_format"));
}

#[test]
fn test_decompress_rejects_archive_path_outside_app_data() {
    let app = mock_app();

    // Archive path resolves outside the app data folder via .. — must be blocked
    // BEFORE the archive is even opened.
    let request = DecompressRequest::Typed {
        path: "../../etc/passwd.tar.gz".to_string(),
        output_dir: "outdir".to_string(),
    };
    let result = decompress(app.handle().clone(), None, None, None, Some(request));
    assert!(
        result.is_err(),
        "archive path outside app_data must be rejected"
    );
    assert!(
        result.unwrap_err().contains("not under app_data_folder"),
        "error must mention app_data containment"
    );
}
