use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
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

/// Write messages to a thread's messages.jsonl file (atomic: write to .tmp then rename)
///
/// Currently used only via rewrite_messages_file and tests; kept as a
/// standalone primitive for direct callers added by future thread-storage
/// features.
#[allow(dead_code)]
pub fn write_messages_to_file(
    messages: &[MessageRecord],
    path: &std::path::Path,
) -> Result<(), String> {
    let tmp_path = path.with_extension("jsonl.tmp");
    let mut file = File::create(&tmp_path).map_err(|e| e.to_string())?;
    for msg in messages {
        let data = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        writeln!(file, "{data}").map_err(|e| e.to_string())?;
    }
    file.flush().map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Read messages from a thread's messages.jsonl file
pub fn read_messages_from_file<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: &str,
) -> Result<Vec<MessageRecord>, String> {
    let path = get_messages_path(app_handle, thread_id);
    if !path.exists() {
        return Ok(vec![]);
    }

    let file = File::open(&path).map_err(|e| {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map};

    fn make_test_message(role: &str, content_text: &str) -> MessageRecord {
        MessageRecord {
            object: "message".to_string(),
            thread_id: "thread-1".to_string(),
            role: role.to_string(),
            content: vec![json!({"type": "text", "text": content_text})],
            extra: Map::new(),
            ..Default::default()
        }
    }

    fn make_test_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join("ax_studio_test")
            .join(name)
            .join(format!("{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    fn cleanup_test_dir(dir: &std::path::Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_write_messages_to_file_basic() {
        let dir = make_test_dir("write_basic");
        let path = dir.join("messages.jsonl");

        let messages = vec![
            make_test_message("user", "Hello"),
            make_test_message("assistant", "Hi there"),
        ];

        write_messages_to_file(&messages, &path).unwrap();

        assert!(path.exists());
        let content = fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.trim().split('\n').collect();
        assert_eq!(lines.len(), 2);

        let msg0: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(msg0["role"], "user");
        let msg1: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(msg1["role"], "assistant");

        cleanup_test_dir(&dir);
    }

    #[test]
    fn test_write_messages_to_file_empty() {
        let dir = make_test_dir("write_empty");
        let path = dir.join("messages.jsonl");

        write_messages_to_file(&[], &path).unwrap();

        assert!(path.exists());
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.is_empty());

        cleanup_test_dir(&dir);
    }

    #[test]
    fn test_write_messages_to_file_atomic_no_tmp_leftover() {
        let dir = make_test_dir("write_atomic");
        let path = dir.join("messages.jsonl");
        let tmp_path = path.with_extension("jsonl.tmp");

        let messages = vec![make_test_message("user", "test")];
        write_messages_to_file(&messages, &path).unwrap();

        assert!(!tmp_path.exists());
        assert!(path.exists());

        cleanup_test_dir(&dir);
    }
}

/// Remove the per-thread lock entry when a thread is deleted.
pub async fn remove_lock_for_thread(thread_id: &str) {
    if let Some(locks) = MESSAGE_LOCKS.get() {
        let mut map = locks.lock().await;
        map.remove(thread_id);
        prune_unused_message_locks_locked(&mut map);
    }
}
