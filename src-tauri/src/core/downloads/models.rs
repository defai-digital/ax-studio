use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct DownloadManagerState {
    pub cancel_tokens: HashMap<String, CancellationToken>,
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
}

/// Structure to track progress for each file in parallel downloads
/// Tracks (transferred, total) per file_id
#[derive(Clone)]
pub struct ProgressTracker {
    file_stats: Arc<Mutex<HashMap<String, (u64, u64)>>>,
}

impl ProgressTracker {
    pub fn new(initial_sizes: HashMap<String, u64>) -> Self {
        let mut file_stats = HashMap::new();
        for (id, size) in initial_sizes {
            file_stats.insert(id, (0, size));
        }
        ProgressTracker {
            file_stats: Arc::new(Mutex::new(file_stats)),
        }
    }

    /// Update transferred bytes for a file
    pub async fn update_progress(&self, file_id: &str, transferred: u64) {
        let mut stats = self.file_stats.lock().await;
        if let Some(entry) = stats.get_mut(file_id) {
            entry.0 = transferred;
        }
    }

    /// Refine total size for a file (useful if HEAD was 0 but GET has Content-Length)
    pub async fn set_file_total(&self, file_id: &str, total: u64) {
        let mut stats = self.file_stats.lock().await;
        if let Some(entry) = stats.get_mut(file_id) {
            entry.1 = total;
        }
    }

    /// Get combined (transferred, total) across all files
    pub async fn get_total_progress(&self) -> (u64, u64) {
        let stats = self.file_stats.lock().await;
        let mut total_transferred = 0;
        let mut total_size = 0;
        for (transferred, size) in stats.values() {
            total_transferred += transferred;
            total_size += size;
        }
        (total_transferred, total_size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- DownloadEvent serialization ---

    #[test]
    fn test_download_event_serialize() {
        let evt = DownloadEvent {
            transferred: 500,
            total: 1000,
        };
        let json = serde_json::to_value(&evt).unwrap();
        assert_eq!(json["transferred"], 500);
        assert_eq!(json["total"], 1000);
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
    async fn test_progress_tracker_update_nonexistent_file_is_noop() {
        let sizes = HashMap::new();
        let tracker = ProgressTracker::new(sizes);
        tracker.update_progress("nonexistent", 100).await;
        let (transferred, total) = tracker.get_total_progress().await;
        assert_eq!(transferred, 0);
        assert_eq!(total, 0);
    }
}
