//! How big the screen really is, so "Actual size" can put 1 mm on the display at 1 mm.
//!
//! The editor draws in CSS pixels (points on a Mac). To get CSS pixels per millimetre we need the
//! display's width in points and its physical width in millimetres: macOS reports both
//! (`CGDisplayBounds` and `CGDisplayScreenSize`, the latter from the display's EDID). EDID can be wrong
//! or missing (some external monitors report 0 or a made-up size), so the editor also offers a
//! calibration (hold a credit card to the screen) and that always wins over what is read here.

use serde::Serialize;

/// One display: where it sits (points) and how big it is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Display {
    pub x: f64,
    pub y: f64,
    pub width_pt: f64,
    pub height_pt: f64,
    pub width_mm: f64,
    pub height_mm: f64,
}

/// What the editor gets. `px_per_mm` is None when the size is not known (calibrate, or assume 96 dpi).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenInfo {
    pub px_per_mm: Option<f64>,
    pub width_mm: Option<f64>,
    pub height_mm: Option<f64>,
    pub width_pt: Option<f64>,
    /// "display" (read from the OS) or "unknown".
    pub source: &'static str,
}

impl ScreenInfo {
    pub fn unknown() -> Self {
        Self { px_per_mm: None, width_mm: None, height_mm: None, width_pt: None, source: "unknown" }
    }
}

/// Plausible physical size of a display: between a phone and a wall.
fn plausible(mm: f64) -> bool {
    mm.is_finite() && (30.0..=6000.0).contains(&mm)
}

/// The display containing the point `(x, y)` (points), else the first one.
pub fn pick_display(displays: &[Display], x: f64, y: f64) -> Option<Display> {
    displays
        .iter()
        .find(|d| x >= d.x && x < d.x + d.width_pt && y >= d.y && y < d.y + d.height_pt)
        .or_else(|| displays.first())
        .copied()
}

/// Turn a display into what the editor needs, or unknown if the OS gave nonsense.
pub fn info_for(d: Option<Display>) -> ScreenInfo {
    let Some(d) = d else { return ScreenInfo::unknown() };
    if !plausible(d.width_mm) || !plausible(d.height_mm) || !d.width_pt.is_finite() || d.width_pt <= 0.0 {
        return ScreenInfo::unknown();
    }
    let px_per_mm = d.width_pt / d.width_mm;
    // a real screen is 3-12 CSS px per mm (about 75-300 dpi at 1x)
    if !(2.0..=12.0).contains(&px_per_mm) {
        return ScreenInfo::unknown();
    }
    ScreenInfo { px_per_mm: Some(px_per_mm), width_mm: Some(d.width_mm), height_mm: Some(d.height_mm), width_pt: Some(d.width_pt), source: "display" }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::Display;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
        fn CGDisplayScreenSize(display: u32) -> CGSize;
        fn CGDisplayBounds(display: u32) -> CGRect;
    }

    /// Every active display, in points, with the physical size the OS reports.
    pub fn displays() -> Vec<Display> {
        let mut ids = [0u32; 16];
        let mut count = 0u32;
        // SAFETY: the buffer holds 16 ids and we pass its length; `count` is written by the call.
        let status = unsafe { CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut count) };
        if status != 0 {
            return Vec::new();
        }
        ids.iter()
            .take(count as usize)
            .map(|&id| {
                // SAFETY: plain value-returning CoreGraphics queries on a display id we just got.
                let (b, s) = unsafe { (CGDisplayBounds(id), CGDisplayScreenSize(id)) };
                Display { x: b.origin.x, y: b.origin.y, width_pt: b.size.width, height_pt: b.size.height, width_mm: s.width, height_mm: s.height }
            })
            .collect()
    }
}

/// The screen the main window is on. `(x, y)` is a point inside the window, in points.
pub fn read(x: f64, y: f64) -> ScreenInfo {
    #[cfg(target_os = "macos")]
    {
        let all = mac::displays();
        info_for(pick_display(&all, x, y))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (x, y);
        ScreenInfo::unknown()
    }
}

/// The physical size of the screen the window is on: see the module docs. Never fails; unknown is a value.
#[tauri::command]
pub fn screen_info(window: tauri::WebviewWindow) -> ScreenInfo {
    // the window's centre, in points: Tauri positions are physical pixels of the monitor's scale
    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    match (window.outer_position(), window.outer_size()) {
        (Ok(p), Ok(s)) => read((p.x as f64 + s.width as f64 / 2.0) / scale, (p.y as f64 + s.height as f64 / 2.0) / scale),
        _ => read(0.0, 0.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // a 14" MacBook Pro panel and a 27" 4K monitor to its right
    const BUILT_IN: Display = Display { x: 0.0, y: 0.0, width_pt: 1512.0, height_pt: 982.0, width_mm: 302.0, height_mm: 196.0 };
    const EXTERNAL: Display = Display { x: 1512.0, y: 0.0, width_pt: 2560.0, height_pt: 1440.0, width_mm: 596.0, height_mm: 335.0 };

    #[test]
    fn css_pixels_per_mm_comes_from_points_over_millimetres() {
        let i = info_for(Some(BUILT_IN));
        assert_eq!(i.source, "display");
        let px = i.px_per_mm.unwrap();
        assert!((px - 1512.0 / 302.0).abs() < 1e-9);
        // about 127 dpi in CSS terms: a 14" MacBook is a "looks like 1512 wide" panel
        assert!((px * 25.4 - 127.0).abs() < 1.0);
    }

    #[test]
    fn the_window_picks_the_display_it_is_on() {
        let all = [BUILT_IN, EXTERNAL];
        assert_eq!(pick_display(&all, 100.0, 100.0), Some(BUILT_IN));
        assert_eq!(pick_display(&all, 2000.0, 700.0), Some(EXTERNAL));
        // off every display: the first one rather than nothing
        assert_eq!(pick_display(&all, -5000.0, 0.0), Some(BUILT_IN));
        assert_eq!(pick_display(&[], 0.0, 0.0), None);
    }

    #[test]
    fn nonsense_from_the_os_is_unknown_not_a_wrong_scale() {
        assert_eq!(info_for(None), ScreenInfo::unknown());
        assert_eq!(info_for(Some(Display { width_mm: 0.0, height_mm: 0.0, ..BUILT_IN })), ScreenInfo::unknown());
        assert_eq!(info_for(Some(Display { width_mm: f64::NAN, ..BUILT_IN })), ScreenInfo::unknown());
        // an EDID that claims a 10 m wide screen
        assert_eq!(info_for(Some(Display { width_mm: 10_000.0, height_mm: 5_000.0, ..BUILT_IN })), ScreenInfo::unknown());
        // a size that makes the screen look 60 px per mm
        assert_eq!(info_for(Some(Display { width_mm: 50.0, height_mm: 40.0, ..EXTERNAL })), ScreenInfo::unknown());
    }

    #[test]
    fn serialises_with_camel_case_keys() {
        let v = serde_json::to_value(info_for(Some(EXTERNAL))).unwrap();
        assert!(v.get("pxPerMm").is_some() && v.get("widthMm").is_some() && v.get("widthPt").is_some());
        assert_eq!(v["source"], "display");
        let u = serde_json::to_value(ScreenInfo::unknown()).unwrap();
        assert!(u["pxPerMm"].is_null());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn this_mac_reports_at_least_one_display() {
        // CI runners can be headless; only check that the call does not crash and, if there is a
        // display, that what it returns is sane.
        for d in mac::displays() {
            assert!(d.width_pt > 0.0);
        }
    }
}
