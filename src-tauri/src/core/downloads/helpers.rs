pub use super::http_client::{
    _get_client_for_item, _get_file_size, _get_maybe_resume_with_fallback,
};
use super::models::{DownloadEvent, DownloadItem, ProgressTracker};
use super::policy::redact_url_for_log;
pub use super::policy::{
    _convert_headers, err_to_string, validate_download_request, validate_download_task_id,
};
#[cfg(test)]
pub use super::policy::{create_proxy_from_config, should_bypass_proxy, validate_proxy_config};
#[cfg(test)]
use super::{
    http_client::{content_range_start, same_origin},
    models::ProxyConfig,
    policy::{
        validate_download_url, MAX_DOWNLOAD_HEADERS, MAX_DOWNLOAD_HEADER_BYTES, MAX_DOWNLOAD_ITEMS,
    },
};
use crate::core::app::commands::get_app_data_folder_path;
use crate::core::hf_cache;
use ax_studio_utils::normalize_path;
use futures_util::{future::join_all, StreamExt};
use reqwest::header::HeaderMap;
#[cfg(test)]
use reqwest::header::HeaderValue;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Runtime};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
#[cfg(test)]
use url::Url;

pub fn download_destination_key(path: &Path) -> String {
    if cfg!(any(target_os = "macos", windows)) {
        // Default macOS and Windows filesystems are case-insensitive even
        // though PathBuf equality is not. Treat case variants as one writer.
        path.to_string_lossy().to_lowercase()
    } else {
        path.to_string_lossy().into_owned()
    }
}

fn ensure_unique_download_paths(paths: &[PathBuf]) -> Result<(), String> {
    let mut seen = HashSet::with_capacity(paths.len());
    for path in paths {
        let identity = download_destination_key(path);
        if !seen.insert(identity) {
            return Err(format!(
                "Download request contains duplicate destination: {}",
                path.display()
            ));
        }
    }
    Ok(())
}

pub fn resolve_download_destinations<R: Runtime>(
    app: &tauri::AppHandle<R>,
    items: &[DownloadItem],
) -> Result<Vec<PathBuf>, String> {
    let paths = items
        .iter()
        .map(|item| resolve_download_save_path(app, &item.save_path))
        .collect::<Result<Vec<_>, _>>()?;
    ensure_unique_download_paths(&paths)?;
    Ok(paths)
}

/// Validates a downloaded file against expected hash and size
async fn validate_downloaded_file(
    item: &DownloadItem,
    save_path: &Path,
    app: &tauri::AppHandle<impl Runtime>,
    cancel_token: &CancellationToken,
    emit_event: bool,
) -> Result<(), String> {
    // Skip validation if no verification data is provided
    if item.sha256.is_none() && item.size.is_none() {
        log::debug!(
            "No validation data provided for {}, skipping validation",
            redact_url_for_log(&item.url)
        );
        return Ok(());
    }

    // Use model_id from item if available, otherwise extract from save path

    let model_id = item.model_id.as_deref().unwrap_or_else(|| {
        save_path
            .parent() // get parent directory (modelId folder)
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
    });

    if emit_event {
        app.emit(
            "onModelValidationStarted",
            serde_json::json!({
                "modelId": model_id,
                "downloadType": "Model",
            }),
        )
        .ok();
        log::info!("Starting validation for model: {model_id}");
    }

    // Validate size if provided (fast check first)
    if let Some(expected_size) = &item.size {
        log::info!(
            "Starting size verification for {}",
            redact_url_for_log(&item.url)
        );

        match tokio::fs::metadata(save_path).await {
            Ok(metadata) => {
                let actual_size = metadata.len();

                if actual_size != *expected_size {
                    log::error!(
                        "Size verification failed for {}. Expected: {} bytes, Actual: {} bytes",
                        redact_url_for_log(&item.url),
                        expected_size,
                        actual_size
                    );
                    return Err(format!(
                        "Size verification failed. Expected {expected_size} bytes but got {actual_size} bytes."
                    ));
                }

                log::info!(
                    "Size verification successful for {} ({} bytes)",
                    redact_url_for_log(&item.url),
                    actual_size
                );
            }
            Err(e) => {
                log::error!(
                    "Failed to get file metadata for {}: {}",
                    save_path.display(),
                    e
                );
                return Err(format!("Failed to verify file size: {e}"));
            }
        }
    }

    // Check for cancellation before expensive hash computation
    if cancel_token.is_cancelled() {
        log::info!("Validation cancelled for {}", redact_url_for_log(&item.url));
        return Err("Validation cancelled".to_string());
    }

    // Validate hash if provided (expensive check second)
    if let Some(expected_sha256) = &item.sha256 {
        log::info!(
            "Starting hash verification for {}",
            redact_url_for_log(&item.url)
        );

        match ax_studio_utils::crypto::compute_file_sha256_with_cancellation(
            save_path,
            cancel_token,
        )
        .await
        {
            Ok(computed_sha256) => {
                if !computed_sha256.eq_ignore_ascii_case(expected_sha256) {
                    log::error!(
                        "Hash verification failed for {}. Expected: {}, Computed: {}",
                        redact_url_for_log(&item.url),
                        expected_sha256,
                        computed_sha256
                    );

                    return Err("Hash verification failed. The downloaded file is corrupted or has been tampered with.".to_string());
                }

                log::info!(
                    "Hash verification successful for {}",
                    redact_url_for_log(&item.url)
                );
            }
            Err(e) => {
                log::error!(
                    "Failed to compute SHA256 for {}: {}",
                    save_path.display(),
                    e
                );
                return Err(format!("Failed to verify file integrity: {e}"));
            }
        }
    }

    log::info!(
        "All validations passed for {}",
        redact_url_for_log(&item.url)
    );
    Ok(())
}

pub fn resolve_download_save_path<R: Runtime>(
    app: &tauri::AppHandle<R>,
    save_path: &str,
) -> Result<std::path::PathBuf, String> {
    let app_data_folder_raw = get_app_data_folder_path(app.clone());
    let app_data_folder = normalize_path(
        &app_data_folder_raw
            .canonicalize()
            .unwrap_or_else(|_| app_data_folder_raw.clone()),
    );
    let raw_path = std::path::PathBuf::from(save_path);

    if raw_path.is_absolute() {
        let normalized = hf_cache::normalize_existing_or_parent(&raw_path);
        if normalized.starts_with(&app_data_folder) || hf_cache::is_within_cache(&normalized) {
            return Ok(normalized);
        }

        return Err(format!(
            "Path {} is outside allowed download roots: AX Studio data folder {} or Hugging Face cache {}",
            normalized.display(),
            app_data_folder.display(),
            hf_cache::cache_root()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| "<unavailable>".to_string())
        ));
    }

    let save_path_raw = app_data_folder.join(save_path);
    let save_path = hf_cache::normalize_existing_or_parent(&save_path_raw);
    if !save_path.starts_with(&app_data_folder) {
        return Err(format!(
            "Path {} is outside of AX Studio data folder {}",
            save_path.display(),
            app_data_folder.display()
        ));
    }

    Ok(save_path)
}

// ===== MAIN DOWNLOAD FUNCTIONS =====

// Context passed to `download_single_file` to reduce the number of arguments
struct DownloadCtx {
    header_map: HeaderMap,
    resume: bool,
    cancel_token: CancellationToken,
    evt_name: String,
    progress_tracker: ProgressTracker,
    task_id: String,
    model_id: Option<String>,
    emit_validation_event: bool,
}

/// Downloads multiple files in parallel with individual progress tracking
pub async fn _download_files_internal(
    app: tauri::AppHandle<impl Runtime>,
    items: &[DownloadItem],
    headers: &HashMap<String, String>,
    task_id: &str,
    resume: bool,
    cancel_token: CancellationToken,
) -> Result<(), String> {
    log::info!("Start download task: {task_id}");

    validate_download_request(items, task_id, headers)?;

    // Resolve every destination before the first network request. This makes
    // root enforcement deterministic and prevents duplicate writers from
    // racing against the same .tmp/final path.
    let resolved_paths = resolve_download_destinations(&app, items)?;

    let header_map = _convert_headers(headers).map_err(err_to_string)?;

    // Calculate sizes for each file concurrently
    let size_futures = items
        .iter()
        .map(|item| {
            let item_url = item.url.clone();
            let header_map = header_map.clone();
            async move {
                let client = _get_client_for_item(item, &header_map).map_err(err_to_string)?;
                // HEAD size is only an estimate the GET path later refines; a failed or
                // slow HEAD (common on HuggingFace CDN) must not abort the whole batch.
                let size = _get_file_size(&client, &item_url, &header_map)
                    .await
                    .unwrap_or(0);
                Ok::<_, String>((item_url, size))
            }
        })
        .collect::<Vec<_>>();

    let size_results = join_all(size_futures).await;
    let mut file_sizes = HashMap::new();
    for result in size_results {
        let (url, size) = result?;
        file_sizes.insert(url, size);
    }

    let total_size = file_sizes
        .values()
        .fold(0u64, |total, size| total.saturating_add(*size));
    log::info!("Total download size from HEAD: {total_size} bytes");

    let evt_name = format!("download-{task_id}");

    // Build a file_id → HEAD-based size map for the progress tracker.
    // The tracker will refine these values from the actual GET response
    // Content-Length inside download_single_file.
    let file_id_sizes: HashMap<String, u64> = items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let file_id = format!("{task_id}-{index}");
            let size = file_sizes.get(&item.url).copied().unwrap_or(0);
            (file_id, size)
        })
        .collect();

    let progress_tracker = ProgressTracker::new(file_id_sizes);

    // Extract model_id from items for event identification
    let download_model_id = items
        .iter()
        .find_map(|item| item.model_id.as_ref())
        .map(|s| s.to_string())
        .or_else(|| {
            items.first().and_then(|item| {
                std::path::Path::new(&item.save_path)
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string())
            })
        });
    let validation_event_index = items
        .iter()
        .position(|item| item.sha256.is_some() || item.size.is_some());

    // Collect download tasks for parallel execution
    let mut download_tasks = Vec::new();

    for (index, (item, save_path)) in items.iter().zip(resolved_paths).enumerate() {
        // Spawn download task for each file
        let item_clone = item.clone();
        let app_clone = app.clone();
        let file_id = format!("{task_id}-{index}");
        let file_size = file_sizes.get(&item.url).copied().unwrap_or(0);

        let ctx = DownloadCtx {
            header_map: header_map.clone(),
            resume,
            cancel_token: cancel_token.clone(),
            evt_name: evt_name.clone(),
            progress_tracker: progress_tracker.clone(),
            task_id: task_id.to_string(),
            model_id: download_model_id.clone(),
            emit_validation_event: validation_event_index == Some(index),
        };
        let failure_token = cancel_token.clone();

        let task = tokio::spawn(async move {
            let result =
                download_single_file(app_clone, &item_clone, &save_path, file_id, file_size, ctx)
                    .await;
            if result.is_err() {
                // One failed shard makes the batch unusable; stop sibling
                // transfers promptly and then await them below for cleanup.
                failure_token.cancel();
            }
            result
        });

        download_tasks.push(task);
    }

    // Join every spawned task even after the first error. Dropping a JoinHandle
    // detaches it, which previously allowed a sibling writer to commit after
    // the batch had already returned failure.
    let mut first_error = None;
    let mut prepared_downloads = Vec::with_capacity(items.len());
    for result in join_all(download_tasks).await {
        match result {
            Ok(Ok(prepared)) => prepared_downloads.push(prepared),
            Ok(Err(error)) => {
                // Prefer the causal transfer/validation failure over sibling
                // cancellation noise regardless of item ordering.
                if first_error.is_none()
                    || (first_error.as_deref() == Some("Download cancelled")
                        && error != "Download cancelled")
                {
                    first_error = Some(error);
                }
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(format!("Task join error: {error}"));
                }
            }
        }
    }
    if let Some(error) = first_error {
        for prepared in prepared_downloads {
            cleanup_partial_download(&prepared.tmp_path, &prepared.url_path, false).await;
        }
        return Err(error);
    }

    if cancel_token.is_cancelled() {
        for prepared in prepared_downloads {
            cleanup_partial_download(&prepared.tmp_path, &prepared.url_path, false).await;
        }
        return Err("Download cancelled".to_string());
    }

    // No final destination is touched until every shard has downloaded and
    // passed verification. This prevents mixed-version model directories when
    // a later shard fails.
    for index in 0..prepared_downloads.len() {
        let prepared = &prepared_downloads[index];
        if let Err(error) = commit_download_file(&prepared.tmp_path, &prepared.final_path).await {
            for pending in &prepared_downloads[index..] {
                cleanup_partial_download(&pending.tmp_path, &pending.url_path, false).await;
            }
            return Err(error);
        }
        if let Err(error) = tokio::fs::remove_file(&prepared.url_path).await {
            log::warn!("Failed to remove .url sidecar after download: {error}");
        }
        log::info!("Finished downloading: {}", prepared.display_url);
    }

    // Emit final progress
    let (transferred, total) = progress_tracker.get_total_progress().await;
    let final_evt = DownloadEvent {
        transferred,
        total,
        download_id: Some(task_id.to_string()),
        model_id: download_model_id.clone(),
    };
    app.emit(&evt_name, final_evt).ok();
    Ok(())
}

fn with_appended_extension(path: &Path, suffix: &str) -> PathBuf {
    let current_extension = path.extension().unwrap_or_default().to_string_lossy();
    if current_extension.is_empty() {
        path.with_extension(suffix)
    } else {
        path.with_extension(format!("{current_extension}.{suffix}"))
    }
}

async fn cleanup_partial_download(tmp_path: &Path, url_path: &Path, preserve_resume: bool) {
    if preserve_resume {
        // A resumable partial requires both files. Keeping only the .tmp while
        // deleting the URL sidecar silently disables resume on the next attempt.
        return;
    }
    let _ = tokio::fs::remove_file(tmp_path).await;
    let _ = tokio::fs::remove_file(url_path).await;
}

#[cfg(windows)]
fn replace_file_windows(tmp_path: &Path, final_path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

    let final_wide = final_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let tmp_wide = tmp_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        ReplaceFileW(
            final_wide.as_ptr(),
            tmp_wide.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_WRITE_THROUGH,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

async fn commit_download_file(tmp_path: &Path, final_path: &Path) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        // POSIX rename atomically replaces an existing destination, preserving
        // the verified old file until the new one is ready to commit.
        tokio::fs::rename(tmp_path, final_path)
            .await
            .map_err(err_to_string)
    }

    #[cfg(windows)]
    {
        // std/tokio rename cannot replace an existing file on Windows. The OS
        // primitive preserves the old destination unless the replacement can
        // be committed atomically and flushes the operation before returning.
        if !final_path.exists() {
            return tokio::fs::rename(tmp_path, final_path)
                .await
                .map_err(err_to_string);
        }
        let tmp_path = tmp_path.to_path_buf();
        let final_path = final_path.to_path_buf();
        tokio::task::spawn_blocking(move || replace_file_windows(&tmp_path, &final_path))
            .await
            .map_err(|error| format!("Download commit task failed: {error}"))?
            .map_err(err_to_string)
    }
}

struct PreparedDownload {
    tmp_path: PathBuf,
    url_path: PathBuf,
    final_path: PathBuf,
    display_url: String,
}

/// Downloads, validates, and transactionally commits one file.
async fn download_single_file(
    app: tauri::AppHandle<impl Runtime>,
    item: &DownloadItem,
    save_path: &std::path::Path,
    file_id: String,
    _file_size: u64,
    ctx: DownloadCtx,
) -> Result<PreparedDownload, String> {
    let DownloadCtx {
        header_map,
        resume,
        cancel_token,
        evt_name,
        progress_tracker,
        task_id,
        model_id,
        emit_validation_event,
    } = ctx;
    // Create parent directories if they don't exist
    if let Some(parent) = save_path.parent() {
        if !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(err_to_string)?;
        }
    }

    let tmp_save_path = with_appended_extension(save_path, "tmp");
    let url_save_path = with_appended_extension(save_path, "url");

    let mut should_resume = resume
        && tmp_save_path.exists()
        && tokio::fs::read_to_string(&url_save_path)
            .await
            .map(|url| url == item.url) // check if we resume the same URL
            .unwrap_or(false);

    let client = _get_client_for_item(item, &header_map).map_err(err_to_string)?;
    tokio::fs::write(&url_save_path, item.url.clone())
        .await
        .map_err(err_to_string)?;

    log::info!("Started downloading: {}", redact_url_for_log(&item.url));
    let mut download_delta = 0u64;
    let mut initial_progress = 0u64;

    let had_resume_state = should_resume;
    let response_result = if should_resume {
        let downloaded_size = tmp_save_path.metadata().map_err(err_to_string)?.len();
        match _get_maybe_resume_with_fallback(&client, &item.url, downloaded_size, &header_map)
            .await
        {
            Ok(response) => {
                log::info!(
                    "Resume download: {}, already downloaded {} bytes",
                    redact_url_for_log(&item.url),
                    downloaded_size
                );
                initial_progress = downloaded_size;
                Ok(response)
            }
            Err(e) => {
                // fallback to normal download with proxy support
                log::warn!("Failed to resume download: {e}");
                should_resume = false;
                _get_maybe_resume_with_fallback(&client, &item.url, 0, &header_map).await
            }
        }
    } else {
        // Use mirror fallback for new downloads
        _get_maybe_resume_with_fallback(&client, &item.url, 0, &header_map).await
    };
    let (resp, _actual_url) = match response_result {
        Ok(response) => response,
        Err(error) => {
            cleanup_partial_download(&tmp_save_path, &url_save_path, had_resume_state).await;
            return Err(error);
        }
    };

    // Refine the expected file size from the actual GET/206 response Content-Length.
    // The HEAD-based estimate from _get_file_size can be 0 when HuggingFace CDN
    // omits the Content-Length header on HEAD requests.  The GET response is
    // much more reliable.
    //   • New download  : Content-Length = full file size
    //   • Resumed download: Content-Length = remaining bytes → total = initial + remaining
    if let Some(content_length) = resp.content_length() {
        if content_length > 0 {
            let full_size = initial_progress.saturating_add(content_length);
            progress_tracker.set_file_total(&file_id, full_size).await;
            log::info!("File size from GET Content-Length: {full_size} bytes");
        }
    }

    // Emit an initial progress event now that we have an accurate total.
    // This replaces "Initializing download..." in the UI with "0.00 / X.XX GB (0%)"
    // as soon as the download connection is established.
    progress_tracker
        .update_progress(&file_id, initial_progress)
        .await;
    let (init_transferred, init_total) = progress_tracker.get_total_progress().await;
    let _ = app.emit(
        &evt_name,
        DownloadEvent {
            transferred: init_transferred,
            total: init_total,
            download_id: Some(task_id.clone()),
            model_id: model_id.clone(),
        },
    );

    let mut stream = resp.bytes_stream();

    let file_result = if should_resume {
        // resume download, append to existing file
        tokio::fs::OpenOptions::new()
            .write(true)
            .append(true)
            .open(&tmp_save_path)
            .await
    } else {
        // start new download, create a new file
        File::create(&tmp_save_path).await
    };
    let file = match file_result {
        Ok(file) => file,
        Err(error) => {
            cleanup_partial_download(&tmp_save_path, &url_save_path, had_resume_state).await;
            return Err(err_to_string(error));
        }
    };
    let mut writer = tokio::io::BufWriter::new(file);
    let mut total_transferred = initial_progress;

    // Write chunks using select! so cancellation is immediate rather than
    // waiting for the next chunk to arrive from a slow server.
    loop {
        let maybe_chunk = tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                drop(writer);
                cleanup_partial_download(&tmp_save_path, &url_save_path, should_resume).await;
                log::info!("Download cancelled: {}", redact_url_for_log(&item.url));
                return Err("Download cancelled".to_string());
            }
            chunk = stream.next() => chunk,
        };

        let chunk = match maybe_chunk {
            None => break,
            Some(Err(e)) => {
                drop(writer);
                cleanup_partial_download(&tmp_save_path, &url_save_path, true).await;
                return Err(err_to_string(e));
            }
            Some(Ok(c)) => c,
        };

        if let Err(e) = writer.write_all(&chunk).await {
            drop(writer);
            cleanup_partial_download(&tmp_save_path, &url_save_path, true).await;
            return Err(err_to_string(e));
        }

        download_delta += chunk.len() as u64;
        total_transferred = total_transferred.saturating_add(chunk.len() as u64);

        if item
            .size
            .is_some_and(|expected_size| total_transferred > expected_size)
        {
            drop(writer);
            cleanup_partial_download(&tmp_save_path, &url_save_path, false).await;
            return Err("Downloaded data exceeds the expected file size".to_string());
        }

        // Update progress every 1 MB for responsive UI
        if download_delta >= 1024 * 1024 {
            progress_tracker
                .update_progress(&file_id, total_transferred)
                .await;

            let (combined_transferred, combined_total) =
                progress_tracker.get_total_progress().await;
            let evt = DownloadEvent {
                transferred: combined_transferred,
                total: combined_total,
                download_id: Some(task_id.clone()),
                model_id: model_id.clone(),
            };
            app.emit(&evt_name, evt).ok();

            download_delta = 0u64;
        }
    }

    if let Err(e) = writer.flush().await {
        drop(writer);
        cleanup_partial_download(&tmp_save_path, &url_save_path, true).await;
        return Err(err_to_string(e));
    }
    drop(writer);

    if cancel_token.is_cancelled() {
        cleanup_partial_download(&tmp_save_path, &url_save_path, false).await;
        return Err("Download cancelled".to_string());
    }

    // Validate the temporary file before touching an existing verified final
    // destination. A bad hash/size can no longer delete the user's old model.
    if let Err(error) = validate_downloaded_file(
        item,
        &tmp_save_path,
        &app,
        &cancel_token,
        emit_validation_event,
    )
    .await
    {
        cleanup_partial_download(&tmp_save_path, &url_save_path, false).await;
        return Err(error);
    }

    if cancel_token.is_cancelled() {
        cleanup_partial_download(&tmp_save_path, &url_save_path, false).await;
        return Err("Download cancelled".to_string());
    }

    // Final progress update for this file
    progress_tracker
        .update_progress(&file_id, total_transferred)
        .await;

    // Emit final combined progress
    let (combined_transferred, combined_total) = progress_tracker.get_total_progress().await;
    let evt = DownloadEvent {
        transferred: combined_transferred,
        total: combined_total,
        download_id: Some(task_id.clone()),
        model_id: model_id.clone(),
    };
    app.emit(&evt_name, evt).ok();

    Ok(PreparedDownload {
        tmp_path: tmp_save_path,
        url_path: url_save_path,
        final_path: save_path.to_path_buf(),
        display_url: redact_url_for_log(&item.url),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_download_item() -> DownloadItem {
        DownloadItem {
            url: "https://example.com/model.gguf".to_string(),
            save_path: "models/model.gguf".to_string(),
            proxy: None,
            sha256: None,
            size: None,
            model_id: Some("org/model".to_string()),
        }
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ax-studio-download-{name}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    // --- err_to_string ---

    #[test]
    fn test_err_to_string() {
        let result = err_to_string("something failed");
        assert_eq!(result, "Error: something failed");
    }

    #[test]
    fn test_err_to_string_with_io_error() {
        let err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let result = err_to_string(err);
        assert!(result.starts_with("Error: "));
        assert!(result.contains("file missing"));
    }

    // --- privileged request boundary ---

    #[test]
    fn test_validate_download_request_accepts_well_formed_payload() {
        let item = test_download_item();
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), "Bearer token".to_string());

        assert!(validate_download_request(&[item], "model-download_1", &headers).is_ok());
    }

    #[test]
    fn test_validate_download_request_rejects_empty_or_oversized_batches() {
        assert!(validate_download_request(&[], "task", &HashMap::new()).is_err());

        let items = vec![test_download_item(); MAX_DOWNLOAD_ITEMS + 1];
        let error = validate_download_request(&items, "task", &HashMap::new()).unwrap_err();
        assert!(error.contains("batch limit"));
    }

    #[test]
    fn test_validate_download_request_rejects_invalid_task_ids() {
        let items = [test_download_item()];
        for task_id in ["", "model/download", "contains space", "dots.are.fragile"] {
            assert!(
                validate_download_request(&items, task_id, &HashMap::new()).is_err(),
                "{task_id:?} should be rejected"
            );
        }
    }

    #[test]
    fn test_validate_download_request_rejects_bad_hashes_and_paths() {
        let mut bad_hash = test_download_item();
        bad_hash.sha256 = Some("abc123".to_string());
        assert!(validate_download_request(&[bad_hash], "task", &HashMap::new()).is_err());

        let mut bad_path = test_download_item();
        bad_path.save_path = "models/\0model.gguf".to_string();
        assert!(validate_download_request(&[bad_path], "task", &HashMap::new()).is_err());

        let mut insecure = test_download_item();
        insecure.proxy = Some(ProxyConfig {
            url: "https://proxy.example.com".to_string(),
            username: None,
            password: None,
            no_proxy: None,
            ignore_ssl: Some(true),
        });
        assert!(validate_download_request(&[insecure], "task", &HashMap::new()).is_err());
    }

    #[test]
    fn test_validate_download_url_blocks_credentials_and_non_global_targets() {
        for url in [
            "https://user:password@example.com/model",
            "http://127.0.0.1/model",
            "http://[::ffff:192.168.1.2]/model",
            "http://localhost./model",
            "http://metadata.service.internal/model",
            "file:///etc/passwd",
        ] {
            assert!(
                validate_download_url(url).is_err(),
                "{url} should be rejected"
            );
        }
        assert!(validate_download_url("https://example.com/model").is_ok());
    }

    #[test]
    fn test_redact_url_for_log_removes_credentials_query_and_fragment() {
        let redacted = redact_url_for_log(
            "https://user:secret@example.com/model?X-Amz-Signature=secret#fragment",
        );
        assert_eq!(redacted, "https://example.com/model?[REDACTED]");
        assert!(!redacted.contains("secret"));
        assert!(!redacted.contains("user"));
    }

    #[test]
    fn test_duplicate_download_destinations_are_rejected() {
        let paths = [
            PathBuf::from("/tmp/model.gguf"),
            PathBuf::from("/tmp/model.gguf"),
        ];
        assert!(ensure_unique_download_paths(&paths).is_err());
    }

    #[cfg(any(target_os = "macos", windows))]
    #[test]
    fn test_case_variant_destinations_are_rejected_on_case_insensitive_platforms() {
        let paths = [
            PathBuf::from("/tmp/Model.gguf"),
            PathBuf::from("/tmp/model.gguf"),
        ];
        assert!(ensure_unique_download_paths(&paths).is_err());
    }

    #[test]
    fn test_content_range_start_requires_well_formed_byte_range() {
        let mut headers = HeaderMap::new();
        headers.insert(
            reqwest::header::CONTENT_RANGE,
            HeaderValue::from_static("bytes 1024-2047/4096"),
        );
        assert_eq!(content_range_start(&headers), Some(1024));

        headers.insert(
            reqwest::header::CONTENT_RANGE,
            HeaderValue::from_static("items 1-2/3"),
        );
        assert_eq!(content_range_start(&headers), None);
    }

    #[test]
    fn test_same_origin_includes_effective_port_and_scheme() {
        let base = Url::parse("https://example.com/path").unwrap();
        assert!(same_origin(
            &base,
            &Url::parse("https://example.com:443/other").unwrap()
        ));
        assert!(!same_origin(
            &base,
            &Url::parse("https://cdn.example.com/path").unwrap()
        ));
        assert!(!same_origin(
            &base,
            &Url::parse("http://example.com/path").unwrap()
        ));
    }

    #[tokio::test]
    async fn test_partial_cleanup_preserves_complete_resume_state_or_removes_both() {
        let dir = unique_test_dir("cleanup");
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let tmp = dir.join("model.gguf.tmp");
        let url = dir.join("model.gguf.url");
        tokio::fs::write(&tmp, b"partial").await.unwrap();
        tokio::fs::write(&url, b"https://example.com/model")
            .await
            .unwrap();

        cleanup_partial_download(&tmp, &url, true).await;
        assert!(tmp.exists());
        assert!(url.exists());

        cleanup_partial_download(&tmp, &url, false).await;
        assert!(!tmp.exists());
        assert!(!url.exists());
        let _ = tokio::fs::remove_dir_all(dir).await;
    }

    #[tokio::test]
    async fn test_commit_replaces_existing_file_only_after_temp_is_ready() {
        let dir = unique_test_dir("commit");
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let final_path = dir.join("model.gguf");
        let tmp_path = dir.join("model.gguf.tmp");
        tokio::fs::write(&final_path, b"verified-old")
            .await
            .unwrap();
        tokio::fs::write(&tmp_path, b"verified-new").await.unwrap();

        commit_download_file(&tmp_path, &final_path).await.unwrap();

        assert_eq!(tokio::fs::read(&final_path).await.unwrap(), b"verified-new");
        assert!(!tmp_path.exists());
        let _ = tokio::fs::remove_dir_all(dir).await;
    }

    // --- validate_proxy_config ---

    #[test]
    fn test_validate_proxy_config_valid_http() {
        let config = ProxyConfig {
            url: "http://proxy.example.com:8080".to_string(),
            username: None,
            password: None,
            no_proxy: None,
            ignore_ssl: None,
        };
        assert!(validate_proxy_config(&config).is_ok());
    }

    #[test]
    fn test_validate_proxy_config_rejects_unsupported_socks5() {
        let config = ProxyConfig {
            url: "socks5://proxy.example.com:1080".to_string(),
            username: Some("user".to_string()),
            password: Some("pass".to_string()),
            no_proxy: None,
            ignore_ssl: None,
        };
        assert!(validate_proxy_config(&config).is_err());
    }

    #[test]
    fn test_validate_proxy_config_invalid_url() {
        let config = ProxyConfig {
            url: "not-a-url".to_string(),
            username: None,
            password: None,
            no_proxy: None,
            ignore_ssl: None,
        };
        assert!(validate_proxy_config(&config).is_err());
    }

    #[test]
    fn test_validate_proxy_config_rejects_embedded_credentials() {
        let config = ProxyConfig {
            url: "http://user:secret@proxy.example.com:8080".to_string(),
            username: None,
            password: None,
            no_proxy: None,
            ignore_ssl: None,
        };
        assert!(validate_proxy_config(&config).is_err());
    }

    #[test]
    fn test_validate_proxy_config_rejects_path_query_and_fragment() {
        for url in [
            "http://proxy.example.com:8080/path",
            "http://proxy.example.com:8080?target=other",
            "http://proxy.example.com:8080#fragment",
        ] {
            let config = ProxyConfig {
                url: url.to_string(),
                username: None,
                password: None,
                no_proxy: None,
                ignore_ssl: None,
            };
            assert!(validate_proxy_config(&config).is_err(), "{url} should fail");
        }
    }

    #[test]
    fn test_validate_proxy_config_unsupported_scheme() {
        let config = ProxyConfig {
            url: "ftp://proxy.example.com".to_string(),
            username: None,
            password: None,
            no_proxy: None,
            ignore_ssl: None,
        };
        let err = validate_proxy_config(&config).unwrap_err();
        assert!(err.contains("Unsupported proxy scheme"));
    }

    #[test]
    fn test_validate_proxy_config_username_without_password() {
        let config = ProxyConfig {
            url: "http://proxy.example.com:8080".to_string(),
            username: Some("user".to_string()),
            password: None,
            no_proxy: None,
            ignore_ssl: None,
        };
        let err = validate_proxy_config(&config).unwrap_err();
        assert!(err.contains("Username provided without password"));
    }

    #[test]
    fn test_validate_proxy_config_password_without_username() {
        let config = ProxyConfig {
            url: "http://proxy.example.com:8080".to_string(),
            username: None,
            password: Some("pass".to_string()),
            no_proxy: None,
            ignore_ssl: None,
        };
        let err = validate_proxy_config(&config).unwrap_err();
        assert!(err.contains("Password provided without username"));
    }

    #[test]
    fn test_validate_proxy_config_empty_no_proxy_entry() {
        let config = ProxyConfig {
            url: "http://proxy.example.com:8080".to_string(),
            username: None,
            password: None,
            no_proxy: Some(vec!["".to_string()]),
            ignore_ssl: None,
        };
        let err = validate_proxy_config(&config).unwrap_err();
        assert!(err.contains("Empty no_proxy entry"));
    }

    // --- should_bypass_proxy ---

    #[test]
    fn test_should_bypass_proxy_empty_list() {
        assert!(!should_bypass_proxy("https://example.com", &[]));
    }

    #[test]
    fn test_should_bypass_proxy_wildcard() {
        assert!(should_bypass_proxy(
            "https://anything.com",
            &["*".to_string()]
        ));
    }

    #[test]
    fn test_should_bypass_proxy_exact_match() {
        assert!(should_bypass_proxy(
            "https://localhost/api",
            &["localhost".to_string()]
        ));
    }

    #[test]
    fn test_should_bypass_proxy_wildcard_domain() {
        assert!(should_bypass_proxy(
            "https://api.internal.corp",
            &["*.internal.corp".to_string()]
        ));
    }

    #[test]
    fn test_should_bypass_proxy_ipv4_prefix_wildcard() {
        assert!(should_bypass_proxy(
            "https://192.168.10.20/file",
            &["192.168.*".to_string()]
        ));
        assert!(!should_bypass_proxy(
            "https://192.169.10.20/file",
            &["192.168.*".to_string()]
        ));
    }

    #[test]
    fn test_should_bypass_proxy_no_match() {
        assert!(!should_bypass_proxy(
            "https://external.com",
            &["localhost".to_string(), "*.internal.corp".to_string()]
        ));
    }

    #[test]
    fn test_should_bypass_proxy_wildcard_does_not_match_bare_domain() {
        // "*.example.com" must NOT match "example.com" itself — only subdomains.
        assert!(!should_bypass_proxy(
            "https://example.com/path",
            &["*.example.com".to_string()]
        ));
        // But it must still match a real subdomain.
        assert!(should_bypass_proxy(
            "https://api.example.com/v1",
            &["*.example.com".to_string()]
        ));
    }

    #[test]
    fn test_should_bypass_proxy_invalid_url() {
        assert!(!should_bypass_proxy("not a url", &["*".to_string()]));
    }

    // --- _convert_headers ---

    #[test]
    fn test_convert_headers_basic() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), "Bearer token".to_string());
        headers.insert("Content-Type".to_string(), "application/json".to_string());

        let result = _convert_headers(&headers).unwrap();
        assert_eq!(result.get("authorization").unwrap(), "Bearer token");
        assert_eq!(result.get("content-type").unwrap(), "application/json");
    }

    #[test]
    fn test_convert_headers_empty() {
        let headers = HashMap::new();
        let result = _convert_headers(&headers).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_convert_headers_rejects_transport_managed_headers() {
        for name in ["Host", "Content-Length", "Range", "Transfer-Encoding"] {
            let mut headers = HashMap::new();
            headers.insert(name.to_string(), "value".to_string());
            assert!(
                _convert_headers(&headers).is_err(),
                "{name} should be rejected"
            );
        }
    }

    #[test]
    fn test_convert_headers_enforces_count_and_total_size_limits() {
        let too_many = (0..=MAX_DOWNLOAD_HEADERS)
            .map(|index| (format!("x-header-{index}"), "value".to_string()))
            .collect();
        assert!(_convert_headers(&too_many).is_err());

        let mut too_large = HashMap::new();
        too_large.insert(
            "x-large".to_string(),
            "x".repeat(MAX_DOWNLOAD_HEADER_BYTES + 1),
        );
        assert!(_convert_headers(&too_large).is_err());
    }
}
