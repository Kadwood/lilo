//! "My custom hoops" on disk: one JSON file, `~/Documents/Lilo/hoops.json`.
//!
//! Same idea as [`crate::my_threads`]: the editor builds and validates the list (engine
//! `importCustomHoops`), Rust only stores the text. The file name is fixed, so the commands can't be
//! used to read or write anything else; the text must parse as JSON and stay small; writes go through
//! a temp file, a `.bak` of the previous good save and a rename ([`crate::fsutil::durable_write`]).

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Fixed name inside the projects folder.
pub const FILE_NAME: &str = "hoops.json";
/// A few hundred hoops is a few tens of kilobytes; refuse anything silly.
pub const MAX_BYTES: usize = 1024 * 1024;

pub fn hoops_path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// What is on disk. `text` is the list when the file is there and is valid JSON. `corrupt` is true when
/// the file is there but is not (or is missing while a backup exists); then `backup` holds the previous
/// save's text if that one is valid, so the editor can offer to restore it. A fresh install is all
/// `None` / false.
#[derive(Debug, Default, PartialEq, Serialize)]
pub struct HoopsRead {
    pub text: Option<String>,
    pub backup: Option<String>,
    pub corrupt: bool,
}

fn valid_json(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).is_ok()
}

fn read_small(path: &Path) -> Result<Option<String>, String> {
    match std::fs::metadata(path) {
        Ok(meta) => {
            if meta.len() as usize > MAX_BYTES {
                return Err("The custom hoops file is too large to open.".into());
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Could not read your hoops: {e}")),
    }
    std::fs::read_to_string(path).map(Some).map_err(|e| format!("Could not read your hoops: {e}"))
}

/// Read the list and, if it is damaged, the backup beside it.
pub fn read_hoops(dir: &Path) -> Result<HoopsRead, String> {
    let main = read_small(&hoops_path(dir))?;
    match main {
        Some(t) if valid_json(&t) => Ok(HoopsRead { text: Some(t), backup: None, corrupt: false }),
        other => {
            let backup = read_small(&crate::fsutil::bak_path(&hoops_path(dir))).ok().flatten().filter(|b| valid_json(b));
            Ok(HoopsRead { text: None, corrupt: other.is_some() || backup.is_some(), backup })
        }
    }
}

/// Save the list atomically. Rejects text that is too big or not JSON.
pub fn write_hoops(dir: &Path, text: &str) -> Result<(), String> {
    if text.len() > MAX_BYTES {
        return Err("Your hoops list is too large to save.".into());
    }
    serde_json::from_str::<serde_json::Value>(text).map_err(|_| "Your hoops list must be valid JSON.".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    crate::fsutil::durable_write(&hoops_path(dir), text.as_bytes(), |b| std::str::from_utf8(b).is_ok_and(valid_json))
        .map_err(|e| format!("Could not save your hoops: {e}"))
}

#[tauri::command]
pub fn read_hoops_file(app: tauri::AppHandle) -> Result<HoopsRead, String> {
    read_hoops(&crate::projects::projects_dir(&app)?)
}

#[tauri::command]
pub fn write_hoops_file(app: tauri::AppHandle, json: String) -> Result<(), String> {
    write_hoops(&crate::projects::projects_dir(&app)?, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(tag: &str) -> PathBuf {
        let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("lilo-hoops-{tag}-{}-{n}", std::process::id()))
    }

    #[test]
    fn no_file_means_no_hoops_yet() {
        assert_eq!(read_hoops(&scratch("none")).unwrap(), HoopsRead::default());
    }

    #[test]
    fn saves_and_reads_back_creating_the_folder_and_keeping_the_previous_save() {
        let dir = scratch("roundtrip");
        write_hoops(&dir, "{\"version\":1,\"hoops\":[]}").unwrap();
        assert_eq!(read_hoops(&dir).unwrap().text.as_deref(), Some("{\"version\":1,\"hoops\":[]}"));
        write_hoops(&dir, "{\"version\":1,\"hoops\":[1]}").unwrap();
        assert_eq!(read_hoops(&dir).unwrap().text.as_deref(), Some("{\"version\":1,\"hoops\":[1]}"));
        assert!(!dir.join("hoops.json.tmp").exists());
        assert_eq!(std::fs::read_to_string(dir.join("hoops.json.bak")).unwrap(), "{\"version\":1,\"hoops\":[]}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_text_that_is_not_json_or_too_big_and_keeps_the_old_file() {
        let dir = scratch("refuse");
        write_hoops(&dir, "{\"ok\":true}").unwrap();
        assert!(write_hoops(&dir, "not json").is_err());
        let huge = format!("\"{}\"", "x".repeat(MAX_BYTES));
        assert!(write_hoops(&dir, &huge).is_err());
        assert_eq!(read_hoops(&dir).unwrap().text.as_deref(), Some("{\"ok\":true}"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_damaged_file_is_reported_with_the_good_backup_and_never_silently_emptied() {
        let dir = scratch("corrupt");
        write_hoops(&dir, "{\"v\":1}").unwrap();
        write_hoops(&dir, "{\"v\":2}").unwrap();
        std::fs::write(hoops_path(&dir), "{ half a fi").unwrap();
        assert_eq!(read_hoops(&dir).unwrap(), HoopsRead { text: None, backup: Some("{\"v\":1}".into()), corrupt: true });
        std::fs::remove_file(crate::fsutil::bak_path(&hoops_path(&dir))).unwrap();
        assert_eq!(read_hoops(&dir).unwrap(), HoopsRead { text: None, backup: None, corrupt: true });
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_file_name_is_fixed() {
        assert_eq!(hoops_path(Path::new("/x")), PathBuf::from("/x/hoops.json"));
    }
}
