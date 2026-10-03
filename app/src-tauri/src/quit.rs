//! Quitting without losing work. Every way out of the app (the tray's "Quit Lilo", ⌘Q, the app menu,
//! the Dock, closing the last window) ends in `ExitRequested`. If the editor has unsaved changes the
//! exit is held back and the editor is asked ("Save / Don't save / Cancel"); only when it answers
//! through `quit_now` does the app really exit.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

/// Event the editor listens to: "someone wants to quit, run the unsaved-changes guard".
pub const QUIT_EVENT: &str = "lilo-quit-requested";

#[derive(Default)]
pub struct QuitState {
    /// The editor has unsaved changes (reported by `set_dirty`).
    dirty: AtomicBool,
    /// The editor said it is fine to go: the next exit is let through.
    confirmed: AtomicBool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    /// Let the exit happen.
    Exit,
    /// Hold it back and ask the editor.
    Ask,
}

/// The whole policy: ask only when there is something to lose and the editor has not already said yes.
pub fn decide(dirty: bool, confirmed: bool) -> Decision {
    if dirty && !confirmed {
        Decision::Ask
    } else {
        Decision::Exit
    }
}

impl QuitState {
    pub fn decision(&self) -> Decision {
        decide(self.dirty.load(Ordering::SeqCst), self.confirmed.load(Ordering::SeqCst))
    }
}

/// Somebody asked to quit (tray menu, ...): exit now if clean, otherwise ask the editor first.
pub fn request_quit(app: &tauri::AppHandle) {
    if app.state::<QuitState>().decision() == Decision::Exit {
        app.exit(0);
    } else {
        ask(app);
    }
}

/// Bring the window forward and tell the editor to run its guard.
pub fn ask(app: &tauri::AppHandle) {
    crate::show_main_window(app);
    let _ = app.emit(QUIT_EVENT, ());
}

/// The editor reports whether it has unsaved changes.
#[tauri::command]
pub fn set_dirty(state: tauri::State<'_, QuitState>, dirty: bool) {
    state.dirty.store(dirty, Ordering::SeqCst);
    if !dirty {
        state.confirmed.store(false, Ordering::SeqCst);
    }
}

/// The editor has dealt with unsaved changes (saved, or the user chose not to): exit for real.
#[tauri::command]
pub fn quit_now(app: tauri::AppHandle, state: tauri::State<'_, QuitState>) {
    state.confirmed.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_quits_dirty_asks_and_a_yes_lets_it_through() {
        assert_eq!(decide(false, false), Decision::Exit);
        assert_eq!(decide(true, false), Decision::Ask);
        assert_eq!(decide(true, true), Decision::Exit); // quit_now: no second prompt, no loop
        assert_eq!(decide(false, true), Decision::Exit);
    }

    #[test]
    fn state_follows_what_the_editor_reports() {
        let s = QuitState::default();
        assert_eq!(s.decision(), Decision::Exit);
        s.dirty.store(true, Ordering::SeqCst);
        assert_eq!(s.decision(), Decision::Ask);
        s.confirmed.store(true, Ordering::SeqCst);
        assert_eq!(s.decision(), Decision::Exit);
    }
}
