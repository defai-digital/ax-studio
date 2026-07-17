use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;

// For async file write serialization
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use tokio::sync::Mutex;

use super::models::{MessageRecord, ThreadRecord, MAX_MESSAGE_RECORD_BYTES};

const MAX_MESSAGES_FILE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_MESSAGES_PER_THREAD: usize = 1_000_000;

fn read_bounded_json_line<R: BufRead>(reader: &mut R) -> Result<Option<String>, String> {
    let mut line = String::new();
    let maximum_with_newline = MAX_MESSAGE_RECORD_BYTES + 1;
    let bytes_read = reader
        .take((maximum_with_newline + 1) as u64)
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    if bytes_read == 0 {
        return Ok(None);
    }
    if bytes_read > maximum_with_newline {
        return Err(format!(
            "Message record exceeds the {MAX_MESSAGE_RECORD_BYTES}-byte limit"
        ));
    }
    Ok(Some(line))
}

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

pub fn read_messages_from_path(
    path: &Path,
    expected_thread_id: &str,
) -> Result<Vec<MessageRecord>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }

    if fs::metadata(path).map_err(|error| error.to_string())?.len() > MAX_MESSAGES_FILE_BYTES {
        return Err(format!(
            "Messages file exceeds the {MAX_MESSAGES_FILE_BYTES}-byte limit"
        ));
    }

    let file = File::open(path).map_err(|e| {
        log::error!("Error opening file {}: {}", path.display(), e);
        e.to_string()
    })?;
    let reader = BufReader::new(file);

    let mut messages = Vec::new();
    let mut skipped = 0u32;
    let mut reader = reader;
    while let Some(line) = read_bounded_json_line(&mut reader)? {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<MessageRecord>(&line) {
            Ok(message)
                if message.validate().is_ok() && message.thread_id == expected_thread_id =>
            {
                if messages.len() >= MAX_MESSAGES_PER_THREAD {
                    return Err(format!(
                        "Thread contains more than {MAX_MESSAGES_PER_THREAD} messages"
                    ));
                }
                messages.push(message);
            }
            Err(e) => {
                skipped += 1;
                log::warn!(
                    "Skipping malformed message record in {}: {e}",
                    path.display()
                );
            }
            Ok(_) => {
                skipped += 1;
                log::warn!(
                    "Skipping invalid or mismatched message record in {}",
                    path.display()
                );
            }
        }
    }
    if skipped > 0 {
        log::warn!(
            "{skipped} message(s) skipped due to malformed JSON in {}",
            path.display()
        );
    }

    Ok(messages)
}

/// Update thread metadata by writing to thread.json (atomic: write to .tmp then rename).
/// `path` must be pre-computed on the calling async thread to avoid cross-thread path divergence.
pub fn update_thread_metadata(path: &Path, thread: &ThreadRecord) -> Result<(), String> {
    let tmp_path = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(thread).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, &data).map_err(|e| e.to_string())?;
    // fsync to ensure data is on disk before rename
    if let Ok(f) = File::open(&tmp_path) {
        let _ = f.sync_all();
    }
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())?;
    Ok(())
}

/// `path` must be pre-computed on the calling async thread to avoid cross-thread path divergence.
pub fn rewrite_messages_file<F>(path: &Path, mut transform: F) -> Result<bool, String>
where
    F: FnMut(MessageRecord) -> Option<MessageRecord>,
{
    if !path.exists() {
        return Ok(false);
    }
    if fs::metadata(path).map_err(|error| error.to_string())?.len() > MAX_MESSAGES_FILE_BYTES {
        return Err(format!(
            "Messages file exceeds the {MAX_MESSAGES_FILE_BYTES}-byte limit"
        ));
    }

    let tmp_path = path.with_extension("jsonl.tmp");
    let input = File::open(path).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(input);
    let mut output = File::create(&tmp_path).map_err(|e| e.to_string())?;
    let mut changed = false;

    let mut records = 0usize;
    while let Some(line) = read_bounded_json_line(&mut reader)? {
        records += 1;
        if records > MAX_MESSAGES_PER_THREAD {
            return Err(format!(
                "Thread contains more than {MAX_MESSAGES_PER_THREAD} messages"
            ));
        }
        let message: MessageRecord = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        message.validate()?;
        match transform(message.clone()) {
            Some(next) => {
                next.validate()?;
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
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())?;
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
