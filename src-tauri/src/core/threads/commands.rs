use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use tauri::Runtime;
use tokio::task;
use uuid::Uuid;

use super::helpers::{
    get_lock_for_thread, prune_unused_message_locks, read_messages_from_path,
    remove_lock_for_thread, rewrite_messages_file, update_thread_metadata,
};
use super::models::{
    validate_storage_identifier, MessageRecord, ThreadRecord, MAX_THREAD_RECORD_BYTES,
};
use super::{
    constants::THREADS_FILE,
    utils::{
        ensure_data_dirs, get_data_dir, get_messages_path, get_thread_dir, get_thread_metadata_path,
    },
};

/// Lists all threads by reading their metadata from the threads directory.
/// Returns a vector of thread metadata as JSON values.
#[tauri::command]
pub async fn list_threads<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<ThreadRecord>, String> {
    ensure_data_dirs(app_handle.clone())?;
    let data_dir = get_data_dir(app_handle.clone());

    task::spawn_blocking(move || -> Result<Vec<ThreadRecord>, String> {
        let mut threads = Vec::new();
        let mut skipped = 0u32;
        let mut scanned = 0usize;
        if !data_dir.exists() {
            return Ok(threads);
        }

        for entry in fs::read_dir(&data_dir).map_err(|e| e.to_string())? {
            scanned += 1;
            if scanned > 100_000 {
                return Err("Thread directory contains more than 100000 entries".to_string());
            }
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                let thread_metadata_path = path.join(THREADS_FILE);
                if thread_metadata_path.exists() {
                    if fs::metadata(&thread_metadata_path)
                        .map_err(|error| error.to_string())?
                        .len()
                        > MAX_THREAD_RECORD_BYTES as u64
                    {
                        skipped += 1;
                        continue;
                    }
                    let data =
                        fs::read_to_string(&thread_metadata_path).map_err(|e| e.to_string())?;
                    match serde_json::from_str::<ThreadRecord>(&data) {
                        Ok(thread)
                            if thread.validate().is_ok()
                                && path.file_name().and_then(|name| name.to_str())
                                    == Some(thread.id.as_str()) =>
                        {
                            threads.push(thread)
                        }
                        Ok(_) => {
                            skipped += 1;
                            log::warn!(
                                "Skipping thread metadata with invalid or mismatched id: {}",
                                thread_metadata_path.display()
                            );
                        }
                        Err(e) => {
                            skipped += 1;
                            log::warn!(
                                "Failed to parse thread metadata {}: {e}",
                                thread_metadata_path.display()
                            );
                        }
                    }
                }
            }
        }

        if skipped > 0 {
            log::warn!("{skipped} thread(s) skipped due to malformed metadata");
        }

        Ok(threads)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Creates a new thread, assigns it a unique ID, and persists its metadata.
/// Ensures the thread directory exists and writes thread.json.
#[tauri::command]
pub async fn create_thread<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    mut thread: ThreadRecord,
) -> Result<ThreadRecord, String> {
    if thread.id.is_empty() {
        thread.id = Uuid::new_v4().to_string();
    }
    thread.validate()?;

    ensure_data_dirs(app_handle.clone())?;
    let uuid = thread.id.clone();
    let thread_dir = get_thread_dir(app_handle.clone(), &uuid);
    let path = get_thread_metadata_path(app_handle.clone(), &uuid);
    let persisted_thread = thread.clone();
    tokio::task::spawn_blocking(move || {
        fs::create_dir(&thread_dir).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                format!("Thread '{uuid}' already exists")
            } else {
                error.to_string()
            }
        })?;
        if let Err(error) = update_thread_metadata(&path, &persisted_thread) {
            let _ = fs::remove_dir_all(&thread_dir);
            return Err(error);
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("create_thread task error: {e}"))??;
    Ok(thread)
}

/// Modifies an existing thread's metadata by overwriting its thread.json file.
/// Returns an error if the thread directory does not exist.
#[tauri::command]
pub async fn modify_thread<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread: ThreadRecord,
) -> Result<(), String> {
    let thread_id = thread.id.as_str();
    if thread_id.is_empty() {
        return Err("Missing thread id".to_string());
    }
    thread.validate()?;
    let thread_dir = get_thread_dir(app_handle.clone(), thread_id);
    if !thread_dir.exists() {
        return Err("Thread directory does not exist".to_string());
    }

    let lock = get_lock_for_thread(thread_id).await;
    let _guard = lock.lock().await;

    let path = get_thread_metadata_path(app_handle.clone(), thread_id);
    tokio::task::spawn_blocking(move || update_thread_metadata(&path, &thread))
    .await
    .map_err(|e| format!("modify_thread task error: {e}"))??;
    Ok(())
}

/// Deletes a thread and all its associated files by removing its directory.
#[tauri::command]
pub async fn delete_thread<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
) -> Result<(), String> {
    validate_storage_identifier("Thread id", &thread_id)?;
    {
        let lock = get_lock_for_thread(&thread_id).await;
        let _guard = lock.lock().await;

        let thread_dir = get_thread_dir(app_handle.clone(), &thread_id);
        if thread_dir.exists() {
            tokio::task::spawn_blocking(move || fs::remove_dir_all(&thread_dir))
                .await
                .map_err(|e| format!("delete_thread task error: {e}"))?
                .map_err(|e| format!("Failed to delete thread directory: {e}"))?;
        }
    }
    remove_lock_for_thread(&thread_id).await;
    Ok(())
}

/// Lists all messages for a given thread by reading and parsing its messages.jsonl file.
#[tauri::command]
pub async fn list_messages<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
) -> Result<Vec<MessageRecord>, String> {
    validate_storage_identifier("Thread id", &thread_id)?;
    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;
    let path = get_messages_path(app_handle.clone(), &thread_id);
    let expected_thread_id = thread_id.clone();
    let messages =
        tokio::task::spawn_blocking(move || read_messages_from_path(&path, &expected_thread_id))
            .await
            .map_err(|e| format!("list_messages task error: {e}"))?;
    drop(_guard);
    drop(lock);
    prune_unused_message_locks().await;
    messages
}

/// Appends a new message to a thread's messages.jsonl file.
#[tauri::command]
pub async fn create_message<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    mut message: MessageRecord,
) -> Result<MessageRecord, String> {
    if message.id.is_empty() {
        message.id = Uuid::new_v4().to_string();
    }
    message.validate()?;

    let thread_id = message.thread_id.clone();
    if thread_id.is_empty() {
        return Err("Missing thread_id".to_string());
    }
    let path = get_messages_path(app_handle.clone(), &thread_id);
    let thread_dir = get_thread_dir(app_handle.clone(), &thread_id);
    if !get_thread_metadata_path(app_handle.clone(), &thread_id).is_file() {
        return Err("Cannot create a message for a missing thread".to_string());
    }

    {
        let lock = get_lock_for_thread(&thread_id).await;
        let _guard = lock.lock().await;

        let data = serde_json::to_string(&message).map_err(|e| e.to_string())?;
        task::spawn_blocking(move || -> Result<(), String> {
            if !thread_dir.is_dir() {
                return Err("Thread directory does not exist".to_string());
            }
            let mut file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .map_err(|e| e.to_string())?;
            writeln!(file, "{data}").map_err(|e| e.to_string())?;
            file.flush().map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| format!("create_message task error: {e}"))??;
    }

    prune_unused_message_locks().await;

    Ok(message)
}

/// Modifies an existing message in a thread's messages.jsonl file.
#[tauri::command]
pub async fn modify_message<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    message: MessageRecord,
) -> Result<MessageRecord, String> {
    let thread_id = message.thread_id.as_str();
    if thread_id.is_empty() {
        return Err("Missing thread_id".to_string());
    }
    let message_id = message.id.as_str();
    if message_id.is_empty() {
        return Err("Missing message id".to_string());
    }
    message.validate()?;

    {
        let lock = get_lock_for_thread(thread_id).await;
        let _guard = lock.lock().await;

        let messages_path = get_messages_path(app_handle.clone(), thread_id);
        let message_id_owned = message_id.to_string();
        let message_clone = message.clone();
        let changed = task::spawn_blocking(move || {
            rewrite_messages_file(&messages_path, |existing| {
                if existing.id == message_id_owned {
                    Some(message_clone.clone())
                } else {
                    Some(existing)
                }
            })
        })
        .await
        .map_err(|e| format!("modify_message task error: {e}"))??;
        if !changed {
            return Err(format!("Message '{message_id}' not found"));
        }
    }
    prune_unused_message_locks().await;
    Ok(message)
}

/// Modifies several messages in one all-or-nothing rewrite of a thread's
/// messages.jsonl file.
#[tauri::command]
pub async fn modify_messages<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    messages: Vec<MessageRecord>,
) -> Result<Vec<MessageRecord>, String> {
    if messages.is_empty() {
        return Ok(Vec::new());
    }

    let thread_id = messages[0].thread_id.clone();
    if thread_id.is_empty() {
        return Err("Missing thread_id".to_string());
    }

    let mut message_ids = HashSet::with_capacity(messages.len());
    for message in &messages {
        message.validate()?;
        if message.thread_id != thread_id {
            return Err("All messages in a batch must belong to the same thread".to_string());
        }
        if !message_ids.insert(message.id.clone()) {
            return Err(format!("Duplicate message id '{}' in batch", message.id));
        }
    }

    {
        let lock = get_lock_for_thread(&thread_id).await;
        let _guard = lock.lock().await;
        let messages_path = get_messages_path(app_handle, &thread_id);
        let expected_thread_id = thread_id.clone();
        let replacements: HashMap<String, MessageRecord> = messages
            .iter()
            .cloned()
            .map(|message| (message.id.clone(), message))
            .collect();
        let expected_ids = message_ids.clone();

        task::spawn_blocking(move || -> Result<(), String> {
            // Check every requested id before opening the temporary output so a
            // partially valid batch cannot commit a subset of its changes.
            let existing = read_messages_from_path(&messages_path, &expected_thread_id)?;
            let existing_ids: HashSet<&str> =
                existing.iter().map(|message| message.id.as_str()).collect();
            if let Some(missing_id) = expected_ids
                .iter()
                .find(|id| !existing_ids.contains(id.as_str()))
            {
                return Err(format!("Message '{missing_id}' not found"));
            }

            rewrite_messages_file(&messages_path, |existing| {
                replacements
                    .get(&existing.id)
                    .cloned()
                    .or(Some(existing))
            })?;
            Ok(())
        })
        .await
        .map_err(|e| format!("modify_messages task error: {e}"))??;
    }

    prune_unused_message_locks().await;
    Ok(messages)
}

/// Deletes a message from a thread's messages.jsonl file by message ID.
#[tauri::command]
pub async fn delete_message<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    message_id: String,
) -> Result<(), String> {
    validate_storage_identifier("Thread id", &thread_id)?;
    validate_storage_identifier("Message id", &message_id)?;
    {
        let lock = get_lock_for_thread(&thread_id).await;
        let _guard = lock.lock().await;

        let messages_path = get_messages_path(app_handle, &thread_id);
        task::spawn_blocking(move || {
            rewrite_messages_file(&messages_path, |existing| {
                if existing.id == message_id {
                    None
                } else {
                    Some(existing)
                }
            })
        })
        .await
        .map_err(|e| format!("delete_message task error: {e}"))??;
    }

    prune_unused_message_locks().await;

    Ok(())
}

/// Retrieves the first assistant associated with a thread.
#[tauri::command]
pub async fn get_thread_assistant<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
) -> Result<serde_json::Value, String> {
    validate_storage_identifier("Thread id", &thread_id)?;
    let path = get_thread_metadata_path(app_handle, &thread_id);
    if !path.exists() {
        return Err("Thread not found".to_string());
    }

    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;

    let result = task::spawn_blocking(move || -> Result<serde_json::Value, String> {
        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let thread: ThreadRecord = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        thread.validate()?;
        if let Some(first) = thread.assistants.first() {
            Ok(first.clone())
        } else {
            Err("Assistant not found".to_string())
        }
    })
    .await
    .map_err(|e| format!("get_thread_assistant task error: {e}"))?;

    drop(_guard);
    drop(lock);
    prune_unused_message_locks().await;

    result
}

/// Adds a new assistant to a thread's metadata.
#[tauri::command]
pub async fn create_thread_assistant<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    assistant: serde_json::Value,
) -> Result<serde_json::Value, String> {
    validate_storage_identifier("Thread id", &thread_id)?;
    let path = get_thread_metadata_path(app_handle.clone(), &thread_id);
    if !path.exists() {
        return Err("Thread not found".to_string());
    }

    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;

    let read_path = path.clone();
    let data =
        task::spawn_blocking(move || fs::read_to_string(&read_path).map_err(|e| e.to_string()))
            .await
            .map_err(|e| format!("create_thread_assistant task error: {e}"))??;

    let mut thread: ThreadRecord = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    thread.assistants.push(assistant.clone());
    thread.validate()?;

    task::spawn_blocking(move || update_thread_metadata(&path, &thread))
        .await
        .map_err(|e| format!("create_thread_assistant task error: {e}"))??;

    drop(_guard);
    drop(lock);
    prune_unused_message_locks().await;
    Ok(assistant)
}

/// Modifies an existing assistant's information in a thread's metadata.
#[tauri::command]
pub async fn modify_thread_assistant<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    assistant: serde_json::Value,
) -> Result<serde_json::Value, String> {
    validate_storage_identifier("Thread id", &thread_id)?;
    let path = get_thread_metadata_path(app_handle.clone(), &thread_id);
    if !path.exists() {
        return Err("Thread not found".to_string());
    }

    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;

    let read_path = path.clone();
    let data =
        task::spawn_blocking(move || fs::read_to_string(&read_path).map_err(|e| e.to_string()))
            .await
            .map_err(|e| format!("modify_thread_assistant task error: {e}"))??;

    let mut thread: ThreadRecord = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let assistant_id: String = assistant
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing id")?
        .to_string();
    let index = thread
        .assistants
        .iter()
        .position(|a| a.get("id").and_then(|v| v.as_str()) == Some(assistant_id.as_str()))
        .ok_or_else(|| format!("Assistant '{assistant_id}' not found in thread '{thread_id}'"))?;
    thread.assistants[index] = assistant.clone();
    thread.validate()?;
    task::spawn_blocking(move || update_thread_metadata(&path, &thread))
        .await
        .map_err(|e| format!("modify_thread_assistant task error: {e}"))??;

    drop(_guard);
    drop(lock);
    prune_unused_message_locks().await;
    Ok(assistant)
}
