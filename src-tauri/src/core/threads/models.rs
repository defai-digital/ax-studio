use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

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
    #[serde(default)]
    pub created: Option<i64>,
    #[serde(default)]
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
    #[serde(default)]
    #[serde(rename = "created_at")]
    pub created_at: Option<i64>,
    #[serde(default)]
    #[serde(rename = "completed_at")]
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
