use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

/// Deserializer that accepts integers, floats (truncated), or null/missing
/// for optional timestamp fields. The frontend historically wrote
/// `Date.now() / 1000` (a float with fractional seconds) to thread.json;
/// strict i64 deserialization rejects those records and breaks thread
/// listing and create/modify for any legacy payload. We accept the float
/// and truncate to whole seconds rather than failing the whole command.
fn deserialize_optional_i64_lenient<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                Ok(Some(i))
            } else if let Some(u) = n.as_u64() {
                Ok(Some(u as i64))
            } else if let Some(f) = n.as_f64() {
                if f.is_finite() {
                    Ok(Some(f.trunc() as i64))
                } else {
                    Ok(None)
                }
            } else {
                Ok(None)
            }
        }
        Some(other) => Err(serde::de::Error::custom(format!(
            "expected number or null for timestamp, got {other}"
        ))),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct ThreadRecord {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub object: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub assistants: Vec<Value>,
    #[serde(default, deserialize_with = "deserialize_optional_i64_lenient")]
    pub created: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_optional_i64_lenient")]
    pub updated: Option<i64>,
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct MessageRecord {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub object: String,
    #[serde(rename = "thread_id")]
    pub thread_id: String,
    #[serde(default)]
    #[serde(rename = "assistant_id")]
    pub assistant_id: Option<String>,
    #[serde(default)]
    pub attachments: Option<Value>,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub content: Vec<Value>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, rename = "created_at", deserialize_with = "deserialize_optional_i64_lenient")]
    pub created_at: Option<i64>,
    #[serde(default, rename = "completed_at", deserialize_with = "deserialize_optional_i64_lenient")]
    pub completed_at: Option<i64>,
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(default)]
    #[serde(rename = "type")]
    pub type_: Option<String>,
    #[serde(default)]
    #[serde(rename = "error_code")]
    pub error_code: Option<String>,
    #[serde(default)]
    #[serde(rename = "tool_call_id")]
    pub tool_call_id: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
