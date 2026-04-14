use super::commands::*;
use super::helpers::should_use_sqlite;
use super::models::{MessageRecord, ThreadRecord};
use crate::core::app::commands::get_app_data_folder_path;
use futures_util::future;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use tauri::test::{mock_app, MockRuntime};

// Helper to create a mock app handle with a temp data dir
fn mock_app_with_temp_data_dir() -> (tauri::App<MockRuntime>, PathBuf) {
    let app = mock_app();
    // Get the actual data dir that will be used by storage code
    let data_dir = get_app_data_folder_path(app.handle().clone());
    println!("Mock app data dir: {}", data_dir.display());
    (app, data_dir)
}

// Helper to create a basic thread
fn create_test_thread(title: &str) -> ThreadRecord {
    ThreadRecord {
        object: "thread".to_string(),
        title: Some(title.to_string()),
        assistants: vec![],
        created: Some(123),
        updated: Some(123),
        metadata: None,
        ..Default::default()
    }
}

// Helper to create a basic message
fn create_test_message(thread_id: &str, content_text: &str) -> MessageRecord {
    MessageRecord {
        object: "message".to_string(),
        thread_id: thread_id.to_string(),
        role: "user".to_string(),
        content: vec![json!({"type": "text", "text": content_text})],
        status: Some("sent".to_string()),
        created_at: Some(123),
        completed_at: Some(123),
        metadata: None,
        ..Default::default()
    }
}

#[tokio::test]
async fn test_create_and_list_threads() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    // Create a thread
    let thread = ThreadRecord {
        object: "thread".to_string(),
        title: Some("Test Thread".to_string()),
        assistants: vec![],
        created: Some(1234567890),
        updated: Some(1234567890),
        metadata: None,
        ..Default::default()
    };
    let created = create_thread(app.handle().clone(), thread).await.unwrap();
    assert_eq!(created.title.as_deref(), Some("Test Thread"));

    // List threads
    let threads = list_threads(app.handle().clone()).await.unwrap();
    assert!(!threads.is_empty());

    // Clean up
    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_create_and_list_messages() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    // Create a thread first
    let thread = ThreadRecord {
        object: "thread".to_string(),
        title: Some("Msg Thread".to_string()),
        assistants: vec![],
        created: Some(123),
        updated: Some(123),
        metadata: None,
        ..Default::default()
    };
    let created = create_thread(app.handle().clone(), thread).await.unwrap();
    let thread_id = created.id.clone();

    // Create a message
    let message = MessageRecord {
        object: "message".to_string(),
        thread_id: thread_id.clone(),
        role: "user".to_string(),
        content: vec![],
        status: Some("sent".to_string()),
        created_at: Some(123),
        completed_at: Some(123),
        ..Default::default()
    };
    let created_msg = create_message(app.handle().clone(), message).await.unwrap();
    assert_eq!(created_msg.role, "user");

    // List messages
    let messages = list_messages(app.handle().clone(), thread_id.clone())
        .await
        .unwrap();
    assert!(
        !messages.is_empty(),
        "Expected at least one message, but got none. Thread ID: {thread_id}"
    );
    assert_eq!(messages[0].role, "user");

    // Clean up
    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_create_and_get_thread_assistant() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    // Create a thread
    let thread = ThreadRecord {
        object: "thread".to_string(),
        title: Some("Assistant Thread".to_string()),
        assistants: vec![],
        created: Some(1),
        updated: Some(1),
        metadata: None,
        ..Default::default()
    };
    let created = create_thread(app.handle().clone(), thread).await.unwrap();
    let thread_id = created.id.clone();

    // Add assistant
    let assistant = json!({
        "id": "assistant-1",
        "assistant_name": "Test Assistant",
        "model": {
            "id": "model-1",
            "name": "Test Model",
            "settings": json!({})
        },
        "instructions": null,
        "tools": null
    });
    let _ = create_thread_assistant(app.handle().clone(), thread_id.clone(), assistant.clone())
        .await
        .unwrap();

    // Get assistant
    let got = get_thread_assistant(app.handle().clone(), thread_id.clone())
        .await
        .unwrap();
    assert_eq!(got["assistant_name"], "Test Assistant");

    // Clean up
    let _ = fs::remove_dir_all(data_dir);
}

#[test]
fn test_should_use_sqlite_platform_detection() {
    assert!(
        !should_use_sqlite(),
        "should_use_sqlite should return false on desktop platforms"
    );
}

#[tokio::test]
async fn test_desktop_storage_backend() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    {

        // Create a thread
        let thread = ThreadRecord {
            object: "thread".to_string(),
            title: Some("Desktop Test Thread".to_string()),
            assistants: vec![],
            created: Some(1234567890),
            updated: Some(1234567890),
            metadata: None,
            ..Default::default()
        };

        let created = create_thread(app.handle().clone(), thread).await.unwrap();
        let thread_id = created.id.clone();

        // Verify we can retrieve the thread (which proves file storage works)
        let threads = list_threads(app.handle().clone()).await.unwrap();
        let found = threads.iter().any(|t| t.id == thread_id);
        assert!(
            found,
            "Thread should be retrievable from file-based storage"
        );

        // Create a message
        let message = MessageRecord {
            object: "message".to_string(),
            thread_id: thread_id.clone(),
            role: "user".to_string(),
            content: vec![],
            status: Some("sent".to_string()),
            created_at: Some(123),
            completed_at: Some(123),
            ..Default::default()
        };

        let _created_msg = create_message(app.handle().clone(), message).await.unwrap();

        // Verify we can retrieve the message (which proves file storage works)
        let messages = list_messages(app.handle().clone(), thread_id.clone())
            .await
            .unwrap();
        assert_eq!(
            messages.len(),
            1,
            "Message should be retrievable from file-based storage"
        );

        // Clean up - get the actual data directory used by the app
        use super::utils::get_data_dir;
        let actual_data_dir = get_data_dir(app.handle().clone());
        let _ = fs::remove_dir_all(actual_data_dir);
    }
}

#[tokio::test]
async fn test_modify_and_delete_thread() {
    let (app, data_dir) = mock_app_with_temp_data_dir();

    // Create a thread
    let thread = ThreadRecord {
        object: "thread".to_string(),
        title: Some("Original Title".to_string()),
        assistants: vec![],
        created: Some(1234567890),
        updated: Some(1234567890),
        metadata: None,
        ..Default::default()
    };

    let created = create_thread(app.handle().clone(), thread).await.unwrap();
    let thread_id = created.id.clone();

    // Modify the thread
    let mut modified_thread = created.clone();
    modified_thread.title = Some("Modified Title".to_string());

    modify_thread(app.handle().clone(), modified_thread.clone())
        .await
        .unwrap();

    // Verify modification by listing threads
    let threads = list_threads(app.handle().clone()).await.unwrap();
    let found_thread = threads.iter().find(|t| t.id == thread_id);
    assert!(found_thread.is_some(), "Modified thread should exist");
    assert_eq!(
        found_thread.unwrap().title.as_deref(),
        Some("Modified Title")
    );

    // Delete the thread
    delete_thread(app.handle().clone(), thread_id.clone())
        .await
        .unwrap();

    // Verify deletion
    let thread_dir = data_dir.join(&thread_id);
    assert!(!thread_dir.exists(), "Thread directory should be deleted");

    // Clean up
    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_modify_and_delete_message() {
    let (app, data_dir) = mock_app_with_temp_data_dir();

    // Create a thread
    let thread = ThreadRecord {
        object: "thread".to_string(),
        title: Some("Message Test Thread".to_string()),
        assistants: vec![],
        created: Some(123),
        updated: Some(123),
        metadata: None,
        ..Default::default()
    };

    let created = create_thread(app.handle().clone(), thread).await.unwrap();
    let thread_id = created.id.clone();

    // Create a message
    let message = create_test_message(&thread_id, "Original content");

    let created_msg = create_message(app.handle().clone(), message).await.unwrap();
    let message_id = created_msg.id.clone();

    // Modify the message
    let mut modified_msg = created_msg.clone();
    modified_msg.content = vec![json!({"type": "text", "text": "Modified content"})];

    modify_message(app.handle().clone(), modified_msg.clone())
        .await
        .unwrap();

    // Verify modification
    let messages = list_messages(app.handle().clone(), thread_id.clone())
        .await
        .unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].content[0]["text"], "Modified content");

    // Delete the message
    delete_message(app.handle().clone(), thread_id.clone(), message_id.clone())
        .await
        .unwrap();

    // Verify deletion
    let messages = list_messages(app.handle().clone(), thread_id.clone())
        .await
        .unwrap();
    assert_eq!(messages.len(), 0, "Message should be deleted");

    // Clean up
    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_modify_thread_assistant() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let app_handle = app.handle().clone();

    let created = create_thread(
        app_handle.clone(),
        create_test_thread("Assistant Mod Thread"),
    )
    .await
    .unwrap();
    let thread_id = created.id.clone();

    let assistant = json!({
        "id": "assistant-1",
        "assistant_name": "Original Assistant",
        "model": {"id": "model-1", "name": "Test Model"}
    });

    create_thread_assistant(app_handle.clone(), thread_id.clone(), assistant.clone())
        .await
        .unwrap();

    let mut modified_assistant = assistant;
    modified_assistant["assistant_name"] = json!("Modified Assistant");

    modify_thread_assistant(app_handle.clone(), thread_id.clone(), modified_assistant)
        .await
        .unwrap();

    let retrieved = get_thread_assistant(app_handle, thread_id).await.unwrap();
    assert_eq!(retrieved["assistant_name"], "Modified Assistant");

    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_thread_not_found_errors() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let app_handle = app.handle().clone();
    let fake_thread_id = "non-existent-thread-id".to_string();
    let assistant = json!({"id": "assistant-1", "assistant_name": "Test Assistant"});

    assert!(
        get_thread_assistant(app_handle.clone(), fake_thread_id.clone())
            .await
            .is_err()
    );
    assert!(create_thread_assistant(
        app_handle.clone(),
        fake_thread_id.clone(),
        assistant.clone()
    )
    .await
    .is_err());
    assert!(
        modify_thread_assistant(app_handle, fake_thread_id, assistant)
            .await
            .is_err()
    );

    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_message_without_id_gets_generated() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let app_handle = app.handle().clone();

    let created = create_thread(app_handle.clone(), create_test_thread("Message ID Test"))
        .await
        .unwrap();
    let thread_id = created.id.clone();

    let message = MessageRecord {
        object: "message".to_string(),
        thread_id,
        role: "user".to_string(),
        content: vec![],
        status: Some("sent".to_string()),
        ..Default::default()
    };
    let created_msg = create_message(app_handle, message).await.unwrap();

    assert!(!created_msg.id.is_empty());

    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_concurrent_message_operations() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let app_handle = app.handle().clone();

    let created = create_thread(app_handle.clone(), create_test_thread("Concurrent Test"))
        .await
        .unwrap();
    let thread_id = created.id.clone();

    let handles: Vec<_> = (0..5)
        .map(|i| {
            let app_h = app_handle.clone();
            let tid = thread_id.clone();
            tokio::spawn(async move {
                create_message(app_h, create_test_message(&tid, &format!("Message {i}"))).await
            })
        })
        .collect();

    let results = future::join_all(handles).await;
    assert!(results
        .iter()
        .all(|r| r.is_ok() && r.as_ref().unwrap().is_ok()));

    let messages = list_messages(app_handle, thread_id).await.unwrap();
    assert_eq!(messages.len(), 5);

    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_empty_thread_list() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let threads = list_threads(app.handle().clone()).await.unwrap();
    assert_eq!(threads.len(), 0);
    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_empty_message_list() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let app_handle = app.handle().clone();

    let created = create_thread(
        app_handle.clone(),
        create_test_thread("Empty Messages Test"),
    )
    .await
    .unwrap();
    let thread_id = created.id.clone();

    let messages = list_messages(app_handle, thread_id).await.unwrap();
    assert_eq!(messages.len(), 0);

    let _ = fs::remove_dir_all(data_dir);
}
