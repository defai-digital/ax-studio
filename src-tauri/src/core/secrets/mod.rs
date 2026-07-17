use std::sync::{Mutex, OnceLock};

const CREDENTIAL_SERVICE: &str = "ai.axstudio.app";
const PROXY_PASSWORD_KEY: &str = "proxy-password";
const MAX_SECRET_BYTES: usize = 16 * 1024;

static CREDENTIAL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn validate_key(key: &str) -> Result<&'static str, String> {
    match key {
        PROXY_PASSWORD_KEY => Ok(PROXY_PASSWORD_KEY),
        _ => Err("Unsupported secure credential key".to_string()),
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn with_entry<T>(
    key: &'static str,
    operation: impl FnOnce(keyring::Entry) -> keyring::Result<T>,
) -> keyring::Result<T> {
    let _guard = CREDENTIAL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, key)?;
    operation(entry)
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn store_error(operation: &str, error: keyring::Error) -> String {
    log::error!("Operating-system credential store {operation} failed: {error}");
    format!("Secure credential storage {operation} failed")
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn unsupported_platform<T>() -> Result<T, String> {
    Err("Secure credential storage is unsupported on this platform".to_string())
}

#[tauri::command]
pub async fn get_secret(key: String) -> Result<Option<String>, String> {
    let key = validate_key(&key)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            match with_entry(key, |entry| entry.get_password()) {
                Ok(secret) => Ok(Some(secret)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(store_error("read", error)),
            }
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        unsupported_platform()
    })
    .await
    .map_err(|error| format!("Secure credential task failed: {error}"))?
}

#[tauri::command]
pub async fn set_secret(key: String, value: String) -> Result<(), String> {
    let key = validate_key(&key)?;
    if value.len() > MAX_SECRET_BYTES || value.contains('\0') {
        return Err(format!(
            "Secure credential exceeds the {MAX_SECRET_BYTES}-byte limit or contains NUL"
        ));
    }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            with_entry(key, |entry| entry.set_password(&value))
                .map_err(|error| store_error("write", error))
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        unsupported_platform()
    })
    .await
    .map_err(|error| format!("Secure credential task failed: {error}"))?
}

#[tauri::command]
pub async fn delete_secret(key: String) -> Result<(), String> {
    let key = validate_key(&key)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            match with_entry(key, |entry| entry.delete_credential()) {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(store_error("delete", error)),
            }
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        unsupported_platform()
    })
    .await
    .map_err(|error| format!("Secure credential task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{validate_key, MAX_SECRET_BYTES, PROXY_PASSWORD_KEY};

    #[test]
    fn only_known_secret_keys_are_accepted() {
        assert_eq!(validate_key(PROXY_PASSWORD_KEY), Ok(PROXY_PASSWORD_KEY));
        assert!(validate_key("arbitrary-secret").is_err());
        assert!(validate_key("").is_err());
    }

    #[tokio::test]
    async fn secret_payload_is_bounded_before_keyring_access() {
        assert!(super::set_secret(
            PROXY_PASSWORD_KEY.to_string(),
            "x".repeat(MAX_SECRET_BYTES + 1),
        )
        .await
        .is_err());
        assert!(
            super::set_secret(PROXY_PASSWORD_KEY.to_string(), "bad\0secret".to_string())
                .await
                .is_err()
        );
    }
}
