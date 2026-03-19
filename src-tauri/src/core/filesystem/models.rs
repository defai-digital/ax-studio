#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub is_directory: bool,
    pub size: u64,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogOpenOptions {
    pub multiple: Option<bool>,
    pub directory: Option<bool>,
    pub default_path: Option<String>,
    pub filters: Option<Vec<DialogFilter>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_stat_serialization_camel_case() {
        let stat = FileStat {
            is_directory: true,
            size: 1024,
        };
        let json = serde_json::to_value(&stat).unwrap();
        assert_eq!(json["isDirectory"], true);
        assert_eq!(json["size"], 1024);
        // Should NOT have snake_case keys
        assert!(json.get("is_directory").is_none());
    }

    #[test]
    fn test_file_stat_file() {
        let stat = FileStat {
            is_directory: false,
            size: 0,
        };
        let json = serde_json::to_value(&stat).unwrap();
        assert_eq!(json["isDirectory"], false);
        assert_eq!(json["size"], 0);
    }

    #[test]
    fn test_dialog_filter_roundtrip() {
        let filter = DialogFilter {
            name: "Images".to_string(),
            extensions: vec!["png".to_string(), "jpg".to_string()],
        };
        let json = serde_json::to_string(&filter).unwrap();
        let deserialized: DialogFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "Images");
        assert_eq!(deserialized.extensions.len(), 2);
        assert_eq!(deserialized.extensions[0], "png");
    }

    #[test]
    fn test_dialog_open_options_all_fields() {
        let opts = DialogOpenOptions {
            multiple: Some(true),
            directory: Some(false),
            default_path: Some("/home/user".to_string()),
            filters: Some(vec![DialogFilter {
                name: "Text".to_string(),
                extensions: vec!["txt".to_string()],
            }]),
        };
        let json = serde_json::to_value(&opts).unwrap();
        assert_eq!(json["multiple"], true);
        assert_eq!(json["directory"], false);
        assert_eq!(json["defaultPath"], "/home/user");
        assert!(json["filters"].is_array());
    }

    #[test]
    fn test_dialog_open_options_optional_fields_null() {
        let opts = DialogOpenOptions {
            multiple: None,
            directory: None,
            default_path: None,
            filters: None,
        };
        let json = serde_json::to_value(&opts).unwrap();
        assert!(json["multiple"].is_null());
        assert!(json["directory"].is_null());
        assert!(json["defaultPath"].is_null());
        assert!(json["filters"].is_null());
    }

    #[test]
    fn test_dialog_open_options_deserialization() {
        let json_str = r#"{"multiple": true, "directory": false}"#;
        let opts: DialogOpenOptions = serde_json::from_str(json_str).unwrap();
        assert_eq!(opts.multiple, Some(true));
        assert_eq!(opts.directory, Some(false));
        assert!(opts.default_path.is_none());
        assert!(opts.filters.is_none());
    }
}
