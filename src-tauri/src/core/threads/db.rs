/*!
   SQLite Database Module for Mobile Thread Storage

   This module provides SQLite-based storage for threads and messages on mobile platforms.
   It ensures data persistence and retrieval work correctly on Android and iOS devices.

   Note: This module is only compiled and used on mobile platforms (Android/iOS).
   On desktop, the file-based storage in helpers.rs is used instead.
*/

#![allow(dead_code)] // Functions only used on mobile platforms

use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Mutex;

use super::models::{MessageRecord, ThreadRecord};

const DB_NAME: &str = "ax-studio.db";

/// Global database pool for mobile platforms
static DB_POOL: OnceLock<Mutex<Option<SqlitePool>>> = OnceLock::new();

fn sqlite_connect_options(db_url: &str) -> Result<SqliteConnectOptions, String> {
    SqliteConnectOptions::from_str(db_url)
        .map_err(|e| format!("Failed to parse connection options: {}", e))
        .map(|options| options.create_if_missing(true))
}

async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin migration transaction: {}", e))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS threads (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
        "#,
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to create threads table: {}", e))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
        );
        "#,
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to create messages table: {}", e))?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to create thread_id index: {}", e))?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to create created_at index: {}", e))?;

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit migrations: {}", e))?;

    Ok(())
}

async fn connect_pool(db_url: &str) -> Result<SqlitePool, String> {
    let connect_options = sqlite_connect_options(db_url)?;
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await
        .map_err(|e| format!("Failed to create connection pool: {}", e))?;

    run_migrations(&pool).await?;
    Ok(pool)
}

/// Initialize database with connection pool and run migrations
pub async fn init_database<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // Get app data directory
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Ensure directory exists
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    // Create database path
    let db_path = app_data_dir.join(DB_NAME);
    let db_url = format!("sqlite:{}", db_path.display());

    log::info!("Initializing SQLite database at: {}", db_url);

    let pool = connect_pool(&db_url).await?;

    // Store pool globally
    DB_POOL
        .get_or_init(|| Mutex::new(None))
        .lock()
        .await
        .replace(pool);

    log::info!("SQLite database initialized successfully for mobile platform");
    Ok(())
}

/// Get database pool
async fn get_pool() -> Result<SqlitePool, String> {
    let pool_mutex = DB_POOL.get().ok_or("Database not initialized")?;

    let pool_guard = pool_mutex.lock().await;
    pool_guard
        .clone()
        .ok_or("Database pool not available".to_string())
}

/// List all threads from database
pub async fn db_list_threads<R: Runtime>(
    _app_handle: AppHandle<R>,
) -> Result<Vec<ThreadRecord>, String> {
    let pool = get_pool().await?;

    let rows = sqlx::query("SELECT data FROM threads ORDER BY updated_at DESC")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to list threads: {}", e))?;

    let threads: Result<Vec<ThreadRecord>, _> = rows
        .iter()
        .map(|row| {
            let data: String = row.get("data");
            serde_json::from_str(&data).map_err(|e| e.to_string())
        })
        .collect();

    threads
}

/// Create a new thread in database
pub async fn db_create_thread<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread: ThreadRecord,
) -> Result<ThreadRecord, String> {
    let pool = get_pool().await?;

    if thread.id.is_empty() {
        return Err("Missing thread id".to_string());
    }

    let data = serde_json::to_string(&thread).map_err(|e| e.to_string())?;

    sqlx::query("INSERT INTO threads (id, data) VALUES (?1, ?2)")
        .bind(&thread.id)
        .bind(&data)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create thread: {}", e))?;

    Ok(thread)
}

/// Modify an existing thread in database
pub async fn db_modify_thread<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread: ThreadRecord,
) -> Result<(), String> {
    let pool = get_pool().await?;

    if thread.id.is_empty() {
        return Err("Missing thread id".to_string());
    }

    let data = serde_json::to_string(&thread).map_err(|e| e.to_string())?;

    sqlx::query("UPDATE threads SET data = ?1, updated_at = strftime('%s', 'now') WHERE id = ?2")
        .bind(&data)
        .bind(&thread.id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to modify thread: {}", e))?;

    Ok(())
}

/// Delete a thread from database
pub async fn db_delete_thread<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: &str,
) -> Result<(), String> {
    let pool = get_pool().await?;

    // Messages will be auto-deleted via CASCADE
    sqlx::query("DELETE FROM threads WHERE id = ?1")
        .bind(thread_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to delete thread: {}", e))?;

    Ok(())
}

/// List all messages for a thread from database
pub async fn db_list_messages<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: &str,
) -> Result<Vec<MessageRecord>, String> {
    let pool = get_pool().await?;

    let rows =
        sqlx::query("SELECT data FROM messages WHERE thread_id = ?1 ORDER BY created_at ASC")
            .bind(thread_id)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("Failed to list messages: {}", e))?;

    let messages: Result<Vec<MessageRecord>, _> = rows
        .iter()
        .map(|row| {
            let data: String = row.get("data");
            serde_json::from_str(&data).map_err(|e| e.to_string())
        })
        .collect();

    messages
}

/// Create a new message in database
pub async fn db_create_message<R: Runtime>(
    _app_handle: AppHandle<R>,
    message: MessageRecord,
) -> Result<MessageRecord, String> {
    let pool = get_pool().await?;

    if message.id.is_empty() {
        return Err("Missing message id".to_string());
    }
    if message.thread_id.is_empty() {
        return Err("Missing thread_id".to_string());
    }

    let data = serde_json::to_string(&message).map_err(|e| e.to_string())?;

    sqlx::query("INSERT INTO messages (id, thread_id, data) VALUES (?1, ?2, ?3)")
        .bind(&message.id)
        .bind(&message.thread_id)
        .bind(&data)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create message: {}", e))?;

    Ok(message)
}

/// Modify an existing message in database
pub async fn db_modify_message<R: Runtime>(
    _app_handle: AppHandle<R>,
    message: MessageRecord,
) -> Result<MessageRecord, String> {
    let pool = get_pool().await?;

    if message.id.is_empty() {
        return Err("Missing message id".to_string());
    }

    let data = serde_json::to_string(&message).map_err(|e| e.to_string())?;

    sqlx::query("UPDATE messages SET data = ?1 WHERE id = ?2")
        .bind(&data)
        .bind(&message.id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to modify message: {}", e))?;

    Ok(message)
}

/// Delete a message from database
pub async fn db_delete_message<R: Runtime>(
    _app_handle: AppHandle<R>,
    _thread_id: &str,
    message_id: &str,
) -> Result<(), String> {
    let pool = get_pool().await?;

    sqlx::query("DELETE FROM messages WHERE id = ?1")
        .bind(message_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to delete message: {}", e))?;

    Ok(())
}

/// Get thread assistant information from thread metadata
pub async fn db_get_thread_assistant<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: &str,
) -> Result<Value, String> {
    let pool = get_pool().await?;

    let row = sqlx::query("SELECT data FROM threads WHERE id = ?1")
        .bind(thread_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("Failed to get thread: {}", e))?
        .ok_or("Thread not found")?;

    let data: String = row.get("data");
    let thread: ThreadRecord = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    thread
        .assistants
        .first()
        .cloned()
        .ok_or("Assistant not found".to_string())
}

/// Create thread assistant in database
pub async fn db_create_thread_assistant<R: Runtime>(
    app_handle: AppHandle<R>,
    thread_id: &str,
    assistant: Value,
) -> Result<Value, String> {
    let pool = get_pool().await?;

    let row = sqlx::query("SELECT data FROM threads WHERE id = ?1")
        .bind(thread_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("Failed to get thread: {}", e))?
        .ok_or("Thread not found")?;

    let data: String = row.get("data");
    let mut thread: ThreadRecord = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    thread.assistants.push(assistant.clone());

    db_modify_thread(app_handle, thread).await?;
    Ok(assistant)
}

/// Modify thread assistant in database
pub async fn db_modify_thread_assistant<R: Runtime>(
    app_handle: AppHandle<R>,
    thread_id: &str,
    assistant: Value,
) -> Result<Value, String> {
    let pool = get_pool().await?;

    let row = sqlx::query("SELECT data FROM threads WHERE id = ?1")
        .bind(thread_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("Failed to get thread: {}", e))?
        .ok_or("Thread not found")?;

    let data: String = row.get("data");
    let mut thread: ThreadRecord = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    let assistant_id = assistant
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing assistant id")?;

    if let Some(index) = thread
        .assistants
        .iter()
        .position(|a| a.get("id").and_then(|v| v.as_str()) == Some(assistant_id))
    {
        thread.assistants[index] = assistant.clone();
        db_modify_thread(app_handle, thread).await?;
    }

    Ok(assistant)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::test::mock_app;

    async fn setup_test_pool() -> AppHandle<tauri::test::MockRuntime> {
        let app = mock_app();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let db_path = std::env::temp_dir().join(format!("ax-studio-threads-{nanos}.db"));
        let db_url = format!("sqlite:{}", db_path.display());
        let pool = connect_pool(&db_url).await.unwrap();

        DB_POOL
            .get_or_init(|| Mutex::new(None))
            .lock()
            .await
            .replace(pool);

        app.handle().clone()
    }

    fn sample_thread(id: &str) -> ThreadRecord {
        ThreadRecord {
            id: id.to_string(),
            object: "thread".to_string(),
            title: Some(format!("Thread {id}")),
            assistants: vec![],
            created: Some(1),
            updated: Some(1),
            metadata: Some(json!({"source": "test"})),
            extra: Default::default(),
        }
    }

    fn sample_message(id: &str, thread_id: &str) -> MessageRecord {
        MessageRecord {
            id: id.to_string(),
            object: "thread.message".to_string(),
            thread_id: thread_id.to_string(),
            assistant_id: Some("assistant-1".to_string()),
            attachments: None,
            role: "user".to_string(),
            content: vec![json!({"type": "text", "text": "hello"})],
            status: Some("completed".to_string()),
            created_at: Some(1),
            completed_at: Some(2),
            metadata: None,
            type_: None,
            error_code: None,
            tool_call_id: None,
            extra: Default::default(),
        }
    }

    #[tokio::test]
    async fn test_thread_and_message_crud_round_trip() {
        let app = setup_test_pool().await;

        let thread = sample_thread("thread-1");
        let created = db_create_thread(app.clone(), thread.clone()).await.unwrap();
        assert_eq!(created, thread);

        let listed_threads = db_list_threads(app.clone()).await.unwrap();
        assert_eq!(listed_threads.len(), 1);
        assert_eq!(listed_threads[0].id, "thread-1");

        let modified_thread = ThreadRecord {
            title: Some("Updated Thread".to_string()),
            updated: Some(2),
            ..thread.clone()
        };
        db_modify_thread(app.clone(), modified_thread.clone())
            .await
            .unwrap();

        let listed_threads = db_list_threads(app.clone()).await.unwrap();
        assert_eq!(listed_threads[0].title.as_deref(), Some("Updated Thread"));

        let message = sample_message("message-1", "thread-1");
        let created_message = db_create_message(app.clone(), message.clone())
            .await
            .unwrap();
        assert_eq!(created_message, message);

        let listed_messages = db_list_messages(app.clone(), "thread-1").await.unwrap();
        assert_eq!(listed_messages.len(), 1);
        assert_eq!(listed_messages[0].id, "message-1");

        let modified_message = MessageRecord {
            role: "assistant".to_string(),
            ..message.clone()
        };
        let updated_message = db_modify_message(app.clone(), modified_message.clone())
            .await
            .unwrap();
        assert_eq!(updated_message.role, "assistant");

        let listed_messages = db_list_messages(app.clone(), "thread-1").await.unwrap();
        assert_eq!(listed_messages[0].role, "assistant");

        db_delete_message(app.clone(), "thread-1", "message-1")
            .await
            .unwrap();
        assert!(db_list_messages(app.clone(), "thread-1")
            .await
            .unwrap()
            .is_empty());

        db_delete_thread(app, "thread-1").await.unwrap();
        assert!(db_list_threads(mock_app().handle().clone())
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn test_thread_assistant_crud_round_trip() {
        let app = setup_test_pool().await;
        db_create_thread(app.clone(), sample_thread("thread-assistant"))
            .await
            .unwrap();

        let assistant = json!({
            "id": "assistant-1",
            "name": "Planner",
        });
        let created =
            db_create_thread_assistant(app.clone(), "thread-assistant", assistant.clone())
                .await
                .unwrap();
        assert_eq!(created, assistant);

        let fetched = db_get_thread_assistant(app.clone(), "thread-assistant")
            .await
            .unwrap();
        assert_eq!(fetched["id"], "assistant-1");

        let updated_assistant = json!({
            "id": "assistant-1",
            "name": "Planner v2",
        });
        let updated =
            db_modify_thread_assistant(app.clone(), "thread-assistant", updated_assistant.clone())
                .await
                .unwrap();
        assert_eq!(updated, updated_assistant);

        let fetched = db_get_thread_assistant(app, "thread-assistant")
            .await
            .unwrap();
        assert_eq!(fetched["name"], "Planner v2");
    }
}
