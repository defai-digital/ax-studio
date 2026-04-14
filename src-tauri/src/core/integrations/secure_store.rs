use std::collections::HashMap;

const SERVICE_NAME: &str = "ax-studio.integrations";

#[cfg(not(test))]
pub fn save_credentials(
    integration: &str,
    credentials: &HashMap<String, String>,
) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, integration)
        .map_err(|e| format!("Failed to initialize secure store entry: {e}"))?;
    let payload = serde_json::to_string(credentials)
        .map_err(|e| format!("Failed to serialize credentials: {e}"))?;
    entry
        .set_password(&payload)
        .map_err(|e| format!("Failed to save credentials in secure store: {e}"))
}

#[cfg(not(test))]
pub fn read_credentials(integration: &str) -> Result<Option<HashMap<String, String>>, String> {
    let entry = keyring::Entry::new(SERVICE_NAME, integration)
        .map_err(|e| format!("Failed to initialize secure store entry: {e}"))?;

    match entry.get_password() {
        Ok(payload) => serde_json::from_str(&payload)
            .map(Some)
            .map_err(|e| format!("Failed to parse secure credentials: {e}")),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read credentials from secure store: {e}")),
    }
}

#[cfg(not(test))]
pub fn delete_credentials(integration: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, integration)
        .map_err(|e| format!("Failed to initialize secure store entry: {e}"))?;

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!(
            "Failed to delete credentials from secure store: {e}"
        )),
    }
}

#[cfg(test)]
fn test_store() -> &'static std::sync::Mutex<HashMap<String, String>> {
    static STORE: std::sync::OnceLock<std::sync::Mutex<HashMap<String, String>>> =
        std::sync::OnceLock::new();
    STORE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

#[cfg(test)]
pub fn save_credentials(
    integration: &str,
    credentials: &HashMap<String, String>,
) -> Result<(), String> {
    let payload = serde_json::to_string(credentials)
        .map_err(|e| format!("Failed to serialize credentials: {e}"))?;
    let mut store = test_store()
        .lock()
        .map_err(|_| "Secure store test mutex poisoned".to_string())?;
    store.insert(integration.to_string(), payload);
    Ok(())
}

#[cfg(test)]
pub fn read_credentials(integration: &str) -> Result<Option<HashMap<String, String>>, String> {
    let store = test_store()
        .lock()
        .map_err(|_| "Secure store test mutex poisoned".to_string())?;
    let Some(payload) = store.get(integration) else {
        return Ok(None);
    };

    serde_json::from_str(payload)
        .map(Some)
        .map_err(|e| format!("Failed to parse secure credentials: {e}"))
}

#[cfg(test)]
pub fn delete_credentials(integration: &str) -> Result<(), String> {
    let mut store = test_store()
        .lock()
        .map_err(|_| "Secure store test mutex poisoned".to_string())?;
    store.remove(integration);
    Ok(())
}

#[cfg(test)]
pub fn clear_test_credentials() {
    if let Ok(mut store) = test_store().lock() {
        store.clear();
    }
}
