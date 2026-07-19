use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tokio_util::sync::CancellationToken;

const MAX_ACTIVE_DOWNLOAD_TASKS: usize = 16;

#[derive(Clone)]
pub struct DownloadTaskState {
    pub token: CancellationToken,
    pub generation: u64,
    pub destination_keys: Vec<String>,
}

#[derive(Default)]
pub struct DownloadManagerState {
    pub cancel_tokens: HashMap<String, DownloadTaskState>,
    pub next_generation: u64,
}

impl DownloadManagerState {
    pub fn register_task(
        &mut self,
        task_id: &str,
        token: CancellationToken,
        destination_keys: Vec<String>,
    ) -> Result<u64, String> {
        if self.cancel_tokens.contains_key(task_id) {
            return Err(format!("Download task '{task_id}' is already active"));
        }
        if self.cancel_tokens.len() >= MAX_ACTIVE_DOWNLOAD_TASKS {
            return Err(format!(
                "Too many active download tasks (maximum {MAX_ACTIVE_DOWNLOAD_TASKS})"
            ));
        }

        if let Some(conflict) = destination_keys.iter().find(|candidate| {
            self.cancel_tokens
                .values()
                .any(|task| task.destination_keys.contains(candidate))
        }) {
            return Err(format!(
                "Another active download already owns destination '{conflict}'"
            ));
        }

        self.next_generation = self
            .next_generation
            .checked_add(1)
            .ok_or_else(|| "Download generation counter exhausted".to_string())?;
        let generation = self.next_generation;
        self.cancel_tokens.insert(
            task_id.to_string(),
            DownloadTaskState {
                token,
                generation,
                destination_keys,
            },
        );
        Ok(generation)
    }

    pub fn finish_task(&mut self, task_id: &str, generation: u64) {
        if self
            .cancel_tokens
            .get(task_id)
            .is_some_and(|task| task.generation == generation)
        {
            self.cancel_tokens.remove(task_id);
        }
    }
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct ProxyConfig {
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub no_proxy: Option<Vec<String>>, // List of domains to bypass proxy
    pub ignore_ssl: Option<bool>,      // Ignore SSL certificate verification
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct DownloadItem {
    pub url: String,
    pub save_path: String,
    pub proxy: Option<ProxyConfig>,
    pub sha256: Option<String>,
    pub size: Option<u64>,
    pub model_id: Option<String>,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct DownloadEvent {
    pub transferred: u64,
    pub total: u64,
    #[serde(rename = "downloadId", skip_serializing_if = "Option::is_none")]
    pub download_id: Option<String>,
    #[serde(rename = "modelId", skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
}

/// Structure to track progress for each file in parallel downloads
/// Tracks (transferred, total) per file_id
#[derive(Clone)]
pub struct ProgressTracker {
    file_stats: Arc<HashMap<String, FileProgress>>,
}

struct FileProgress {
    transferred: AtomicU64,
    total: AtomicU64,
}

impl ProgressTracker {
    pub fn new(initial_sizes: HashMap<String, u64>) -> Self {
        let mut file_stats = HashMap::new();
        for (id, size) in initial_sizes {
            file_stats.insert(
                id,
                FileProgress {
                    transferred: AtomicU64::new(0),
                    total: AtomicU64::new(size),
                },
            );
        }
        ProgressTracker {
            file_stats: Arc::new(file_stats),
        }
    }

    /// Update transferred bytes for a file
    pub async fn update_progress(&self, file_id: &str, transferred: u64) {
        if let Some(entry) = self.file_stats.get(file_id) {
            entry.transferred.store(transferred, Ordering::Relaxed);
        }
    }

    /// Refine total size for a file (useful if HEAD was 0 but GET has Content-Length)
    pub async fn set_file_total(&self, file_id: &str, total: u64) {
        if let Some(entry) = self.file_stats.get(file_id) {
            entry.total.store(total, Ordering::Relaxed);
        }
    }

    /// Get combined (transferred, total) across all files
    pub async fn get_total_progress(&self) -> (u64, u64) {
        let mut total_transferred: u64 = 0;
        let mut total_size: u64 = 0;
        for progress in self.file_stats.values() {
            total_transferred =
                total_transferred.saturating_add(progress.transferred.load(Ordering::Relaxed));
            total_size = total_size.saturating_add(progress.total.load(Ordering::Relaxed));
        }
        (total_transferred, total_size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_manager_reserves_task_ids_and_destinations_until_finish() {
        let mut manager = DownloadManagerState::default();
        let first_generation = manager
            .register_task(
                "task-a",
                CancellationToken::new(),
                vec!["/models/a.gguf".to_string()],
            )
            .unwrap();

        assert!(manager
            .register_task(
                "task-a",
                CancellationToken::new(),
                vec!["/models/b.gguf".to_string()],
            )
            .unwrap_err()
            .contains("already active"));
        assert!(manager
            .register_task(
                "task-b",
                CancellationToken::new(),
                vec!["/models/a.gguf".to_string()],
            )
            .unwrap_err()
            .contains("already owns destination"));

        manager.finish_task("task-a", first_generation + 1);
        assert!(manager.cancel_tokens.contains_key("task-a"));
        manager.finish_task("task-a", first_generation);
        assert!(!manager.cancel_tokens.contains_key("task-a"));

        assert!(manager
            .register_task(
                "task-b",
                CancellationToken::new(),
                vec!["/models/a.gguf".to_string()],
            )
            .is_ok());
    }

    #[test]
    fn download_manager_reserves_resume_artifact_names_across_tasks() {
        let mut manager = DownloadManagerState::default();
        manager
            .register_task(
                "task-a",
                CancellationToken::new(),
                vec![
                    "/models/a.gguf".to_string(),
                    "/models/a.gguf.tmp".to_string(),
                    "/models/a.gguf.url".to_string(),
                ],
            )
            .unwrap();

        for artifact in ["/models/a.gguf.tmp", "/models/a.gguf.url"] {
            assert!(manager
                .register_task(
                    "task-b",
                    CancellationToken::new(),
                    vec![artifact.to_string()],
                )
                .unwrap_err()
                .contains("already owns destination"));
        }
    }

    #[test]
    fn download_manager_rejects_generation_overflow_without_registering() {
        let mut manager = DownloadManagerState {
            next_generation: u64::MAX,
            ..Default::default()
        };
        assert!(manager
            .register_task(
                "task",
                CancellationToken::new(),
                vec!["/models/a.gguf".to_string()],
            )
            .is_err());
        assert!(manager.cancel_tokens.is_empty());
    }

    #[test]
    fn download_manager_enforces_active_task_limit() {
        let mut manager = DownloadManagerState::default();
        for index in 0..MAX_ACTIVE_DOWNLOAD_TASKS {
            manager
                .register_task(
                    &format!("task-{index}"),
                    CancellationToken::new(),
                    vec![format!("/models/{index}.gguf")],
                )
                .unwrap();
        }

        assert!(manager
            .register_task(
                "one-too-many",
                CancellationToken::new(),
                vec!["/models/overflow.gguf".to_string()],
            )
            .unwrap_err()
            .contains("Too many active download tasks"));
    }

    // --- DownloadEvent serialization ---

    #[test]
    fn test_download_event_serialize() {
        let evt = DownloadEvent {
            transferred: 500,
            total: 1000,
            download_id: Some("task-1".to_string()),
            model_id: Some("model-1".to_string()),
        };
        let json = serde_json::to_value(&evt).unwrap();
        assert_eq!(json["transferred"], 500);
        assert_eq!(json["total"], 1000);
        assert_eq!(json["downloadId"], "task-1");
        assert_eq!(json["modelId"], "model-1");
    }

    // --- ProxyConfig deserialization ---

    #[test]
    fn test_proxy_config_deserialize_minimal() {
        let json = serde_json::json!({"url": "http://proxy:8080"});
        let config: ProxyConfig = serde_json::from_value(json).unwrap();
        assert_eq!(config.url, "http://proxy:8080");
        assert!(config.username.is_none());
        assert!(config.password.is_none());
        assert!(config.no_proxy.is_none());
        assert!(config.ignore_ssl.is_none());
    }

    #[test]
    fn test_proxy_config_deserialize_full() {
        let json = serde_json::json!({
            "url": "socks5://proxy:1080",
            "username": "user",
            "password": "pass",
            "no_proxy": ["localhost", "*.internal"],
            "ignore_ssl": true
        });
        let config: ProxyConfig = serde_json::from_value(json).unwrap();
        assert_eq!(config.url, "socks5://proxy:1080");
        assert_eq!(config.username.unwrap(), "user");
        assert_eq!(config.password.unwrap(), "pass");
        assert_eq!(config.no_proxy.unwrap().len(), 2);
        assert!(config.ignore_ssl.unwrap());
    }

    // --- DownloadItem deserialization ---

    #[test]
    fn test_download_item_deserialize() {
        let json = serde_json::json!({
            "url": "https://example.com/model.gguf",
            "save_path": "models/model.gguf",
            "sha256": "abc123",
            "size": 1024
        });
        let item: DownloadItem = serde_json::from_value(json).unwrap();
        assert_eq!(item.url, "https://example.com/model.gguf");
        assert_eq!(item.save_path, "models/model.gguf");
        assert_eq!(item.sha256.unwrap(), "abc123");
        assert_eq!(item.size.unwrap(), 1024);
        assert!(item.proxy.is_none());
        assert!(item.model_id.is_none());
    }

    // --- ProgressTracker ---

    #[tokio::test]
    async fn test_progress_tracker_initial_state() {
        let mut sizes = HashMap::new();
        sizes.insert("file-0".to_string(), 1000);
        sizes.insert("file-1".to_string(), 2000);

        let tracker = ProgressTracker::new(sizes);
        let (transferred, total) = tracker.get_total_progress().await;
        assert_eq!(transferred, 0);
        assert_eq!(total, 3000);
    }

    #[tokio::test]
    async fn test_progress_tracker_update_progress() {
        let mut sizes = HashMap::new();
        sizes.insert("file-0".to_string(), 1000);
        let tracker = ProgressTracker::new(sizes);

        tracker.update_progress("file-0", 500).await;
        let (transferred, total) = tracker.get_total_progress().await;
        assert_eq!(transferred, 500);
        assert_eq!(total, 1000);
    }

    #[tokio::test]
    async fn test_progress_tracker_set_file_total() {
        let mut sizes = HashMap::new();
        sizes.insert("file-0".to_string(), 0);
        let tracker = ProgressTracker::new(sizes);

        tracker.set_file_total("file-0", 5000).await;
        let (transferred, total) = tracker.get_total_progress().await;
        assert_eq!(transferred, 0);
        assert_eq!(total, 5000);
    }

    #[tokio::test]
    async fn test_progress_tracker_multiple_files() {
        let mut sizes = HashMap::new();
        sizes.insert("a".to_string(), 1000);
        sizes.insert("b".to_string(), 2000);
        let tracker = ProgressTracker::new(sizes);

        tracker.update_progress("a", 500).await;
        tracker.update_progress("b", 1500).await;

        let (transferred, total) = tracker.get_total_progress().await;
        assert_eq!(transferred, 2000);
        assert_eq!(total, 3000);
    }

    #[tokio::test]
    async fn test_progress_tracker_saturates_untrusted_totals() {
        let tracker = ProgressTracker::new(HashMap::from([
            ("a".to_string(), u64::MAX),
            ("b".to_string(), 1),
        ]));
        tracker.update_progress("a", u64::MAX).await;
        tracker.update_progress("b", 1).await;

        assert_eq!(tracker.get_total_progress().await, (u64::MAX, u64::MAX));
    }

    #[tokio::test]
    async fn test_progress_tracker_update_nonexistent_file_is_noop() {
        let sizes = HashMap::new();
        let tracker = ProgressTracker::new(sizes);
        tracker.update_progress("nonexistent", 100).await;
        let (transferred, total) = tracker.get_total_progress().await;
        assert_eq!(transferred, 0);
        assert_eq!(total, 0);
    }
}
