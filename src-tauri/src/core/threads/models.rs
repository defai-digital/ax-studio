use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Deserialize an `Option<i64>` that may have been written as either an integer
/// or a floating-point number on disk.
///
/// Older versions of the frontend persisted Unix timestamps as
/// `Date.now() / 1000`, producing values like `1774958339.354`. Once Rust's
/// thread/message structs were tightened to `Option<i64>`, those existing
/// files started failing to deserialize with
/// `invalid type: floating point ..., expected i64`, breaking thread loading
/// for anyone whose data predated the `Math.floor` fix on the JS side.
///
/// This visitor accepts integers, unsigned integers, and floats (truncating
/// fractional parts) so legacy files keep working. The next write will
/// re-serialize the field as a clean integer, healing the file in place.
fn deserialize_optional_i64_lossy<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};
    use std::fmt;

    struct I64OrFloatVisitor;
    impl<'de> Visitor<'de> for I64OrFloatVisitor {
        type Value = i64;

        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("an integer or float convertible to i64")
        }

        fn visit_i64<E: de::Error>(self, v: i64) -> Result<i64, E> {
            Ok(v)
        }

        fn visit_u64<E: de::Error>(self, v: u64) -> Result<i64, E> {
            // Saturate rather than overflow on the i64 max boundary; Unix
            // millisecond timestamps stay well below this for the foreseeable
            // future, so this only matters for malformed data.
            Ok(i64::try_from(v).unwrap_or(i64::MAX))
        }

        fn visit_f64<E: de::Error>(self, v: f64) -> Result<i64, E> {
            // f64 has ~15-17 digits of precision, more than enough for
            // millisecond Unix timestamps (~13 digits) and second-precision
            // fractional timestamps (~10.3 digits). `as i64` truncates toward
            // zero, which matches the `Math.floor` behavior the JS side now
            // uses for new writes.
            if v.is_nan() {
                return Err(de::Error::custom("timestamp cannot be NaN"));
            }
            Ok(v as i64)
        }
    }

    struct OptVisitor;
    impl<'de> Visitor<'de> for OptVisitor {
        type Value = Option<i64>;

        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("an optional integer or float convertible to i64")
        }

        fn visit_none<E: de::Error>(self) -> Result<Option<i64>, E> {
            Ok(None)
        }

        fn visit_unit<E: de::Error>(self) -> Result<Option<i64>, E> {
            Ok(None)
        }

        fn visit_some<D2>(self, deserializer: D2) -> Result<Option<i64>, D2::Error>
        where
            D2: serde::Deserializer<'de>,
        {
            deserializer.deserialize_any(I64OrFloatVisitor).map(Some)
        }
    }

    deserializer.deserialize_option(OptVisitor)
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
    #[serde(default, deserialize_with = "deserialize_optional_i64_lossy")]
    pub created: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_optional_i64_lossy")]
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
    #[serde(
        default,
        rename = "created_at",
        deserialize_with = "deserialize_optional_i64_lossy"
    )]
    pub created_at: Option<i64>,
    #[serde(
        default,
        rename = "completed_at",
        deserialize_with = "deserialize_optional_i64_lossy"
    )]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_record_accepts_integer_timestamps() {
        let json = r#"{
            "id": "t1",
            "object": "thread",
            "created": 1774958339,
            "updated": 1774958400
        }"#;
        let thread: ThreadRecord = serde_json::from_str(json).expect("integer timestamps must parse");
        assert_eq!(thread.created, Some(1774958339));
        assert_eq!(thread.updated, Some(1774958400));
    }

    #[test]
    fn thread_record_accepts_float_timestamps_from_legacy_files() {
        // This is the exact failure mode reported in production: thread.json
        // files written by an older JS version had `Date.now() / 1000` floats.
        let json = r#"{
            "id": "b135c89c-7bc8-409a-93bc-a3a068f0d99c",
            "object": "thread",
            "created": 1774958339.354,
            "updated": 1774958339.354
        }"#;
        let thread: ThreadRecord = serde_json::from_str(json)
            .expect("legacy float timestamps must deserialize, not crash");
        // f64 -> i64 truncates toward zero, matching Math.floor on the JS side.
        assert_eq!(thread.created, Some(1774958339));
        assert_eq!(thread.updated, Some(1774958339));
    }

    #[test]
    fn thread_record_treats_missing_timestamps_as_none() {
        let thread: ThreadRecord = serde_json::from_str(r#"{"id": "t1"}"#).unwrap();
        assert_eq!(thread.created, None);
        assert_eq!(thread.updated, None);
    }

    #[test]
    fn thread_record_treats_explicit_null_timestamps_as_none() {
        let json = r#"{"id": "t1", "created": null, "updated": null}"#;
        let thread: ThreadRecord = serde_json::from_str(json).unwrap();
        assert_eq!(thread.created, None);
        assert_eq!(thread.updated, None);
    }

    #[test]
    fn thread_record_serializes_back_as_integer() {
        // After heal-on-read, the next write must produce a clean integer so
        // future reads don't keep relying on the lossy deserializer.
        let json = r#"{"id": "t1", "created": 1774958339.354}"#;
        let thread: ThreadRecord = serde_json::from_str(json).unwrap();
        let reserialized = serde_json::to_value(&thread).unwrap();
        assert_eq!(reserialized["created"], serde_json::json!(1774958339));
    }

    #[test]
    fn message_record_accepts_float_timestamps() {
        // Message files (messages.jsonl) had the same legacy float-timestamp
        // issue; verify both `created_at` and `completed_at` recover.
        let json = r#"{
            "thread_id": "t1",
            "role": "user",
            "content": [],
            "created_at": 1774958339.354,
            "completed_at": 1774958340.789
        }"#;
        let message: MessageRecord = serde_json::from_str(json)
            .expect("legacy float timestamps must deserialize");
        assert_eq!(message.created_at, Some(1774958339));
        assert_eq!(message.completed_at, Some(1774958340));
    }

    #[test]
    fn message_record_accepts_millisecond_integer_timestamps() {
        // Newer messages use Date.now() in milliseconds (large integers).
        let json = r#"{
            "thread_id": "t1",
            "role": "user",
            "content": [],
            "created_at": 1774958339354,
            "completed_at": 1774958340789
        }"#;
        let message: MessageRecord = serde_json::from_str(json).unwrap();
        assert_eq!(message.created_at, Some(1774958339354));
        assert_eq!(message.completed_at, Some(1774958340789));
    }
}
