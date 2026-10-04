//! `.lilo` project files on the desktop: the default folder, the recent list and double-click open.
//!
//! The file format itself (a zip) is read and written by the engine in TypeScript. Rust only:
//! - makes `~/Documents/Lilo` on first run and lists the projects in it, newest first,
//! - receives "open this file" requests (macOS Finder double-click, or a path on the command line on
//!   Windows/Linux) and hands them to the editor,
//! - reads and writes project bytes for paths the user has actually opened or that live in the default
//!   folder (the editor's file-system scope is otherwise limited to dialog-picked paths, which are
//!   forgotten at restart).

use serde::{Deserialize, Serialize};
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

/// Name of the persistent recents file in the app data folder.
pub const RECENTS_FILE: &str = "recents.json";
/// Most paths kept in the recents file.
pub const MAX_RECENTS: usize = 50;

/// One remembered project: where it is and when the user last opened or saved it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub path: String,
    pub opened_at: u64,
}

/// Paths the editor may read and write besides the default folder: files the OS asked us to open.
#[derive(Default)]
pub struct OpenFiles {
    pending: Mutex<Vec<String>>,
    announced: Mutex<HashSet<PathBuf>>,
    /// Serialises read-modify-write of the recents file.
    recents_lock: Mutex<()>,
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

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The gallery row for one `.lilo` file; `None` for hidden files, non-files and other extensions.
fn project_info(path: &Path, meta: &std::fs::Metadata) -> Option<RecentProject> {
    let name = path.file_stem()?.to_str()?.to_string();
    if name.starts_with('.') || !is_project_path(path) || !meta.is_file() {
        return None;
    }
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(RecentProject { path: path.to_str()?.to_string(), name, modified_ms, size_bytes: meta.len() })
}

/// The recents file in the app data folder (not created).
fn recents_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(RECENTS_FILE))
}

/// The remembered projects, newest first. A missing or damaged file is an empty list.
pub fn read_recents(file: &Path) -> Vec<RecentEntry> {
    let Ok(text) = std::fs::read_to_string(file) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<RecentEntry>>(&text).unwrap_or_default()
}

/// Put `path` at the top of the recents file (deduped, capped), written through a temp file + rename.
pub fn record_in(file: &Path, path: &Path, now: u64) -> std::io::Result<()> {
    let Some(text) = path.to_str() else {
        return Ok(());
    };
    let mut list = read_recents(file);
    list.retain(|e| e.path != text);
    list.insert(0, RecentEntry { path: text.to_string(), opened_at: now });
    list.truncate(MAX_RECENTS);
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(&list).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, file)
}

fn record(app: &tauri::AppHandle, path: &Path) {
    let Some(file) = recents_file(app) else {
        return;
    };
    let state = app.state::<OpenFiles>();
    let _guard = state.recents_lock.lock().unwrap();
    if let Err(error) = record_in(&file, path, now_ms()) {
        tracing::warn!(%error, "Could not update the recent projects list");
    }
}

/// Is `resolved` (a resolved `.lilo` path) one that exists and is listed in the recents `file`?
pub fn in_recents_file(file: &Path, resolved: &Path) -> bool {
    if !is_project_path(resolved) || !resolved.is_file() {
        return false;
    }
    read_recents(file)
        .iter()
        .any(|e| is_project_path(Path::new(&e.path)) && Path::new(&e.path).canonicalize().is_ok_and(|c| c == resolved))
}

fn in_recents(app: &tauri::AppHandle, resolved: &Path) -> bool {
    recents_file(app).is_some_and(|f| in_recents_file(&f, resolved))
}

/// Recents merged with the default-folder scan: one row per file, vanished files dropped, newest
/// first (by the later of "last opened" and "last modified"), at most `limit`.
pub fn merge_recents(scanned: Vec<RecentProject>, recents: &[RecentEntry], limit: usize) -> Vec<RecentProject> {
    let mut rows: Vec<(u64, RecentProject)> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut add = |path: &Path, opened: u64, known: Option<RecentProject>| {
        let key = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        if !seen.insert(key) {
            return;
        }
        let info = known.or_else(|| {
            let meta = std::fs::metadata(path).ok()?;
            project_info(path, &meta)
        });
        if let Some(info) = info {
            rows.push((opened.max(info.modified_ms), info));
        }
    };
    for e in recents {
        let p = PathBuf::from(&e.path);
        let known = scanned.iter().find(|s| s.path == e.path).cloned();
        add(&p, e.opened_at, known);
    }
    for s in &scanned {
        add(Path::new(&s.path), 0, Some(s.clone()));
    }
    rows.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    rows.truncate(limit);
    rows.into_iter().map(|(_, r)| r).collect()
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
            let meta = entry.metadata().ok()?;
            project_info(&entry.path(), &meta)
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

/// A `.lilo` path with its folder resolved. The file may not exist yet (first save).
fn resolve(path: &Path) -> Result<PathBuf, String> {
    if !is_project_path(path) {
        return Err("Only .lilo project files can be opened here.".into());
    }
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).ok_or("The path has no folder.")?;
    let parent = parent.canonicalize().map_err(|_| "The folder does not exist.".to_string())?;
    let resolved = parent.join(path.file_name().ok_or("The path has no file name.")?);
    // A symbolic link could point a save at any file the user can write. Checked here, so it holds
    // when the path is registered and again at every read and write.
    if std::fs::symlink_metadata(&resolved).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("That file is a symbolic link; Lilo won't open or save through it.".into());
    }
    Ok(resolved)
}

/// The user picked this `.lilo` file in a native Open or Save dialog (possibly outside the default
/// folder): remember it, so Save and autosave can write to it later. Only `.lilo` paths whose folder
/// exists are accepted, so this can't be used to reach any other kind of file.
#[tauri::command]
pub fn allow_project_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let resolved = resolve(Path::new(&path))?;
    app.state::<OpenFiles>().announced.lock().unwrap().insert(resolved);
    Ok(())
}

/// May the editor touch `path`? Only `.lilo` files in the default folder, ones the OS opened for us,
/// or existing ones in the recents file (so a recent from a previous session still opens).
fn allowed(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
    let resolved = resolve(path)?;
    let in_default = projects_dir(app)
        .ok()
        .and_then(|d| d.canonicalize().ok())
        .is_some_and(|d| resolved.starts_with(d));
    let announced = app.state::<OpenFiles>().announced.lock().unwrap().contains(&resolved);
    if in_default || announced || in_recents(app, &resolved) {
        Ok(resolved)
    } else {
        Err("That file wasn't opened from Lilo's projects folder.".into())
    }
}

#[tauri::command]
pub fn list_recent_projects(app: tauri::AppHandle, limit: Option<usize>) -> Vec<RecentProject> {
    let limit = limit.unwrap_or(24).min(200);
    let scanned = projects_dir(&app).map(|d| scan_projects(&d, 200)).unwrap_or_default();
    let recents = recents_file(&app).map(|f| read_recents(&f)).unwrap_or_default();
    merge_recents(scanned, &recents, limit)
}

/// The editor opened this project successfully: remember it. Only paths the editor may already touch.
#[tauri::command]
pub fn record_recent(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let resolved = allowed(&app, Path::new(&path))?;
    if resolved.is_file() {
        record(&app, &resolved);
    }
    Ok(())
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
    let remember = path.clone();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the project bytes as the request body.".into());
    };
    if bytes.len() as u64 > MAX_PROJECT_BYTES {
        return Err("That project is too large to save.".into());
    }
    let bytes = bytes.to_vec();
    tokio::task::spawn_blocking(move || crate::fsutil::durable_write(&path, &bytes, crate::fsutil::looks_like_zip))
        .await
        .map_err(|e| format!("Could not save: {e}"))?
        .map_err(|e| format!("Could not save: {e}"))?;
    record(&app, &remember);
    Ok(())
}

/// The previous save of a project (`<name>.lilo.bak`), for when the file itself is damaged.
#[tauri::command]
pub async fn read_project_backup(app: tauri::AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let path = allowed(&app, Path::new(&path))?;
    let bak = crate::fsutil::bak_path(&path);
    if std::fs::symlink_metadata(&bak).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("There is no earlier copy.".into());
    }
    let bytes = tokio::fs::read(&bak).await.map_err(|_| "There is no earlier copy.".to_string())?;
    if bytes.len() as u64 > MAX_PROJECT_BYTES || !crate::fsutil::looks_like_zip(&bytes) {
        return Err("There is no earlier copy.".into());
    }
    Ok(tauri::ipc::Response::new(bytes))
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
    fn resolves_chosen_paths_only_for_lilo_files_in_real_folders() {
        let dir = scratch("resolve");
        let canonical = dir.canonicalize().unwrap();
        // a file that does not exist yet is fine (first save)
        assert_eq!(resolve(&dir.join("New.lilo")).unwrap(), canonical.join("New.lilo"));
        assert!(resolve(&dir.join("notes.txt")).is_err());
        assert!(resolve(&dir.join("missing-folder").join("a.lilo")).is_err());
        assert!(resolve(Path::new("a.lilo")).is_err());
        // the folder part is canonicalised, so "sub/../x.lilo" lands where it really is
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        assert_eq!(resolve(&dir.join("sub").join("..").join("x.lilo")).unwrap(), canonical.join("x.lilo"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_project_path_that_is_a_symlink() {
        let dir = scratch("symlink");
        let target = dir.join("elsewhere.txt");
        std::fs::write(&target, b"x").unwrap();
        let link = dir.join("Evil.lilo");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(resolve(&link).unwrap_err().contains("symbolic link"));
        // a regular file next to it is fine
        std::fs::write(dir.join("Good.lilo"), b"x").unwrap();
        assert!(resolve(&dir.join("Good.lilo")).is_ok());
        // and the check holds later: a good path swapped for a link after registering is refused again
        std::fs::remove_file(dir.join("Good.lilo")).unwrap();
        std::os::unix::fs::symlink(&target, dir.join("Good.lilo")).unwrap();
        assert!(resolve(&dir.join("Good.lilo")).is_err());
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

    #[test]
    fn records_newest_first_deduped_and_capped() {
        let dir = scratch("rec");
        let file = dir.join("data").join(RECENTS_FILE);
        record_in(&file, Path::new("/a.lilo"), 1).unwrap();
        record_in(&file, Path::new("/b.lilo"), 2).unwrap();
        record_in(&file, Path::new("/a.lilo"), 3).unwrap();
        let list = read_recents(&file);
        assert_eq!(list.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), ["/a.lilo", "/b.lilo"]);
        assert_eq!(list[0].opened_at, 3);
        for n in 0..(MAX_RECENTS as u64 + 10) {
            record_in(&file, Path::new(&format!("/p{n}.lilo")), 10 + n).unwrap();
        }
        let list = read_recents(&file);
        assert_eq!(list.len(), MAX_RECENTS);
        assert_eq!(list[0].path, format!("/p{}.lilo", MAX_RECENTS as u64 + 9));
        assert!(!file.with_extension("json.tmp").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_missing_or_corrupt_recents_file_is_empty() {
        let dir = scratch("corrupt");
        let file = dir.join(RECENTS_FILE);
        assert!(read_recents(&file).is_empty());
        std::fs::write(&file, b"{not json").unwrap();
        assert!(read_recents(&file).is_empty());
        // and recording over it recovers
        record_in(&file, Path::new("/a.lilo"), 1).unwrap();
        assert_eq!(read_recents(&file).len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn merges_recents_with_the_scan_and_drops_missing_files() {
        let docs = scratch("merge-docs");
        let elsewhere = scratch("merge-else");
        touch(&docs, "in-docs.lilo", 5000, b"a");
        touch(&elsewhere, "outside.lilo", 9000, b"bb");
        touch(&elsewhere, "recent.lilo", 9000, b"cc");
        touch(&elsewhere, "notes.txt", 9000, b"x");
        let p = |d: &Path, n: &str| d.join(n).to_str().unwrap().to_string();
        let now = now_ms();
        let recents = vec![
            RecentEntry { path: p(&elsewhere, "recent.lilo"), opened_at: now },
            RecentEntry { path: p(&elsewhere, "gone.lilo"), opened_at: now },
            RecentEntry { path: p(&elsewhere, "notes.txt"), opened_at: now },
            RecentEntry { path: p(&docs, "in-docs.lilo"), opened_at: now - 1000 },
            RecentEntry { path: p(&elsewhere, "outside.lilo"), opened_at: 0 },
        ];
        let merged = merge_recents(scan_projects(&docs, 10), &recents, 10);
        assert_eq!(merged.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["recent", "in-docs", "outside"]);
        assert_eq!(merge_recents(scan_projects(&docs, 10), &recents, 2).len(), 2);
        // with no recents it is just the scan
        assert_eq!(merge_recents(scan_projects(&docs, 10), &[], 10).len(), 1);
        std::fs::remove_dir_all(docs).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn recents_only_allow_existing_lilo_files() {
        let dir = scratch("allow");
        touch(&dir, "ok.lilo", 1, b"x");
        touch(&dir, "secret.txt", 1, b"x");
        let dir = dir.canonicalize().unwrap();
        let file = dir.join(RECENTS_FILE);
        for name in ["ok.lilo", "secret.txt", "gone.lilo"] {
            record_in(&file, &dir.join(name), 1).unwrap();
        }
        assert!(in_recents_file(&file, &dir.join("ok.lilo")));
        assert!(!in_recents_file(&file, &dir.join("secret.txt")));
        assert!(!in_recents_file(&file, &dir.join("gone.lilo")));
        // a real .lilo that was never recorded is not allowed
        touch(&dir, "other.lilo", 1, b"x");
        assert!(!in_recents_file(&file, &dir.join("other.lilo")));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
