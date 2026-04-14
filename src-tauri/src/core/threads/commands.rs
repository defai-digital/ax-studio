use std::fs::{self, File};
use std::io::Write;
use tauri::Runtime;
use tokio::task;
use uuid::Uuid;

use super::helpers::{
    get_lock_for_thread, prune_unused_message_locks, read_messages_from_file,
    remove_lock_for_thread, rewrite_messages_file, update_thread_metadata,
};
use super::models::{MessageRecord, ThreadRecord};
use super::{
    constants::THREADS_FILE,
    utils::{
        ensure_data_dirs, ensure_thread_dir_exists, get_data_dir, get_messages_path,
        get_thread_dir, get_thread_metadata_path,
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
        if !data_dir.exists() {
            return Ok(threads);
        }

        for entry in fs::read_dir(&data_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                let thread_metadata_path = path.join(THREADS_FILE);
                if thread_metadata_path.exists() {
                    let data =
                        fs::read_to_string(&thread_metadata_path).map_err(|e| e.to_string())?;
                    match serde_json::from_str(&data) {
                        Ok(thread) => threads.push(thread),
                        Err(e) => {
                            log::warn!(
                                "Failed to parse thread metadata {}: {e}",
                                thread_metadata_path.display()
                            );
                        }
                    }
                }
            }
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

    ensure_data_dirs(app_handle.clone())?;
    let uuid = thread.id.clone();
    let thread_dir = get_thread_dir(app_handle.clone(), &uuid);
    if !thread_dir.exists() {
        fs::create_dir_all(&thread_dir).map_err(|e| e.to_string())?;
    }
    let path = get_thread_metadata_path(app_handle.clone(), &uuid);
    let data = serde_json::to_string_pretty(&thread).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())?;
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
    let thread_dir = get_thread_dir(app_handle.clone(), thread_id);
    if !thread_dir.exists() {
        return Err("Thread directory does not exist".to_string());
    }

    let lock = get_lock_for_thread(thread_id).await;
    let _guard = lock.lock().await;

    let path = get_thread_metadata_path(app_handle.clone(), thread_id);
    let data = serde_json::to_string_pretty(&thread).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &data).map_err(|e| e.to_string())?;
    if let Err(e) = fs::rename(&tmp_path, &path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e.to_string());
    }
    Ok(())
}

/// Deletes a thread and all its associated files by removing its directory.
#[tauri::command]
pub async fn delete_thread<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
) -> Result<(), String> {
    {
        let lock = get_lock_for_thread(&thread_id).await;
        let _guard = lock.lock().await;

        let thread_dir = get_thread_dir(app_handle.clone(), &thread_id);
        if thread_dir.exists() {
            fs::remove_dir_all(&thread_dir)
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
    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;
    let messages = read_messages_from_file(app_handle, &thread_id);
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

    let thread_id = message.thread_id.clone();
    if thread_id.is_empty() {
        return Err("Missing thread_id".to_string());
    }
    let path = get_messages_path(app_handle.clone(), &thread_id);

    {
        let lock = get_lock_for_thread(&thread_id).await;
        let _guard = lock.lock().await;

        ensure_thread_dir_exists(app_handle.clone(), &thread_id)?;

        let mut file: File = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| e.to_string())?;

        let data = serde_json::to_string(&message).map_err(|e| e.to_string())?;
        writeln!(file, "{data}").map_err(|e| e.to_string())?;

        file.flush().map_err(|e| e.to_string())?;
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

    {
        let lock = get_lock_for_thread(thread_id).await;
        let _guard = lock.lock().await;

        rewrite_messages_file(app_handle.clone(), thread_id, |existing| {
            if existing.id == message_id {
                Some(message.clone())
            } else {
                Some(existing)
            }
        })?;
    }
    prune_unused_message_locks().await;
    Ok(message)
}

/// Deletes a message from a thread's messages.jsonl file by message ID.
#[tauri::command]
pub async fn delete_message<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    message_id: String,
) -> Result<(), String> {
    {
        let lock = get_lock_for_thread(&thread_id).await;
        let _guard = lock.lock().await;

        rewrite_messages_file(app_handle.clone(), &thread_id, |existing| {
            if existing.id == message_id {
                None
            } else {
                Some(existing)
            }
        })?;
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
    let path = get_thread_metadata_path(app_handle, &thread_id);
    if !path.exists() {
        return Err("Thread not found".to_string());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let thread: ThreadRecord = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    if let Some(first) = thread.assistants.first() {
        Ok(first.clone())
    } else {
        Err("Assistant not found".to_string())
    }
}

/// Adds a new assistant to a thread's metadata.
#[tauri::command]
pub async fn create_thread_assistant<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    assistant: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let path = get_thread_metadata_path(app_handle.clone(), &thread_id);
    if !path.exists() {
        return Err("Thread not found".to_string());
    }

    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;

    let mut thread: ThreadRecord = {
        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).map_err(|e| e.to_string())?
    };
    thread.assistants.push(assistant.clone());
    update_thread_metadata(app_handle, &thread_id, &thread)?;
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
    let path = get_thread_metadata_path(app_handle.clone(), &thread_id);
    if !path.exists() {
        return Err("Thread not found".to_string());
    }

    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;

    let mut thread: ThreadRecord = {
        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).map_err(|e| e.to_string())?
    };
    let assistant_id = assistant
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing id")?;
    if let Some(index) = thread
        .assistants
        .iter()
        .position(|a| a.get("id").and_then(|v| v.as_str()) == Some(assistant_id))
    {
        thread.assistants[index] = assistant.clone();
        update_thread_metadata(app_handle, &thread_id, &thread)?;
    }
    drop(_guard);
    drop(lock);
    prune_unused_message_locks().await;
    Ok(assistant)
}
