//! In-app updates. Lilo asks GitHub Releases for `latest.json` (endpoint in `tauri.conf.json`) and
//! only installs a bundle whose minisign signature matches [`pubkey`]. It never contacts any other
//! server .
//!
//! The public key lives in `updater.pub` next to `Cargo.toml` (the contents of the file
//! `tauri signer generate` writes), so it is a plain committed file rather than a long string
//! buried in JSON. Until it is replaced the placeholder disables updating ([`configured`]), so a
//! build from source or a fork never talks to an update server with a key it can't verify.
//!
//! Docs: <https://v2.tauri.app/plugin/updater/>

/// Contents of `updater.pub`.
const PUBKEY_FILE: &str = include_str!("../updater.pub");
const PLACEHOLDER: &str = "REPLACE_WITH_UPDATER_PUBLIC_KEY";

/// The minisign public key updates are verified against.
pub fn pubkey() -> &'static str {
    PUBKEY_FILE.trim()
}

/// Whether a real key has been committed (not the placeholder). Pure so it can be tested.
pub fn is_configured(key: &str) -> bool {
    let key = key.trim();
    !key.is_empty() && !key.starts_with(PLACEHOLDER)
}

pub fn configured() -> bool {
    is_configured(pubkey())
}

/// The updater plugin, verifying with the key from `updater.pub`.
/// The endpoint comes from `plugins.updater.endpoints` in `tauri.conf.json`.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R, tauri_plugin_updater::Config> {
    tauri_plugin_updater::Builder::new().pubkey(pubkey()).build()
}

/// Lets the editor skip the check (and say so in Settings) in builds without a real key.
#[tauri::command]
pub fn updater_enabled() -> bool {
    configured()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_and_blank_keys_are_not_configured() {
        assert!(!is_configured(""));
        assert!(!is_configured("  \n"));
        assert!(!is_configured("REPLACE_WITH_UPDATER_PUBLIC_KEY\n"));
        assert!(is_configured("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCQ0Q="));
    }

    #[test]
    fn the_committed_key_file_is_either_the_placeholder_or_a_minisign_key() {
        let key = pubkey();
        if is_configured(key) {
            // `tauri signer generate` writes base64 of "untrusted comment: minisign public key: ..."
            assert!(key.starts_with("dW50cnVzdGVkIGNvbW1lbnQ6"), "updater.pub is not a Tauri public key");
            assert!(!key.contains(char::is_whitespace), "updater.pub must be a single line");
        }
    }
}
