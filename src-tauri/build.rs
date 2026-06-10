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

fn main() {
    // Release builds must have a real updater signing public key.
    // Generate a key pair with: tauri signer generate -w ~/.tauri/ax-studio.key
    // Set TAURI_SIGNING_PUBLIC_KEY (the public key) in CI before running `tauri build`.
    // The private key (TAURI_SIGNING_PRIVATE_KEY) is only needed when signing update bundles.
    if std::env::var("PROFILE").unwrap_or_default() == "release" {
        let pubkey = std::env::var("TAURI_SIGNING_PUBLIC_KEY").unwrap_or_default();
        if pubkey.trim().is_empty() {
            panic!(
                "\n\n[SECURITY] TAURI_SIGNING_PUBLIC_KEY is not set.\n\
                 Release builds require a valid Ed25519 public key so the app can\n\
                 verify update bundle signatures before installing them.\n\
                 Set TAURI_SIGNING_PUBLIC_KEY in your CI environment and retry.\n"
            );
        }
    }

    generate_extension_hashes();
    tauri_build::build()
}
