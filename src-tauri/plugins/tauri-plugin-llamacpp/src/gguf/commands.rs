use super::types::GgufMetadata;
use super::utils::{estimate_kv_cache_internal, read_gguf_metadata_internal};
use crate::gguf::types::{KVCacheError, KVCacheEstimate, ModelSupportStatus};
use std::collections::HashMap;
use std::fs;
use tauri_plugin_hardware::get_system_info;

fn is_allowed_model_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only HTTP/HTTPS URLs are allowed for model metadata".to_string());
    }
    let host_str = parsed.host_str().unwrap_or("");
    if host_str.is_empty() {
        return Err("URL has no host".to_string());
    }
    let allowed = ["huggingface.co", "hf.co", "cdn-lfs.huggingface.co", "cdn-lfs-us-1.huggingface.co"];
    if !allowed.iter().any(|d| host_str == *d || host_str.ends_with(&format!(".{d}"))) {
        return Err(format!("Model metadata URL host '{host_str}' is not in the allowlist"));
    }
    if parsed.socket_addrs(|| None).map_or(false, |addrs| {
        addrs.iter().any(|a| match a.ip() {
            std::net::IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_unspecified(),
            std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
        })
    }) {
        return Err("Model metadata URL resolves to an internal/private address".to_string());
    }
    Ok(())
}
/// Read GGUF metadata from a model file
#[tauri::command]
pub async fn read_gguf_metadata(path: String) -> Result<GgufMetadata, String> {
    return read_gguf_metadata_internal(path).await;
}

#[tauri::command]
pub async fn estimate_kv_cache_size(
    meta: HashMap<String, String>,
    ctx_size: Option<u64>,
) -> Result<KVCacheEstimate, KVCacheError> {
    estimate_kv_cache_internal(meta, ctx_size).await
}

#[tauri::command]
pub async fn get_model_size(path: String) -> Result<u64, String> {
    if path.starts_with("https://") || path.starts_with("http://") {
        is_allowed_model_url(&path)?;

        let client = reqwest::Client::new();
        let response = client
            .head(&path)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch HEAD request: {}", e))?;

        if let Some(content_length) = response.headers().get("content-length") {
            let content_length_str = content_length
                .to_str()
                .map_err(|e| format!("Invalid content-length header: {}", e))?;
            content_length_str
                .parse::<u64>()
                .map_err(|e| format!("Failed to parse content-length: {}", e))
        } else {
            Ok(0)
        }
    } else {
        // Handle local file using standard fs
        let metadata =
            fs::metadata(&path).map_err(|e| format!("Failed to get file metadata: {}", e))?;
        Ok(metadata.len())
    }
}

#[tauri::command]
pub async fn is_model_supported(
    path: String,
    ctx_size: Option<u32>,
) -> Result<ModelSupportStatus, String> {
    // Get model size
    let model_size = get_model_size(path.clone()).await?;

    // Get system info
    let system_info = get_system_info();

    log::info!("modelSize: {}", model_size);

    // Read GGUF metadata
    let gguf = read_gguf_metadata(path.clone()).await?;

    // Calculate KV cache size
    let kv_cache_size = if let Some(ctx_size) = ctx_size {
        log::info!("Using ctx_size: {}", ctx_size);
        estimate_kv_cache_internal(gguf.metadata, Some(ctx_size as u64))
            .await
            .map_err(|e| e.to_string())?
            .size
    } else {
        estimate_kv_cache_internal(gguf.metadata, None)
            .await
            .map_err(|e| e.to_string())?
            .size
    };

    // Total memory consumption = model weights + kvcache
    let total_required = model_size + kv_cache_size;
    log::info!(
        "isModelSupported: Total memory requirement: {} for {}; Got kvCacheSize: {} from BE",
        total_required,
        path,
        kv_cache_size
    );

    const RESERVE_BYTES: u64 = 2288490189;
    let total_system_memory: u64 = match system_info.gpus.is_empty() {
        // on MacOS with unified memory, treat RAM = 0 for now
        true => 0,
        false => system_info.total_memory * 1024 * 1024,
    };

    // Calculate total VRAM from all GPUs
    let total_vram: u64 = match system_info.gpus.is_empty() {
        // On macOS with unified memory, GPU info may be empty
        // Use total RAM as VRAM since memory is shared
        true => {
            log::info!("No GPUs detected (likely unified memory system), using total RAM as VRAM");
            system_info.total_memory * 1024 * 1024
        }
        false => system_info
            .gpus
            .iter()
            .map(|g| g.total_memory * 1024 * 1024)
            .sum::<u64>(),
    };

    log::info!("Total VRAM reported/calculated (in bytes): {}", &total_vram);

    let usable_vram = if total_vram > RESERVE_BYTES {
        total_vram - RESERVE_BYTES
    } else {
        0
    };

    let usable_total_memory = if total_system_memory > RESERVE_BYTES {
        (total_system_memory - RESERVE_BYTES) + usable_vram
    } else {
        usable_vram
    };
    log::info!("System RAM: {} bytes", &total_system_memory);
    log::info!("Total VRAM: {} bytes", &total_vram);
    log::info!("Usable total memory: {} bytes", &usable_total_memory);
    log::info!("Usable VRAM: {} bytes", &usable_vram);
    log::info!("Required: {} bytes", &total_required);

    // Check if model fits in total memory at all (this is the hard limit)
    if total_required > usable_total_memory {
        return Ok(ModelSupportStatus::Red); // Truly impossible to run
    }

    // Check if everything fits in VRAM (ideal case)
    if total_required <= usable_vram {
        return Ok(ModelSupportStatus::Green);
    }

    // If we get here, it means:
    // - Total requirement fits in combined memory
    // - But doesn't fit entirely in VRAM
    // This is the CPU-GPU hybrid scenario
    Ok(ModelSupportStatus::Yellow)
}
