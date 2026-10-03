//! Desktop lifecycle: navigation-only deep links (`lilo://`).
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Default)]
struct Navigation(Mutex<Option<String>>);
fn destination(url: &reqwest::Url) -> Option<&'static str> {
    if url.scheme() != "lilo"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return None;
    }
    match url.host_str()? {
        "open" => Some("machines"),
        "connect" => Some("settings"),
        _ => None,
    }
}
fn navigate(app: &tauri::AppHandle, urls: Vec<reqwest::Url>) {
    for url in urls {
        if let Some(page) = destination(&url) {
            *app.state::<Navigation>().0.lock().unwrap() = Some(page.to_string());
            crate::show_main_window(app);
            let _ = app.emit("lilo-navigation", ());
        }
    }
}
pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(Navigation::default());
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    if let Err(error) = app.deep_link().register_all() {
        // URL launch support is optional; a missing desktop helper or denied
        // registration must not prevent local setup and file transfers.
        tracing::warn!(%error, "Could not register lilo URL handler");
    }
    let handle = app.handle().clone();
    app.deep_link()
        .on_open_url(move |event| navigate(&handle, event.urls()));
    if let Some(urls) = app.deep_link().get_current()? {
        navigate(app.handle(), urls);
    }
    Ok(())
}
#[tauri::command]
pub fn take_navigation(app: tauri::AppHandle) -> Option<String> {
    app.state::<Navigation>().0.lock().unwrap().take()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_navigation_only() {
        for (url, page) in [
            ("lilo://open", "machines"),
            ("lilo://connect/", "settings"),
        ] {
            assert_eq!(destination(&url.parse().unwrap()), Some(page));
        }
        for url in [
            "https://open",
            "lilo://send",
            "lilo://open?token=secret",
            "lilo://setup/file",
            "lilo://user@open",
            "lilo://open:42",
            "lilo://connect#approve",
        ] {
            assert_eq!(destination(&url.parse().unwrap()), None);
        }
    }
}
