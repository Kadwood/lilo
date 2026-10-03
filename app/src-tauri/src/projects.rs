//! `.lilo` project files on the desktop: the default folder, the recent list and double-click open.
//!
//! The file format itself (a zip) is read and written by the engine in TypeScript. Rust only:
//! - makes `~/Documents/Lilo` on first run and lists the projects in it, newest first,
//! - receives "open this file" requests (macOS Finder double-click, or a path on the command line on
//!   Windows/Linux) and hands them to the editor,
//! - reads and writes project bytes for paths the user has actually opened or that live in the default
//!   folder (the editor's file-system scope is otherwise limited to dialog-picked paths, which are
//!   forgotten at restart).

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{Emitter, Manager};

pub const EXTENSION: &str = "lilo";
/// Folder inside the user's Documents.
pub const FOLDER: &str = "Lilo";
/// Event the editor listens to for files opened while it is running.
pub const OPEN_EVENT: &str = "lilo-open-file";
/// Refuse project files bigger than this (the engine enforces its own unzip limits too).
pub const MAX_PROJECT_BYTES: u64 = 512 * 1024 * 1024;

/// One row of the recent-projects gallery. The thumbnail is inside the file; the editor reads it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    /// File name without the extension.
    pub name: String,
    pub modified_ms: u64,
    pub size_bytes: u64,
}

/// Paths the editor may read and write besides the default folder: files the OS asked us to open.
#[derive(Default)]
pub struct OpenFiles {
    pending: Mutex<Vec<String>>,
    announced: Mutex<HashSet<PathBuf>>,
}

pub fn is_project_path(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(EXTENSION))
}

/// `~/Documents/Lilo` (not created).
pub fn projects_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .map(|d| d.join(FOLDER))
        .map_err(|e| format!("No Documents folder: {e}"))
}

/// Create the default folder if it isn't there yet. Failure is not fatal (read-only home, say).
pub fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

/// The `.lilo` files directly inside `dir`, newest first, at most `limit`. Hidden files, folders and
/// other extensions are ignored; an unreadable folder is an empty list.
pub fn scan_projects(dir: &Path, limit: usize) -> Vec<RecentProject> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<RecentProject> = read
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_stem()?.to_str()?.to_string();
            if name.starts_with('.') || !is_project_path(&path) {
                return None;
            }
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Some(RecentProject {
                path: path.to_str()?.to_string(),
                name,
                modified_ms,
                size_bytes: meta.len(),
            })
        })
        .collect();
    found.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| a.name.cmp(&b.name)));
    found.truncate(limit);
    found
}

/// `.lilo` files named in a command line (the first argument is the program and is skipped).
pub fn paths_from_args(args: &[String]) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .map(PathBuf::from)
        .filter(|p| is_project_path(p) && p.is_file())
        .collect()
}

/// `.lilo` files in a list of `file://` URLs (what macOS passes for a Finder open).
pub fn paths_from_urls(urls: &[tauri::Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter(|u| u.scheme() == "file")
        .filter_map(|u| u.to_file_path().ok())
        .filter(|p| is_project_path(p))
        .collect()
}

/// Remember `paths`, bring the window forward and tell the editor.
pub fn announce(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let state = app.state::<OpenFiles>();
    for p in paths {
        let Ok(canonical) = p.canonicalize() else {
            continue;
        };
        let Some(text) = canonical.to_str().map(str::to_string) else {
            continue;
        };
        state.announced.lock().unwrap().insert(canonical);
        let mut pending = state.pending.lock().unwrap();
        if !pending.contains(&text) {
            pending.push(text);
        }
    }
    crate::show_main_window(app);
    let _ = app.emit(OPEN_EVENT, ());
}

/// May the editor touch `path`? Only `.lilo` files in the default folder or ones the OS opened for us.
fn allowed(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
    if !is_project_path(path) {
        return Err("Only .lilo project files can be opened here.".into());
    }
    // The file may not exist yet (first save), so resolve its folder instead.
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).ok_or("The path has no folder.")?;
    let parent = parent.canonicalize().map_err(|_| "The folder does not exist.".to_string())?;
    let resolved = parent.join(path.file_name().ok_or("The path has no file name.")?);
    let in_default = projects_dir(app)
        .ok()
        .and_then(|d| d.canonicalize().ok())
        .is_some_and(|d| resolved.starts_with(d));
    let announced = app.state::<OpenFiles>().announced.lock().unwrap().contains(&resolved);
    if in_default || announced {
        Ok(resolved)
    } else {
        Err("That file wasn't opened from Lilo's projects folder.".into())
    }
}

#[tauri::command]
pub fn list_recent_projects(app: tauri::AppHandle, limit: Option<usize>) -> Vec<RecentProject> {
    match projects_dir(&app) {
        Ok(dir) => scan_projects(&dir, limit.unwrap_or(24).min(200)),
        Err(_) => Vec::new(),
    }
}

/// The default projects folder (created if missing), for the editor's "Save" dialog default.
#[tauri::command]
pub fn projects_folder(app: tauri::AppHandle) -> Result<String, String> {
    let dir = projects_dir(&app)?;
    ensure_dir(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    dir.to_str().map(str::to_string).ok_or_else(|| "The projects folder path is not valid text.".into())
}

/// Files the OS asked us to open since the editor last asked.
#[tauri::command]
pub fn take_open_files(app: tauri::AppHandle) -> Vec<String> {
    std::mem::take(&mut *app.state::<OpenFiles>().pending.lock().unwrap())
}

#[tauri::command]
pub async fn read_project_file(app: tauri::AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let path = allowed(&app, Path::new(&path))?;
    let meta = tokio::fs::metadata(&path).await.map_err(|e| format!("Could not read the file: {e}"))?;
    if meta.len() > MAX_PROJECT_BYTES {
        return Err("That project file is too large to open.".into());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| format!("Could not read the file: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Raw request body = the project bytes; the target path travels in the `path` header (URL-encoded).
/// Writes through a temp file and a rename so a crash mid-save never leaves half a project.
#[tauri::command]
pub async fn write_project_file(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let raw = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing path header.")?
        .to_string();
    let decoded = percent_decode(&raw);
    let path = allowed(&app, Path::new(&decoded))?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the project bytes as the request body.".into());
    };
    if bytes.len() as u64 > MAX_PROJECT_BYTES {
        return Err("That project is too large to save.".into());
    }
    let tmp = path.with_extension("lilo.tmp");
    tokio::fs::write(&tmp, bytes).await.map_err(|e| format!("Could not save: {e}"))?;
    tokio::fs::rename(&tmp, &path).await.map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save: {e}")
    })
}

/// Minimal `%XX` decoder for the path header.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 3 <= b.len() && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            // both bytes are ASCII hex digits, so this slice is valid UTF-8 and parses
            out.push(u8::from_str_radix(&s[i + 1..i + 3], 16).unwrap());
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Called once from `setup`: state, the default folder, and any file named on the command line.
pub fn setup(app: &tauri::App) {
    app.manage(OpenFiles::default());
    if let Ok(dir) = projects_dir(app.handle()) {
        if let Err(error) = ensure_dir(&dir) {
            tracing::warn!(%error, "Could not create the Lilo projects folder");
        }
    }
    let args: Vec<String> = std::env::args().collect();
    announce(app.handle(), paths_from_args(&args));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::time::{Duration, SystemTime};

    fn scratch(tag: &str) -> PathBuf {
        let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("lilo-projects-{tag}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(dir: &Path, name: &str, age_secs: u64, bytes: &[u8]) {
        let f = File::create(dir.join(name)).unwrap();
        std::fs::write(dir.join(name), bytes).unwrap();
        f.set_modified(SystemTime::now() - Duration::from_secs(age_secs)).unwrap();
    }

    #[test]
    fn recognises_project_paths() {
        assert!(is_project_path(Path::new("/a/b/Crest.lilo")));
        assert!(is_project_path(Path::new("Crest.LILO")));
        assert!(!is_project_path(Path::new("Crest.pes")));
        assert!(!is_project_path(Path::new("lilo")));
        assert!(!is_project_path(Path::new("Crest.lilo.zip")));
    }

    #[test]
    fn creates_the_folder_on_first_run_and_is_idempotent() {
        let base = scratch("create");
        let dir = base.join("Documents").join(FOLDER);
        assert!(!dir.exists());
        ensure_dir(&dir).unwrap();
        ensure_dir(&dir).unwrap();
        assert!(dir.is_dir());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn lists_projects_newest_first_ignoring_everything_else() {
        let dir = scratch("scan");
        touch(&dir, "old.lilo", 3000, b"a");
        touch(&dir, "new.lilo", 10, b"bb");
        touch(&dir, "mid.LILO", 500, b"ccc");
        touch(&dir, "notes.txt", 1, b"x");
        touch(&dir, "design.pes", 1, b"x");
        touch(&dir, ".hidden.lilo", 1, b"x");
        std::fs::create_dir_all(dir.join("folder.lilo")).unwrap();
        let list = scan_projects(&dir, 10);
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["new", "mid", "old"]);
        assert_eq!(list[0].size_bytes, 2);
        assert!(list[0].modified_ms > list[2].modified_ms);
        assert!(list[0].path.ends_with("new.lilo"));
        assert_eq!(scan_projects(&dir, 2).len(), 2);
        assert!(scan_projects(&dir.join("missing"), 5).is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn finds_project_files_on_the_command_line() {
        let dir = scratch("args");
        touch(&dir, "a.lilo", 1, b"x");
        touch(&dir, "b.pes", 1, b"x");
        let a = dir.join("a.lilo").to_str().unwrap().to_string();
        let b = dir.join("b.pes").to_str().unwrap().to_string();
        let gone = dir.join("gone.lilo").to_str().unwrap().to_string();
        // the first argument is the program itself, even if it looks like a project
        let args = vec![a.clone(), a.clone(), b, gone, "--minimized".into()];
        assert_eq!(paths_from_args(&args), vec![PathBuf::from(&a)]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn turns_file_urls_into_paths() {
        let urls: Vec<tauri::Url> = ["file:///Users/me/Documents/Lilo/Crest.lilo", "file:///tmp/x.pes", "https://example.com/a.lilo"]
            .iter()
            .map(|u| u.parse().unwrap())
            .collect();
        assert_eq!(paths_from_urls(&urls), vec![PathBuf::from("/Users/me/Documents/Lilo/Crest.lilo")]);
    }

    #[test]
    fn decodes_path_headers() {
        assert_eq!(percent_decode("%2FUsers%2Fme%2FMy%20Crest.lilo"), "/Users/me/My Crest.lilo");
        assert_eq!(percent_decode("plain.lilo"), "plain.lilo");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(percent_decode("%E2%9C%93.lilo"), "\u{2713}.lilo");
    }
}
