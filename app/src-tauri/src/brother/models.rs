//! Serde models for the Brother wire formats.
//!
//! `/info` is JSON; the sewing endpoint answers with a small XML document
//! (parsed in [`crate::brother::protocol`] into [`SewingResponse`]).

use serde::Deserialize;
use std::collections::HashMap;

/// Response of `GET /info`.
///
/// Everything is optional except what we genuinely require, because firmware
/// versions differ in which fields they include and identification should
/// degrade gracefully rather than fail on a missing key.
#[derive(Debug, Clone, Deserialize)]
pub struct BrotherInfo {
    /// Numeric model code (e.g. 56 for the Innov-is BP-series).
    pub model: Option<i64>,
    #[serde(rename = "type")]
    pub machine_type: Option<i64>,
    pub oem: Option<i64>,
    pub version: Option<String>,
    #[serde(rename = "machine-id")]
    pub machine_id: Option<String>,
    pub serial: Option<String>,
    /// User-assigned machine name, e.g. "BETTY".
    pub name: Option<String>,
    /// Available protocol APIs. The design-transfer protocol is `"pedxml"`;
    /// its presence is how we recognize a Brother embroidery machine.
    #[serde(default)]
    pub apis: HashMap<String, BrotherApi>,
    #[serde(default)]
    pub features: BrotherFeatures,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BrotherApi {
    #[serde(default)]
    pub version: i64,
}

/// `features` object of `/info`. Dimensions are in 0.1 mm units
/// (1600 = 160 mm); `postsize` is the maximum upload size in bytes.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct BrotherFeatures {
    pub embwidth: Option<u64>,
    pub embheight: Option<u64>,
    pub needles: Option<u32>,
    pub postsize: Option<u64>,
}

impl BrotherInfo {
    /// Does this device speak the design-transfer protocol we implement?
    pub fn supports_pedxml(&self) -> bool {
        self.apis.contains_key("pedxml")
    }
}

/// Parsed form of the XML returned by `POST /sewing/sewing.cgi`.
///
/// The same response shape is used for the status/handshake call
/// (`req_appstate=2`); it carries the machine's error code, memory usage and
/// current file list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SewingResponse {
    /// 0 means OK; anything else is a machine-side rejection.
    pub error_code: i64,
    pub session_id: Option<String>,
    /// Upload endpoint advertised by the machine (observed:
    /// `/sewing/dataupl.cgi`; the official client still posts to
    /// `sewing.cgi`, and so do we).
    pub upload_path: Option<String>,
    /// Total design memory, bytes.
    pub upload_size: Option<u64>,
    /// Free design memory, bytes.
    pub upload_freesize: Option<u64>,
    /// Files currently in machine memory (names assigned by the machine).
    pub files: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_info_parses() {
        let json = r#"{
            "model": 56, "type": 2, "oem": 1, "version": "1.73",
            "machine-id": "abc", "serial": "U12345", "name": "BETTY",
            "apis": {"pedxml": {"version": 3}, "other": {}},
            "features": {"embwidth": 1600, "embheight": 2000, "needles": 1, "postsize": 3145728}
        }"#;
        let info: BrotherInfo = serde_json::from_str(json).unwrap();
        assert_eq!(info.model, Some(56));
        assert_eq!(info.machine_type, Some(2));
        assert_eq!(info.machine_id.as_deref(), Some("abc"));
        assert_eq!(info.name.as_deref(), Some("BETTY"));
        assert_eq!(info.apis["pedxml"].version, 3);
        assert_eq!(info.apis["other"].version, 0, "api version defaults to 0");
        assert_eq!(info.features.embwidth, Some(1600));
        assert_eq!(info.features.postsize, Some(3_145_728));
        assert!(info.supports_pedxml());
    }

    #[test]
    fn empty_object_parses_with_defaults() {
        let info: BrotherInfo = serde_json::from_str("{}").unwrap();
        assert!(info.model.is_none() && info.name.is_none() && info.version.is_none());
        assert!(info.apis.is_empty());
        assert!(info.features.postsize.is_none() && info.features.needles.is_none());
        assert!(!info.supports_pedxml());
    }

    #[test]
    fn unknown_extra_fields_are_ignored() {
        let json = r#"{"model": 1, "wifi": {"ssid": "x"}, "future": [1,2,3],
            "apis": {"pedxml": {"version": 1, "extra": true}},
            "features": {"needles": 6, "mystery": "yes"}}"#;
        let info: BrotherInfo = serde_json::from_str(json).unwrap();
        assert!(info.supports_pedxml());
        assert_eq!(info.features.needles, Some(6));
        assert!(info.features.embwidth.is_none());
    }

    #[test]
    fn non_brother_responder_has_no_pedxml() {
        let json = r#"{"name": "My Printer", "apis": {"ipp": {"version": 2}}}"#;
        let info: BrotherInfo = serde_json::from_str(json).unwrap();
        assert!(!info.supports_pedxml());
    }

    #[test]
    fn null_optionals_parse() {
        let json = r#"{"model": null, "name": null, "features": {"postsize": null}}"#;
        let info: BrotherInfo = serde_json::from_str(json).unwrap();
        assert!(info.model.is_none() && info.features.postsize.is_none());
    }

    #[test]
    fn wrong_types_and_non_objects_are_errors_not_panics() {
        assert!(serde_json::from_str::<BrotherInfo>(r#"{"model": "fifty"}"#).is_err());
        assert!(serde_json::from_str::<BrotherInfo>(r#"{"features": {"postsize": -1}}"#).is_err());
        assert!(serde_json::from_str::<BrotherInfo>("[]").is_err());
        assert!(serde_json::from_str::<BrotherInfo>("<html>nope</html>").is_err());
        assert!(serde_json::from_str::<BrotherInfo>("").is_err());
    }
}
