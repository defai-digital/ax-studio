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

    tauri_build::build()
}
