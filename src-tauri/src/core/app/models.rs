use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppConfiguration {
    pub data_folder: String,
    // Add other fields as needed
}

impl AppConfiguration {
    pub fn default() -> Self {
        Self {
            data_folder: std::env::current_dir()
                .map(|dir| dir.join("data").to_string_lossy().to_string())
                .unwrap_or_else(|_| "./data".to_string()),
            // Add other fields with default values as needed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_configuration_default() {
        let config = AppConfiguration::default();
        assert!(!config.data_folder.is_empty());
        assert!(
            std::path::Path::new(&config.data_folder).is_absolute()
                || config.data_folder == "./data"
        );
    }

    #[test]
    fn test_app_configuration_serialization() {
        let config = AppConfiguration {
            data_folder: "/custom/path".to_string(),
        };
        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["data_folder"], "/custom/path");
    }

    #[test]
    fn test_app_configuration_deserialization() {
        let json_str = r#"{"data_folder": "/some/path"}"#;
        let config: AppConfiguration = serde_json::from_str(json_str).unwrap();
        assert_eq!(config.data_folder, "/some/path");
    }

    #[test]
    fn test_app_configuration_roundtrip() {
        let original = AppConfiguration {
            data_folder: "/test/data".to_string(),
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: AppConfiguration = serde_json::from_str(&json).unwrap();
        assert_eq!(original.data_folder, deserialized.data_folder);
    }

    #[test]
    fn test_app_configuration_clone() {
        let config = AppConfiguration::default();
        let cloned = config.clone();
        assert_eq!(config.data_folder, cloned.data_folder);
    }

    #[test]
    fn test_app_configuration_debug() {
        let config = AppConfiguration::default();
        let debug_str = format!("{:?}", config);
        assert!(debug_str.contains("AppConfiguration"));
        assert!(debug_str.contains("./data"));
    }
}
