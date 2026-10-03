//! Writing user files so a crash, a full disk or a power cut never leaves half a file behind.
//!
//! `durable_write`: the bytes go to a fresh temp file next to the target and are fsynced; the old
//! file (if it was good) is kept as `<name>.bak`, one generation; then the temp file is renamed into
//! place and the folder is fsynced where the platform allows. A symlink in the way is refused, and a
//! stale temp file is replaced, never followed.

use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

fn with_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s: OsString = p.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

/// Where the previous version of `path` is kept.
pub fn bak_path(path: &Path) -> PathBuf {
    with_suffix(path, ".bak")
}

/// A zip starts with "PK" and has at least an end-of-directory record: enough to tell a damaged
/// project from a good one when deciding whether it may replace the backup.
pub fn looks_like_zip(bytes: &[u8]) -> bool {
    bytes.len() >= 22 && bytes.starts_with(b"PK")
}

/// Save `bytes` to `path`. `valid` says whether an existing file is worth keeping as the backup (a
/// damaged file must not replace a good backup).
pub fn durable_write(path: &Path, bytes: &[u8], valid: impl Fn(&[u8]) -> bool) -> io::Result<()> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "The file is a symbolic link; refusing to write through it."));
        }
    }
    let tmp = with_suffix(path, ".tmp");
    let _ = fs::remove_file(&tmp); // a leftover (or a planted link) is replaced, never followed
    let mut f: File = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
    let written = f.write_all(bytes).and_then(|_| f.sync_all());
    drop(f);
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    if let Ok(old) = fs::read(path) {
        if valid(&old) {
            let bak = bak_path(path);
            let _ = fs::remove_file(&bak);
            let _ = fs::write(&bak, &old);
        }
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    #[cfg(unix)]
    if let Some(dir) = path.parent() {
        if let Ok(d) = File::open(dir) {
            let _ = d.sync_all();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(tag: &str) -> PathBuf {
        let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("lilo-fs-{tag}-{}-{n}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn writes_and_keeps_one_previous_generation() {
        let d = scratch("gen");
        let p = d.join("a.txt");
        durable_write(&p, b"one", |_| true).unwrap();
        assert!(!bak_path(&p).exists());
        durable_write(&p, b"two", |_| true).unwrap();
        durable_write(&p, b"three", |_| true).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"three");
        assert_eq!(fs::read(bak_path(&p)).unwrap(), b"two");
        assert!(!with_suffix(&p, ".tmp").exists());
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn a_damaged_file_does_not_replace_a_good_backup() {
        let d = scratch("bad");
        let p = d.join("a.json");
        let valid = |b: &[u8]| b.starts_with(b"{");
        durable_write(&p, b"{\"v\":1}", valid).unwrap();
        durable_write(&p, b"{\"v\":2}", valid).unwrap(); // backup = v1
        fs::write(&p, b"garbage").unwrap(); // the file gets damaged outside our control
        durable_write(&p, b"{\"v\":3}", valid).unwrap();
        assert_eq!(fs::read(bak_path(&p)).unwrap(), b"{\"v\":1}"); // still the last good copy
        assert_eq!(fs::read(&p).unwrap(), b"{\"v\":3}");
        fs::remove_dir_all(d).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_target_and_replaces_a_planted_temp_link() {
        let d = scratch("link");
        let secret = d.join("secret.txt");
        fs::write(&secret, b"keep").unwrap();
        let p = d.join("a.lilo");
        std::os::unix::fs::symlink(&secret, &p).unwrap();
        assert!(durable_write(&p, b"x", |_| true).is_err());
        assert_eq!(fs::read(&secret).unwrap(), b"keep");
        fs::remove_file(&p).unwrap();
        // a link planted where the temp file goes is removed, not written through
        std::os::unix::fs::symlink(&secret, with_suffix(&p, ".tmp")).unwrap();
        durable_write(&p, b"new", |_| true).unwrap();
        assert_eq!(fs::read(&secret).unwrap(), b"keep");
        assert_eq!(fs::read(&p).unwrap(), b"new");
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn zip_sniffing() {
        assert!(looks_like_zip(&[b'P', b'K', 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert!(!looks_like_zip(b"PK"));
        assert!(!looks_like_zip(b"not a zip at all, definitely"));
    }
}
