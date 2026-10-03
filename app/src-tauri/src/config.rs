//! Persistent application configuration.
//!
//! Stored as pretty-printed JSON in the Tauri app-config directory
//! (`~/Library/Application Support/com.kadwood.lilo/config.json` on macOS).
//! The file contains the localhost API token, so it is created with owner-only
//! permissions on Unix.

use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::path::PathBuf;
use tokio::sync::RwLock;

/// A machine the user has saved (manually or from discovery).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedMachine {
    pub ip: IpAddr,
    /// User-facing nickname, e.g. "Sewing room".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    /// Backend that recognized the machine when it was saved, if known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub serial: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub previous_ips: Vec<IpAddr>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Bearer token required on every localhost API request. Generated on
    /// first launch; the user pastes it into a local tool once.
    pub api_token: String,
    /// Additional web origins allowed to call the API from a browser (CORS
    /// allowlist). The built-in Tauri and Vite-dev origins and the
    /// app's own webview are always allowed without listing them here;
    /// `"*"` allows every origin (the token remains required).
    #[serde(default)]
    pub allowed_origins: Vec<String>,
    #[serde(default)]
    pub machines: Vec<SavedMachine>,
}

impl AppConfig {
    fn new_with_token() -> Self {
        Self {
            api_token: generate_token(),
            allowed_origins: Vec::new(),
            machines: Vec::new(),
        }
    }
}

/// 128 bits of randomness, hex-encoded.
fn generate_token() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    (0..32)
        .map(|_| format!("{:x}", rng.random_range(0..16u8)))
        .collect()
}

/// Owns the on-disk config and serializes access to it.
pub struct ConfigStore {
    path: PathBuf,
    config: RwLock<AppConfig>,
}

impl ConfigStore {
    /// Load the config, creating it (with a fresh token) on first launch.
    pub fn load_or_create(dir: PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("config.json");
        let config = match std::fs::read_to_string(&path) {
            Ok(raw) => {
                // A corrupt config could silently regenerate the token and
                // break pairing; fail loudly instead.
                let mut config = serde_json::from_str::<AppConfig>(&raw).map_err(|e| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("{} is not a valid config file: {e}", path.display()),
                    )
                })?;
                if drop_unsupported_machines(&mut config) {
                    // Persist the cleanup so the warning is logged once, not on every launch.
                    write_config(&path, &config)?;
                }
                remove_stale_token_files(&dir);
                config
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let config = AppConfig::new_with_token();
                write_config(&path, &config)?;
                config
            }
            Err(e) => return Err(e),
        };
        Ok(Self {
            path,
            config: RwLock::new(config),
        })
    }

    pub async fn get(&self) -> AppConfig {
        self.config.read().await.clone()
    }

    /// The directory holding `config.json`; sibling stores (e.g. the
    /// transfer history) live alongside it.
    pub fn dir(&self) -> &std::path::Path {
        self.path.parent().expect("config path always has a parent")
    }

    /// Mutate the config and persist it atomically.
    pub async fn update<F: FnOnce(&mut AppConfig)>(&self, mutate: F) -> std::io::Result<AppConfig> {
        let mut guard = self.config.write().await;
        let mut next = guard.clone();
        mutate(&mut next);
        write_config(&self.path, &next)?;
        *guard = next;
        Ok(guard.clone())
    }
}

/// Manufacturers this build can talk to. Saved machines from a backend that no longer exists
/// (an earlier build shipped a USB-dongle backend) are dropped on load.
const SUPPORTED_MANUFACTURERS: &[&str] = &["brother"];

/// Remove saved machines whose backend is gone. Machines saved without a manufacturer are kept.
/// Returns whether anything was removed.
fn drop_unsupported_machines(config: &mut AppConfig) -> bool {
    let before = config.machines.len();
    config.machines.retain(|m| {
        m.manufacturer
            .as_deref()
            .is_none_or(|id| SUPPORTED_MANUFACTURERS.contains(&id))
    });
    let dropped = before - config.machines.len();
    if dropped > 0 {
        tracing::warn!("dropped {dropped} saved machine(s) from a backend this version no longer supports");
    }
    dropped > 0
}

/// Delete the pairing-token file the removed dongle backend left next to `config.json`.
fn remove_stale_token_files(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_string_lossy().ends_with("-tokens.json") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Write via a temp file + rename so a crash can't truncate the config,
/// with owner-only permissions because it contains the API token.
fn write_config(path: &std::path::Path, config: &AppConfig) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(config).expect("config serialization cannot fail");
    let tmp = path.with_extension("json.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    let mut file = options.open(&tmp)?;
    file.write_all(json.as_bytes())?;
    file.sync_all()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod legacy_tests {
    use super::*;
    #[test]
    fn legacy_config_with_unknown_fields_still_parses() {
        // Older configs carried `linkReleaseChannels`; it is ignored.
        let old: AppConfig = serde_json::from_str(
            r#"{"apiToken":"t","machines":[],"linkReleaseChannels":{"LINK-A":"dev"}}"#,
        )
        .unwrap();
        assert_eq!(old.api_token, "t");
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lilo-config-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn saved_machines_from_a_removed_backend_are_dropped_once_others_kept() {
        let dir = temp_dir("migrate");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("config.json"),
            r#"{"apiToken":"t","machines":[
                {"ip":"192.168.1.4","manufacturer":"brother","serial":"B1"},
                {"ip":"192.168.1.5","manufacturer":"retired-backend","serial":"X1"},
                {"ip":"192.168.1.6"}]}"#,
        )
        .unwrap();
        std::fs::write(dir.join("old-tokens.json"), "{}").unwrap();
        let store = ConfigStore::load_or_create(dir.clone()).unwrap();
        let ips: Vec<String> = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(store.get())
            .machines
            .iter()
            .map(|m| m.ip.to_string())
            .collect();
        assert_eq!(ips, ["192.168.1.4", "192.168.1.6"]);
        assert!(!dir.join("old-tokens.json").exists());
        // The cleanup was written back, so a second load finds nothing to drop.
        let raw = std::fs::read_to_string(dir.join("config.json")).unwrap();
        assert!(!raw.contains("retired-backend"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
