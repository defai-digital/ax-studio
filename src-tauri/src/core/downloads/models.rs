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
