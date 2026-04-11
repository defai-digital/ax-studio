use crate::{
    types::{CpuStaticInfo, SystemInfo, SystemUsage},
    vendor::{nvidia, vulkan},
    SYSTEM_INFO,
};
use sysinfo::System;

fn fallback_system_info() -> SystemInfo {
    SystemInfo {
        cpu: CpuStaticInfo {
            name: "Unknown".to_string(),
            core_count: 0,
            arch: std::env::consts::ARCH.to_string(),
            extensions: vec![],
        },
        os_type: if cfg!(target_os = "windows") {
            "windows".to_string()
        } else if cfg!(target_os = "macos") {
            "macos".to_string()
        } else if cfg!(target_os = "linux") {
            "linux".to_string()
        } else {
            "unknown".to_string()
        },
        os_name: "Unknown".to_string(),
        total_memory: 0,
        gpus: vec![],
    }
}

fn build_system_info() -> SystemInfo {
    let mut system = System::new();
    system.refresh_memory();

    let mut gpu_map = std::collections::HashMap::new();
    for gpu in nvidia::get_nvidia_gpus() {
        gpu_map.insert(gpu.uuid.clone(), gpu);
    }

    let vulkan_gpus = vulkan::get_vulkan_gpus();

    for gpu in vulkan_gpus {
        match gpu_map.get_mut(&gpu.uuid) {
            // for existing NVIDIA GPUs, add Vulkan info
            Some(nvidia_gpu) => {
                nvidia_gpu.vulkan_info = gpu.vulkan_info;
            }
            None => {
                gpu_map.insert(gpu.uuid.clone(), gpu);
            }
        }
    }

    let os_type = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    };
    let os_name = System::long_os_version().unwrap_or("Unknown".to_string());

    SystemInfo {
        cpu: CpuStaticInfo::new(),
        os_type: os_type.to_string(),
        os_name,
        total_memory: system.total_memory() / 1024 / 1024, // bytes to MiB
        gpus: gpu_map.into_values().collect(),
    }
}

#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    std::panic::catch_unwind(|| SYSTEM_INFO.get_or_init(build_system_info).clone()).unwrap_or_else(
        |error| {
            log::error!("Failed to collect system info: {:?}", error);
            fallback_system_info()
        },
    )
}

#[tauri::command]
pub async fn get_system_usage() -> SystemUsage {
    let mut system = System::new();
    system.refresh_memory();

    // need to refresh 2 times to get CPU usage
    system.refresh_cpu_all();
    tokio::time::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL).await;
    system.refresh_cpu_all();

    let cpus = system.cpus();
    let cpu_usage =
        cpus.iter().map(|cpu| cpu.cpu_usage()).sum::<f32>() / (cpus.len().max(1) as f32);
    let gpu_infos = get_system_info().gpus;
    let gpu_usage = tokio::task::spawn_blocking(move || {
        gpu_infos
            .into_iter()
            .map(|gpu| gpu.get_usage())
            .collect::<Vec<_>>()
    })
    .await
    .unwrap_or_else(|error| {
        log::error!("Failed to collect GPU usage: {}", error);
        vec![]
    });

    SystemUsage {
        cpu: cpu_usage,
        used_memory: system.used_memory() / 1024 / 1024, // bytes to MiB,
        total_memory: system.total_memory() / 1024 / 1024, // bytes to MiB,
        gpus: gpu_usage,
    }
}
