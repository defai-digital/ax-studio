use serde::Serialize;
use thiserror::Error;

/// Structured error type for all Tauri command handlers.
///
/// Replaces the pervasive `Result<T, String>` pattern with typed errors that:
/// - Carry context through the error chain
/// - Serialize to JSON for the frontend to distinguish error kinds
/// - Implement `From` for common error types to enable `?` operator
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("File system error: {0}")]
    FileSystem(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("MCP error: {0}")]
    Mcp(String),

    #[error("Server error: {0}")]
    Server(String),

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Download error: {0}")]
    Download(String),

    #[error("Sandbox error: {0}")]
    Sandbox(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::FileSystem(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Serialization(e.to_string())
    }
}

impl From<serde_yaml::Error> for AppError {
    fn from(e: serde_yaml::Error) -> Self {
        AppError::Serialization(e.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Network(e.to_string())
    }
}

/// Convert AppError to a String for backward compatibility with commands
/// that still use `Result<T, String>`.
impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_error_display() {
        let err = AppError::NotFound("file.txt".to_string());
        assert_eq!(err.to_string(), "Not found: file.txt");
    }

    #[test]
    fn test_app_error_serialization() {
        let err = AppError::FileSystem("permission denied".to_string());
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "FileSystem");
        assert_eq!(json["message"], "permission denied");
    }

    #[test]
    fn test_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "not found");
        let app_err: AppError = io_err.into();
        assert!(matches!(app_err, AppError::FileSystem(_)));
    }

    #[test]
    fn test_from_serde_json_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("invalid").unwrap_err();
        let app_err: AppError = json_err.into();
        assert!(matches!(app_err, AppError::Serialization(_)));
    }

    #[test]
    fn test_app_error_to_string() {
        let err = AppError::InvalidInput("bad param".to_string());
        let s: String = err.into();
        assert_eq!(s, "Invalid input: bad param");
    }

    #[test]
    fn test_all_variants_serialize() {
        let variants: Vec<AppError> = vec![
            AppError::NotFound("a".into()),
            AppError::InvalidInput("b".into()),
            AppError::FileSystem("c".into()),
            AppError::Network("d".into()),
            AppError::Serialization("e".into()),
            AppError::Mcp("f".into()),
            AppError::Server("g".into()),
            AppError::Configuration("h".into()),
            AppError::Download("i".into()),
            AppError::Sandbox("j".into()),
            AppError::Internal("k".into()),
        ];
        for err in variants {
            let json = serde_json::to_value(&err).unwrap();
            assert!(json.get("kind").is_some());
            assert!(json.get("message").is_some());
        }
    }
}
