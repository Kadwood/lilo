//! "My Threads" shelf on disk: one JSON file, `~/Documents/Lilo/my-threads.json`.
//!
//! The editor builds and validates the shelf (engine `importShelf`); Rust only stores the text. The
//! file name is fixed, so the commands can't be used to read or write anything else, and the text must
//! parse as JSON and stay small, so a bug can't fill the disk or leave a corrupt file behind (writes go
//! through a temp file and a rename).

use std::path::{Path, PathBuf};

/// Fixed name inside the projects folder.
pub const FILE_NAME: &str = "my-threads.json";
/// A shelf of thousands of spools is well under a megabyte; refuse anything silly.
pub const MAX_BYTES: usize = 8 * 1024 * 1024;

/// Where the shelf lives for a given projects folder.
pub fn shelf_path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// The shelf's JSON text, or `None` if there is no file yet (a fresh install).
pub fn read_shelf(dir: &Path) -> Result<Option<String>, String> {
    let path = shelf_path(dir);
    match std::fs::metadata(&path) {
        Ok(meta) => {
            if meta.len() as usize > MAX_BYTES {
                return Err("The My Threads file is too large to open.".into());
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Could not read My Threads: {e}")),
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Could not read My Threads: {e}"))
}

/// Save the shelf atomically. Rejects text that is too big or not JSON.
pub fn write_shelf(dir: &Path, text: &str) -> Result<(), String> {
    if text.len() > MAX_BYTES {
        return Err("My Threads is too large to save.".into());
    }
    serde_json::from_str::<serde_json::Value>(text).map_err(|_| "My Threads must be valid JSON.".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let path = shelf_path(dir);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("Could not save My Threads: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save My Threads: {e}")
    })
}

#[tauri::command]
pub fn read_my_threads(app: tauri::AppHandle) -> Result<Option<String>, String> {
    read_shelf(&crate::projects::projects_dir(&app)?)
}

#[tauri::command]
pub fn write_my_threads(app: tauri::AppHandle, json: String) -> Result<(), String> {
    write_shelf(&crate::projects::projects_dir(&app)?, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(tag: &str) -> PathBuf {
        let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("lilo-threads-{tag}-{}-{n}", std::process::id()))
    }

    #[test]
    fn no_file_means_no_shelf_yet() {
        let dir = scratch("none");
        assert_eq!(read_shelf(&dir).unwrap(), None);
    }

    #[test]
    fn saves_and_reads_back_creating_the_folder() {
        let dir = scratch("roundtrip");
        write_shelf(&dir, "{\"version\":1,\"entries\":[]}").unwrap();
        assert_eq!(read_shelf(&dir).unwrap().as_deref(), Some("{\"version\":1,\"entries\":[]}"));
        write_shelf(&dir, "[1,2]").unwrap();
        assert_eq!(read_shelf(&dir).unwrap().as_deref(), Some("[1,2]"));
        assert!(!dir.join("my-threads.json.tmp").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_text_that_is_not_json_or_too_big_and_keeps_the_old_file() {
        let dir = scratch("refuse");
        write_shelf(&dir, "{\"ok\":true}").unwrap();
        assert!(write_shelf(&dir, "not json").is_err());
        let huge = format!("\"{}\"", "x".repeat(MAX_BYTES));
        assert!(write_shelf(&dir, &huge).is_err());
        assert_eq!(read_shelf(&dir).unwrap().as_deref(), Some("{\"ok\":true}"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
