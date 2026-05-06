use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use tauri::Runtime;

// For async file write serialization
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use tokio::sync::Mutex;

use super::models::{MessageRecord, ThreadRecord};
use super::utils::{get_messages_path, get_thread_metadata_path};

// Global per-thread locks for message file writes
pub static MESSAGE_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

/// Get a lock for a specific thread to ensure thread-safe message file operations
pub async fn get_lock_for_thread(thread_id: &str) -> Arc<Mutex<()>> {
    let locks = MESSAGE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks.lock().await;
    prune_unused_message_locks_locked(&mut locks);

    let lock = locks
        .entry(thread_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone();
    drop(locks); // Release the map lock before returning the file lock
    lock
}

fn prune_unused_message_locks_locked(locks: &mut HashMap<String, Arc<Mutex<()>>>) {
    let keys_to_remove: Vec<String> = locks
        .iter()
        .filter_map(|(key, arc)| {
            if Arc::strong_count(arc) == 1 {
                Some(key.clone())
            } else {
                None
            }
        })
        .collect();
    for key in keys_to_remove {
        locks.remove(&key);
    }
}

pub async fn prune_unused_message_locks() {
    if let Some(locks) = MESSAGE_LOCKS.get() {
        let mut map = locks.lock().await;
        prune_unused_message_locks_locked(&mut map);
    }
}

pub fn read_messages_from_path(path: &Path) -> Result<Vec<MessageRecord>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }

    let file = File::open(path).map_err(|e| {
        log::error!("Error opening file {}: {}", path.display(), e);
        e.to_string()
    })?;
    let reader = BufReader::new(file);

    let mut messages = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| {
            log::error!("Error reading line from file {}: {}", path.display(), e);
            e.to_string()
        })?;
        let message: MessageRecord = serde_json::from_str(&line).map_err(|e| {
            log::error!(
                "Error parsing JSON from line in file {}: {}",
                path.display(),
                e
            );
            e.to_string()
        })?;
        messages.push(message);
    }

    Ok(messages)
}

/// Update thread metadata by writing to thread.json (atomic: write to .tmp then rename)
pub fn update_thread_metadata<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: &str,
    thread: &ThreadRecord,
) -> Result<(), String> {
    let path = get_thread_metadata_path(app_handle, thread_id);
    let tmp_path = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(thread).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, &data).map_err(|e| e.to_string())?;
    // fsync to ensure data is on disk before rename
    if let Ok(f) = File::open(&tmp_path) {
        let _ = f.sync_all();
    }
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn rewrite_messages_file<R, F>(
    app_handle: tauri::AppHandle<R>,
    thread_id: &str,
    mut transform: F,
) -> Result<bool, String>
where
    R: Runtime,
    F: FnMut(MessageRecord) -> Option<MessageRecord>,
{
    let path = get_messages_path(app_handle, thread_id);
    if !path.exists() {
        return Ok(false);
    }

    let tmp_path = path.with_extension("jsonl.tmp");
    let input = File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(input);
    let mut output = File::create(&tmp_path).map_err(|e| e.to_string())?;
    let mut changed = false;

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let message: MessageRecord = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        match transform(message.clone()) {
            Some(next) => {
                if next != message {
                    changed = true;
                }
                let data = serde_json::to_string(&next).map_err(|e| e.to_string())?;
                writeln!(output, "{data}").map_err(|e| e.to_string())?;
            }
            None => {
                changed = true;
            }
        }
    }

    output.flush().map_err(|e| e.to_string())?;
    output.sync_all().map_err(|e| e.to_string())?;
    drop(output);
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())?;
    Ok(changed)
}

/// Remove the per-thread lock entry when a thread is deleted.
pub async fn remove_lock_for_thread(thread_id: &str) {
    if let Some(locks) = MESSAGE_LOCKS.get() {
        let mut map = locks.lock().await;
        map.remove(thread_id);
        prune_unused_message_locks_locked(&mut map);
    }
}
