//! The window's material: Liquid Glass on macOS 26+, a frosted sidebar elsewhere on macOS, Mica on
//! Windows 11, plain on Linux. The editor draws its chrome over whatever this reports (CSS
//! `data-material` on `<html>`), so a failure here only costs the see-through look, never the app.
//!
//! Sources (read 2026-10-03):
//! * `window-vibrancy` 0.8.1 (crates.io, 2026-09-22), `apply_liquid_glass(window, LiquidGlassOptions)`:
//!   macOS 26.0+, errors with `UnsupportedPlatformVersion` before that. 0.7.x took positional arguments;
//!   0.8.0 moved to the options struct and added `content_view`. `NSGlassEffectViewStyle` values past
//!   `Regular`/`Clear` are private API.
//! * Corner bug, tauri-apps/window-vibrancy#198 ("apply_liquid_glass breaks window edges closed"): in
//!   0.7.1 the window corners stop lining up with the glass once the window gets focus. The fix that was
//!   merged (#199, in 0.8.0) is to move the webview into the glass view's content view, which is what
//!   `content_view` below does; no corner radius is passed because the radius only suits undecorated
//!   windows (maintainer comment on #198). NOT reproducible on the macOS 15 machine this was written on:
//!   check it on macOS 26.
//! * The webview must be transparent for any of this to show: `transparent` + `macOSPrivateApi` in
//!   `tauri.macos.conf.json` and the `macos-private-api` Cargo feature (GitHub distribution only; the
//!   private API rules out the Mac App Store).
//! * `NSVisualEffectMaterial::Sidebar` is the macOS 10.11+ fallback; `apply_mica` needs Windows 11.
//!
//! `LILO_GLASS=off|vibrancy` forces a simpler material, for chasing a rendering problem.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// What the editor should assume is behind the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Material {
    /// macOS 26+: NSGlassEffectView.
    LiquidGlass,
    /// macOS before 26: NSVisualEffectView, sidebar material.
    Vibrancy,
    /// Windows 11 Mica (only built on Windows).
    #[allow(dead_code)]
    Mica,
    /// Nothing see-through (Linux, old Windows, or a failure): the page paints solid surfaces.
    Solid,
}

/// The material that was applied, filled in once the window has been set up.
#[derive(Default)]
pub struct MaterialState(Mutex<Option<Material>>);

impl MaterialState {
    pub fn get(&self) -> Option<Material> {
        *self.0.lock().unwrap()
    }
    fn set(&self, m: Material) {
        *self.0.lock().unwrap() = Some(m);
    }
}

/// `LILO_GLASS` override: "off" = solid, "vibrancy" = skip Liquid Glass.
fn forced() -> Option<String> {
    std::env::var("LILO_GLASS").ok().map(|v| v.to_ascii_lowercase())
}

/// Tell the page, and remember it for late askers.
fn announce(app: &tauri::AppHandle, m: Material) {
    app.state::<MaterialState>().set(m);
    let _ = app.emit("lilo-window-material", m);
}

#[cfg(target_os = "macos")]
fn apply(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    use objc2_app_kit::NSView;
    use window_vibrancy::{apply_liquid_glass, apply_vibrancy, LiquidGlassOptions, NSGlassEffectViewStyle, NSVisualEffectMaterial, NSVisualEffectState};

    let force = forced();
    if force.as_deref() == Some("off") {
        return announce(app, Material::Solid);
    }
    let app2 = app.clone();
    let w2 = window.clone();
    // `with_webview` runs the closure on the main thread, where AppKit calls belong.
    let queued = window.with_webview(move |webview| {
        // the WKWebView is an NSView; it goes inside the glass so the corners follow the glass (#198)
        let web: &NSView = unsafe { &*(webview.inner() as *const NSView) };
        let glass = if force.as_deref() == Some("vibrancy") {
            Err("forced off".to_string())
        } else {
            apply_liquid_glass(&w2, LiquidGlassOptions::new(NSGlassEffectViewStyle::Regular).content_view(web)).map_err(|e| e.to_string())
        };
        match glass {
            Ok(()) => announce(&app2, Material::LiquidGlass),
            Err(why) => {
                tracing::info!("no Liquid Glass ({why}); using the sidebar material");
                match apply_vibrancy(&w2, NSVisualEffectMaterial::Sidebar, Some(NSVisualEffectState::FollowsWindowActiveState), None) {
                    Ok(()) => announce(&app2, Material::Vibrancy),
                    Err(e) => {
                        tracing::warn!("could not apply vibrancy: {e}");
                        announce(&app2, Material::Solid);
                    }
                }
            }
        }
    });
    if let Err(e) = queued {
        tracing::warn!("could not reach the webview to apply the window material: {e}");
        announce(app, Material::Solid);
    }
}

#[cfg(target_os = "windows")]
fn apply(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    if forced().as_deref() == Some("off") {
        return announce(app, Material::Solid);
    }
    // `None` follows the system light/dark choice
    match window_vibrancy::apply_mica(window, None) {
        Ok(()) => announce(app, Material::Mica),
        Err(e) => {
            tracing::info!("no Mica ({e}); using a solid window");
            announce(app, Material::Solid);
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn apply(app: &tauri::AppHandle, _window: &tauri::WebviewWindow) {
    announce(app, Material::Solid);
}

/// Give the main window its material. Call from `setup`, after the window exists.
pub fn setup(app: &tauri::App) {
    app.manage(MaterialState::default());
    match app.get_webview_window("main") {
        Some(window) => apply(app.handle(), &window),
        None => announce(app.handle(), Material::Solid),
    }
}

/// Has the user asked macOS for "Reduce transparency" (System Settings > Accessibility > Display)?
/// Always false elsewhere. The page also asks the browser (`prefers-reduced-transparency`); this is the
/// answer that works inside the webview.
#[tauri::command]
pub fn reduce_transparency() -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSWorkspace;
        // `NSWorkspace.shared` and this property can be read from any thread
        NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// The material, if the window has been set up yet (the page also hears `lilo-window-material`).
#[tauri::command]
pub fn window_material(state: tauri::State<'_, MaterialState>) -> Option<Material> {
    state.get()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_gets_kebab_case_names() {
        assert_eq!(serde_json::to_string(&Material::LiquidGlass).unwrap(), "\"liquid-glass\"");
        assert_eq!(serde_json::to_string(&Material::Vibrancy).unwrap(), "\"vibrancy\"");
        assert_eq!(serde_json::to_string(&Material::Mica).unwrap(), "\"mica\"");
        assert_eq!(serde_json::to_string(&Material::Solid).unwrap(), "\"solid\"");
    }

    #[test]
    fn nothing_is_known_until_the_window_is_set_up() {
        let s = MaterialState::default();
        assert_eq!(s.get(), None);
        s.set(Material::Vibrancy);
        assert_eq!(s.get(), Some(Material::Vibrancy));
    }
}
