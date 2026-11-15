//! Native window looks that need Rust: Mica behind the window on Windows 11.

/// Puts Mica behind the window and makes the webview transparent so the sidebar can show it.
/// The page asks for this only on Windows 11 (Windows 10 has no Mica, and a transparent webview
/// would show nothing behind it). Returns whether the effect is on.
#[tauri::command]
pub fn enable_mica(window: tauri::WebviewWindow) -> bool {
    #[cfg(windows)]
    {
        use tauri::utils::config::WindowEffectsConfig;
        use tauri::window::{Color, Effect};
        let effects = WindowEffectsConfig { effects: vec![Effect::Mica], ..Default::default() };
        return window.set_effects(effects).is_ok() && window.set_background_color(Some(Color(0, 0, 0, 0))).is_ok();
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        false
    }
}

/// On Linux, WebKitGTK turns a two-finger pinch into a zoom of the whole page. Stop that and hand
/// the pinch to the page instead, as the small steps a browser sends (ctrl + wheel), so the PR map
/// zooms under the fingers and everything else stays put. macOS and Windows already do this.
#[cfg(target_os = "linux")]
pub fn route_pinch(window: &tauri::WebviewWindow) {
    use gtk::prelude::*;
    use std::cell::Cell;
    let target = window.clone();
    let _ = window.with_webview(move |webview| {
        let last = Cell::new(1.0f64);
        webview.inner().connect_event(move |_, event| {
            let Some(pinch) = event.downcast_ref::<gtk::gdk::EventTouchpadPinch>() else {
                return gtk::glib::Propagation::Proceed;
            };
            // GDK_TOUCHPAD_GESTURE_PHASE_BEGIN, _UPDATE; _END and _CANCEL only finish the gesture.
            match pinch.as_ref().phase {
                0 => last.set(1.0),
                1 => {
                    let scale = pinch.scale();
                    if scale > 0.0 && last.get() > 0.0 {
                        let ratio = scale / last.get();
                        last.set(scale);
                        let (x, y) = pinch.position();
                        let _ = target.eval(format!("window.__betterlgtmPinch?.({ratio},{x},{y})"));
                    }
                }
                _ => {}
            }
            gtk::glib::Propagation::Stop
        });
    });
}
