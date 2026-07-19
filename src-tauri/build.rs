use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read},
    path::PathBuf,
};

fn sha256_of_file(path: &PathBuf) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn generate_extension_hashes() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let pre_install = manifest_dir.parent().unwrap().join("pre-install");

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let out_file = out_dir.join("extension_hashes.rs");

    // Tell cargo to rerun this script if any tgz changes.
    println!("cargo:rerun-if-changed={}", pre_install.display());

    let mut entries: Vec<(String, String)> = Vec::new();

    if let Ok(rd) = fs::read_dir(&pre_install) {
        let mut paths: Vec<_> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map(|e| e == "tgz").unwrap_or(false))
            .collect();
        paths.sort();

        for path in &paths {
            println!("cargo:rerun-if-changed={}", path.display());
            let filename = path.file_name().unwrap().to_string_lossy().into_owned();
            let hash = sha256_of_file(path)
                .unwrap_or_else(|_| panic!("Failed to hash {}", path.display()));
            entries.push((filename, hash));
        }
    }

    let pairs: Vec<String> = entries
        .iter()
        .map(|(name, hash)| format!("    ({name:?}, {hash:?}),"))
        .collect();

    let code = format!(
        "const BUNDLED_EXTENSION_ARCHIVE_SHA256: &[(&str, &str)] = &[\n{}\n];",
        pairs.join("\n")
    );

    fs::write(&out_file, code).expect("Failed to write extension_hashes.rs");
}

fn build_mlx_runtime_shim() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    println!("cargo:rerun-if-changed=native/mlx_runtime.cpp");
    cc::Build::new()
        .cpp(true)
        .file("native/mlx_runtime.cpp")
        .flag_if_supported("-std=c++17")
        .compile("ax_studio_mlx_runtime");
}

/// Embed an absolute LC_RPATH for libmlx so cargo-test / debug binaries can
/// load the same dylib mlx-sys linked against. mlx-sys's own
/// `rustc-link-arg=-rpath` does not propagate to downstream executables.
fn embed_mlx_rpath_for_test_and_dev_binaries() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    println!("cargo:rerun-if-env-changed=DEP_MLX_LIB_DIR");
    println!("cargo:rerun-if-env-changed=MLX_LIB_DIR");
    println!("cargo:rerun-if-env-changed=VIRTUAL_ENV");

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = std::env::var("DEP_MLX_LIB_DIR") {
        candidates.push(PathBuf::from(dir));
    }
    if let Ok(dir) = std::env::var("MLX_LIB_DIR") {
        candidates.push(PathBuf::from(dir));
    }
    if let Ok(venv) = std::env::var("VIRTUAL_ENV") {
        // prepare-mlx / CI venv: site-packages/mlx/lib
        let site = PathBuf::from(&venv).join("lib");
        if let Ok(entries) = fs::read_dir(&site) {
            for entry in entries.flatten() {
                let mlx_lib = entry.path().join("site-packages/mlx/lib");
                if mlx_lib.join("libmlx.dylib").is_file() {
                    candidates.push(mlx_lib);
                }
            }
        }
    }
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        candidates.push(PathBuf::from(manifest_dir).join("resources/lib"));
    }

    for dir in candidates {
        let lib = dir.join("libmlx.dylib");
        if lib.is_file() {
            println!("cargo:rerun-if-changed={}", lib.display());
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", dir.display());
            return;
        }
    }
}

fn main() {
    // When createUpdaterArtifacts is enabled in tauri.conf.json, a signing public key is required
    // so the app can verify update bundle signatures. The CI only enables this when the key is
    // available (see ax-studio-tauri-build.yaml), so this check is a safety guard for that path.
    if std::env::var("PROFILE").unwrap_or_default() == "release" {
        let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
        let conf_path = manifest_dir.join("tauri.conf.json");
        println!("cargo:rerun-if-changed={}", conf_path.display());
        let conf_content = fs::read_to_string(&conf_path).unwrap_or_default();
        let updater_enabled = conf_content.contains("\"createUpdaterArtifacts\": true");
        if updater_enabled {
            let pubkey = std::env::var("TAURI_SIGNING_PUBLIC_KEY").unwrap_or_default();
            if pubkey.trim().is_empty() {
                panic!(
                    "\n\n[SECURITY] TAURI_SIGNING_PUBLIC_KEY is not set.\n\
                     Release builds with createUpdaterArtifacts=true require a valid Ed25519 public key.\n\
                     Set TAURI_SIGNING_PUBLIC_KEY in your CI environment and retry.\n"
                );
            }
        }
    }

    generate_extension_hashes();
    build_mlx_runtime_shim();
    embed_mlx_rpath_for_test_and_dev_binaries();
    tauri_build::build()
}
